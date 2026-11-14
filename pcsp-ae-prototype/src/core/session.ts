import { randomUUID } from 'node:crypto';
import type { AcceptMessage, Change, DeltaMessage, HeartbeatMessage, SessionState, SnapshotMessage } from './types.js';
import { StateStore, type ChangeInput } from './state-store.js';
import { Coalescer, DEFAULT_COALESCER, type CoalescerOptions } from './coalescer.js';

export interface SessionOptions {
  ttlMs: number;
  coalescer: CoalescerOptions;
  maxChangesPerDelta: number;
  historyLimit: number;
  maxBudget: number;
}

export const DEFAULT_SESSION: SessionOptions = {
  ttlMs: 60_000,
  coalescer: DEFAULT_COALESCER,
  maxChangesPerDelta: 500,
  historyLimit: 5000,
  maxBudget: 8000,
};

export class ResyncRequiredError extends Error {
  constructor() {
    super('delivery cursor is older than retained history; resync required');
  }
}

export interface PendingView {
  base: number;
  pending: Change[];
  delivered: ReadonlySet<string>;
  budget: number;
}

interface ConsumerState {
  consumer_id: string;
  state: SessionState;
  lastSeen: number;
  budget: number;
  cursor: number;
  sent: number;
  ahead: Map<string, number>;
}

export class Session {
  readonly session_id = randomUUID();
  private consumers = new Map<string, ConsumerState>();
  private coalescer: Coalescer;
  private emitted: Change[] = [];
  private floor: number;

  constructor(readonly store: StateStore, private readonly options: SessionOptions = DEFAULT_SESSION) {
    this.coalescer = new Coalescer(options.coalescer);
    this.floor = store.getVersion();
  }

  open(consumer_id: string, requested_budget: number, now: number): AcceptMessage {
    if (!consumer_id) throw new Error('consumer_id is required');
    if (!Number.isFinite(requested_budget) || requested_budget <= 0) throw new Error('budget must be a positive number');
    const budget = Math.min(requested_budget, this.options.maxBudget);
    this.consumers.set(consumer_id, {
      consumer_id,
      state: 'OPEN',
      lastSeen: now,
      budget,
      cursor: 0,
      sent: 0,
      ahead: new Map(),
    });
    return {
      type: 'accept',
      session_id: this.session_id,
      sender: 'source',
      message_id: randomUUID(),
      version: this.store.getVersion(),
      granted_budget: budget,
      ttl: this.options.ttlMs,
      capabilities: ['delta', 'origin', 'splice', 'resync'],
    };
  }

  apply(inputs: ChangeInput[], now: number): Change[] {
    const changes = this.store.apply(inputs);
    this.record(changes, now);
    return changes;
  }

  record(changes: Change[], now: number): void {
    for (const change of changes) this.coalescer.push(change, now);
  }

  flush(now: number, force = false): Change[] {
    const ready = force ? this.coalescer.flushAll() : this.coalescer.ready(now);
    this.emitted.push(...ready);
    const excess = this.emitted.length - this.options.historyLimit;
    if (excess > 0) {
      const removed = this.emitted.splice(0, excess);
      this.floor = removed[removed.length - 1].version;
    }
    return ready;
  }

  snapshotFor(consumer_id: string): SnapshotMessage {
    const c = this.live(consumer_id);
    const snap = this.store.snapshot();
    c.sent = snap.version;
    c.ahead.clear();
    if (c.state === 'STALE') c.state = 'RESYNCING';
    return {
      type: 'snapshot',
      session_id: this.session_id,
      sender: 'source',
      message_id: randomUUID(),
      version: snap.version,
      state: snap.state,
      schema_id: 'ae-composition-v0',
    };
  }

  ack(consumer_id: string, version: number, now: number): void {
    const c = this.live(consumer_id);
    const delivered = Math.max(c.sent, ...c.ahead.values());
    if (!Number.isInteger(version) || version > delivered) throw new Error('ack beyond delivered version');
    c.cursor = Math.max(c.cursor, version);
    c.lastSeen = now;
    if (c.state === 'OPEN' || c.state === 'RESYNCING') c.state = 'ACTIVE';
  }

  heartbeat(consumer_id: string, now: number): HeartbeatMessage {
    const c = this.live(consumer_id);
    c.lastSeen = now;
    return {
      type: 'heartbeat',
      session_id: this.session_id,
      sender: 'source',
      message_id: randomUUID(),
      version: this.store.getVersion(),
    };
  }

  touch(consumer_id: string, now: number): void {
    this.live(consumer_id).lastSeen = now;
  }

  pendingFor(consumer_id: string): PendingView | null {
    const c = this.mustGet(consumer_id);
    if (c.state === 'STALE') throw new ResyncRequiredError();
    if (c.state !== 'ACTIVE') return null;
    if (c.sent < this.floor) {
      c.state = 'STALE';
      throw new ResyncRequiredError();
    }
    return {
      base: c.sent,
      pending: this.emitted.filter((ch) => ch.version > c.sent),
      delivered: new Set(c.ahead.keys()),
      budget: c.budget,
    };
  }

  commit(consumer_id: string, delivered: Change[], now: number): number {
    const c = this.live(consumer_id);
    c.lastSeen = now;
    for (const ch of delivered) {
      if (ch.version > c.sent) c.ahead.set(ch.change_id, ch.version);
    }
    let cursor = c.sent;
    for (const ch of this.emitted) {
      if (ch.version <= cursor) continue;
      if (c.ahead.has(ch.change_id)) cursor = ch.version;
      else break;
    }
    c.sent = cursor;
    for (const [id, version] of c.ahead) {
      if (version <= cursor) c.ahead.delete(id);
    }
    return cursor;
  }

  deltaFor(consumer_id: string, now: number): DeltaMessage | null {
    const view = this.pendingFor(consumer_id);
    if (!view) return null;
    const fresh = view.pending.filter((ch) => !view.delivered.has(ch.change_id)).slice(0, this.options.maxChangesPerDelta);
    if (fresh.length === 0) return null;
    this.commit(consumer_id, fresh, now);
    return {
      type: 'delta',
      session_id: this.session_id,
      sender: 'source',
      message_id: randomUUID(),
      base_version: view.base,
      version: fresh[fresh.length - 1].version,
      changes: fresh,
    };
  }

  resync(consumer_id: string): SnapshotMessage {
    this.live(consumer_id).state = 'STALE';
    return this.snapshotFor(consumer_id);
  }

  resume(consumer_id: string, last_version: number, now: number): DeltaMessage | SnapshotMessage {
    const c = this.mustGet(consumer_id);
    if (!Number.isInteger(last_version) || last_version < 0 || last_version > this.store.getVersion()) {
      throw new Error('last_version is not a version of this session');
    }
    c.lastSeen = now;
    if (last_version < this.floor) {
      c.state = 'STALE';
      return this.snapshotFor(consumer_id);
    }
    const missed = this.emitted.filter((ch) => ch.version > last_version).slice(0, this.options.maxChangesPerDelta);
    const version = missed.length ? missed[missed.length - 1].version : last_version;
    c.sent = version;
    c.cursor = last_version;
    c.ahead.clear();
    c.state = 'ACTIVE';
    return {
      type: 'delta',
      session_id: this.session_id,
      sender: 'source',
      message_id: randomUUID(),
      base_version: last_version,
      version,
      changes: missed,
    };
  }

  sweep(now: number): string[] {
    const expired: string[] = [];
    for (const c of this.consumers.values()) {
      if (c.state !== 'EXPIRED' && c.state !== 'CLOSED' && now - c.lastSeen > this.options.ttlMs) {
        c.state = 'EXPIRED';
        expired.push(c.consumer_id);
      }
    }
    return expired;
  }

  close(consumer_id: string): void {
    this.mustGet(consumer_id).state = 'CLOSED';
  }

  stateOf(consumer_id: string): SessionState {
    return this.mustGet(consumer_id).state;
  }

  cursorOf(consumer_id: string): number {
    return this.mustGet(consumer_id).cursor;
  }

  private mustGet(consumer_id: string): ConsumerState {
    const c = this.consumers.get(consumer_id);
    if (!c) throw new Error(`unknown consumer ${consumer_id}`);
    return c;
  }

  private live(consumer_id: string): ConsumerState {
    const c = this.mustGet(consumer_id);
    if (c.state === 'EXPIRED' || c.state === 'CLOSED') throw new Error(`consumer ${consumer_id} is ${c.state}; resume first`);
    return c;
  }
}
