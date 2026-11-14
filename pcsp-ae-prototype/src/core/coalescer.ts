import type { Change } from './types.js';

export interface CoalescerOptions {
  windowMs: number;
  maxHoldMs: number;
}

export const DEFAULT_COALESCER: CoalescerOptions = { windowMs: 250, maxHoldMs: 2000 };

interface Pending {
  change: Change;
  firstTs: number;
  lastTs: number;
}

export class Coalescer {
  private pending = new Map<string, Pending>();
  private queue: Change[] = [];

  constructor(private readonly options: CoalescerOptions = DEFAULT_COALESCER) {}

  push(change: Change, now: number = change.ts): void {
    if (change.op !== 'set' || change.path === undefined) {
      this.release(change.entry_id);
      this.queue.push(change);
      return;
    }
    const key = `${change.entry_id}\u0000${change.path}\u0000${change.origin}`;
    const existing = this.pending.get(key);
    if (!existing) {
      this.pending.set(key, { change, firstTs: now, lastTs: now });
      return;
    }
    const merged: Change = { ...change, prev: existing.change.prev };
    if (existing.change.conflict || change.conflict) merged.conflict = true;
    existing.change = merged;
    existing.lastTs = now;
  }

  ready(now: number): Change[] {
    for (const [key, p] of this.pending) {
      const quiet = now - p.lastTs >= this.options.windowMs;
      const held = now - p.firstTs >= this.options.maxHoldMs;
      if (quiet || held) {
        this.queue.push(p.change);
        this.pending.delete(key);
      }
    }
    return this.drain(this.barrier());
  }

  flushAll(): Change[] {
    for (const p of this.pending.values()) this.queue.push(p.change);
    this.pending.clear();
    return this.drain(Infinity);
  }

  private barrier(): number {
    let lowest = Infinity;
    for (const p of this.pending.values()) lowest = Math.min(lowest, p.change.version);
    return lowest;
  }

  private drain(barrier: number): Change[] {
    this.queue.sort((a, b) => a.version - b.version);
    const cut = this.queue.findIndex((c) => c.version >= barrier);
    if (cut === -1) {
      const out = this.queue;
      this.queue = [];
      return out;
    }
    const out = this.queue.slice(0, cut);
    this.queue = this.queue.slice(cut);
    return out;
  }

  private release(entry_id: string): void {
    for (const [key, p] of this.pending) {
      if (p.change.entry_id === entry_id) {
        this.queue.push(p.change);
        this.pending.delete(key);
      }
    }
  }
}
