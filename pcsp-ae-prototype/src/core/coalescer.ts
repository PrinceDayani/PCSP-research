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
  firstPrev: Change['prev'];
}

export class Coalescer {
  private pending = new Map<string, Pending>();
  private passthrough: Change[] = [];

  constructor(private readonly options: CoalescerOptions = DEFAULT_COALESCER) {}

  push(change: Change, now: number = change.ts): void {
    if (change.op !== 'set' || change.path === undefined) {
      this.flushKey(`${change.entry_id}`, now, true);
      this.passthrough.push(change);
      return;
    }
    const key = `${change.entry_id}\u0000${change.path}\u0000${change.origin}`;
    const existing = this.pending.get(key);
    if (existing) {
      existing.change = { ...change, prev: existing.firstPrev };
      existing.lastTs = now;
    } else {
      this.pending.set(key, { change, firstTs: now, lastTs: now, firstPrev: change.prev });
    }
  }

  ready(now: number): Change[] {
    const out: Change[] = [...this.passthrough];
    this.passthrough = [];
    for (const [key, p] of this.pending) {
      const quiet = now - p.lastTs >= this.options.windowMs;
      const held = now - p.firstTs >= this.options.maxHoldMs;
      if (quiet || held) {
        out.push(p.change);
        this.pending.delete(key);
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  flushAll(): Change[] {
    const out: Change[] = [...this.passthrough, ...[...this.pending.values()].map((p) => p.change)];
    this.passthrough = [];
    this.pending.clear();
    return out.sort((a, b) => a.ts - b.ts);
  }

  private flushKey(entry_id: string, now: number, force: boolean): void {
    for (const [key, p] of this.pending) {
      if (p.change.entry_id === entry_id && (force || now - p.lastTs >= this.options.windowMs)) {
        this.passthrough.push(p.change);
        this.pending.delete(key);
      }
    }
  }
}
