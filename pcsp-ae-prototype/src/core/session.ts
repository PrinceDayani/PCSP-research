import { randomUUID } from 'node:crypto';
import type { Change, DeltaMessage, PcspMessage, SessionState, SnapshotMessage } from './types.js';
import { StateStore } from './state-store.js';
import { Coalescer, DEFAULT_COALESCER, type CoalescerOptions } from './coalescer.js';

export interface SessionOptions {
  ttlMs: number;
  coalescer: CoalescerOptions;
  maxChangesPerDelta: number;
  historyLimit: number;
}

export const DEFAULT_SESSION: SessionOptions = {
  ttlMs: 60_000,
  coalescer: DEFAULT_COALESCER,
  maxChangesPerDelta: 500,
  historyLimit: 5000,
};

interface ConsumerState {
  consumer_id: string;
  cursor: number;
  sent: number;
  state: SessionState;
  lastSeen: number;
  budget: number;
}

export class Session {
  readonly session_id = randomUUID();
  private consumers = new Map<string, ConsumerState>();
  private coalescer: Coalescer;
  private emitted: { version: number; change: Change }[] = [];

  constructor(readonly store: StateStore, private readonly options: SessionOptions = DEFAULT_SESSION) {
    this.coalescer = new Coalescer(options.coalescer);
  }

  open(consumer_id: string, requested_budget: number, now: number): PcspMessage {
    this.consumers.set(consumer_id, {
      consumer_id,
      cursor: 0,
      sent: 0,
      state: 'OPEN',
      lastSeen: now,
      budget: requested_budget,
    });
    return {
      type: 'accept',
      session_id: this.session_id,
      sender: 'source',
      message_id: randomUUID(),
      version: this.store.getVersion(),
      granted_budget: requested_budget,
      ttl: this.options.ttlMs,
      capabilities: ['delta', 'origin', 'splice', 'resync'],
    };
  }

  snapshotFor(consumer_id: string): SnapshotMessage {
    const c = this.mustGet(consumer_id);
    const snap = this.store.snapshot();
    c.sent = snap.version;
    c.state = c.state === 'STALE' ? 'RESYNCING' : c.state;
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
    const c = this.mustGet(consumer_id);
    if (version > c.sent) throw new Error('ack beyond sent version');
    c.cursor = Math.max(c.cursor, version);
    c.lastSeen = now;
    if (c.state === 'OPEN' || c.state === 'RESYNCING' || c.state === 'STALE') c.state = 'ACTIVE';
  }

  record(changes: Change[], now: number): void {
    for (const change of changes) this.coalescer.push(change, now);
  }

  flush(now: number, force = false): Change[] {
    const ready = force ? this.coalescer.flushAll() : this.coalescer.ready(now);
    const version = this.store.getVersion();
    const base = version - ready.length;
    ready.forEach((change, i) => this.emitted.push({ version: base + i + 1, change }));
    if (this.emitted.length > this.options.historyLimit) {
      this.emitted.splice(0, this.emitted.length - this.options.historyLimit);
    }
    return ready;
  }

  deltaFor(consumer_id: string): DeltaMessage | null {
    const c = this.mustGet(consumer_id);
    const pending = this.emitted.filter((e) => e.version > c.sent);
    if (pending.length === 0) return null;
    const slice = pending.slice(0, this.options.maxChangesPerDelta);
    const base_version = c.sent;
    const version = slice[slice.length - 1].version;
    c.sent = version;
    return {
      type: 'delta',
      session_id: this.session_id,
      sender: 'source',
      message_id: randomUUID(),
      base_version,
      version,
      changes: slice.map((e) => e.change),
    };
  }

  resync(consumer_id: string): SnapshotMessage {
    const c = this.mustGet(consumer_id);
    c.state = 'STALE';
    return this.snapshotFor(consumer_id);
  }

  resume(consumer_id: string, last_version: number): DeltaMessage | SnapshotMessage {
    const c = this.mustGet(consumer_id);
    const missed = this.emitted.filter((e) => e.version > last_version);
    const oldest = this.emitted.length ? this.emitted[0].version : this.store.getVersion() + 1;
    if (last_version < oldest - 1 && last_version < this.store.getVersion()) {
      return this.resync(consumer_id);
    }
    c.sent = last_version;
    c.cursor = last_version;
    c.state = 'ACTIVE';
    const version = missed.length ? missed[missed.length - 1].version : last_version;
    c.sent = version;
    return {
      type: 'delta',
      session_id: this.session_id,
      sender: 'source',
      message_id: randomUUID(),
      base_version: last_version,
      version,
      changes: missed.map((e) => e.change),
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
}
