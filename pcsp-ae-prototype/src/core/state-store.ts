import { randomUUID } from 'node:crypto';
import type { Change, DeltaMessage, Entry, Json, Origin, StateTree } from './types.js';

export interface ChangeInput {
  op: Change['op'];
  entry_id: string;
  origin: Origin;
  path?: string;
  value?: Json;
  parent_id?: string;
  index?: number;
  start?: number;
  delete_count?: number;
  insert?: Json;
  entry_type?: string;
  expected_version?: number;
}

export class StaleWriteError extends Error {
  constructor(public readonly entry_id: string, public readonly current: Json | undefined) {
    super(`stale_write on ${entry_id}`);
  }
}

export class StateStore {
  private tree: StateTree;
  private version = 0;
  private history: { version: number; change: Change }[] = [];
  private lastTouch = new Map<string, { version: number; origin: Origin }>();

  constructor(rootType = 'project') {
    const root: Entry = { entry_id: 'root', type: rootType, properties: {}, children: [], parent_id: null };
    this.tree = { root_id: 'root', entries: { root } };
  }

  getVersion(): number {
    return this.version;
  }

  snapshot(): { version: number; state: StateTree } {
    return { version: this.version, state: structuredClone(this.tree) };
  }

  getEntry(entry_id: string): Entry | undefined {
    return this.tree.entries[entry_id];
  }

  historyFrom(version: number): { version: number; change: Change }[] | null {
    if (version > this.version) return null;
    if (this.history.length === 0) return version === this.version ? [] : null;
    const oldest = this.history[0].version;
    if (version < oldest - 1) return null;
    return this.history.filter((h) => h.version > version);
  }

  apply(inputs: ChangeInput[]): DeltaMessage['changes'] {
    const out: Change[] = [];
    for (const input of inputs) {
      const entry = this.tree.entries[input.entry_id];
      this.checkExpected(input, entry);
      const change = this.applyOne(input, entry);
      this.version += 1;
      const touch = this.lastTouch.get(input.entry_id);
      if (
        input.origin === 'user' &&
        touch &&
        touch.origin === 'agent' &&
        this.version - touch.version <= 1
      ) {
        change.conflict = true;
      }
      this.lastTouch.set(input.entry_id, { version: this.version, origin: input.origin });
      this.history.push({ version: this.version, change });
      out.push(change);
    }
    return out;
  }

  private checkExpected(input: ChangeInput, entry: Entry | undefined): void {
    if (input.expected_version === undefined || !entry) return;
    const touch = this.lastTouch.get(input.entry_id);
    if (touch && touch.version > input.expected_version && touch.origin !== input.origin) {
      const current = input.path ? entry.properties[input.path] : undefined;
      throw new StaleWriteError(input.entry_id, current);
    }
  }

  private base(input: ChangeInput): Change {
    return { change_id: randomUUID(), op: input.op, entry_id: input.entry_id, origin: input.origin, ts: Date.now() };
  }

  private applyOne(input: ChangeInput, entry: Entry | undefined): Change {
    const change = this.base(input);
    switch (input.op) {
      case 'add': {
        if (!input.parent_id || !this.tree.entries[input.parent_id]) throw new Error('add requires existing parent_id');
        if (this.tree.entries[input.entry_id]) throw new Error('entry already exists');
        const parent = this.tree.entries[input.parent_id];
        const created: Entry = {
          entry_id: input.entry_id,
          type: input.entry_type ?? 'entry',
          properties: (input.value as Record<string, Json>) ?? {},
          children: [],
          parent_id: input.parent_id,
        };
        this.tree.entries[input.entry_id] = created;
        const index = input.index ?? parent.children.length;
        parent.children.splice(index, 0, input.entry_id);
        return { ...change, parent_id: input.parent_id, index, value: created.properties, entry_type: created.type };
      }
      case 'remove': {
        if (!entry || !entry.parent_id) throw new Error('cannot remove missing or root entry');
        const parent = this.tree.entries[entry.parent_id];
        parent.children = parent.children.filter((c) => c !== entry.entry_id);
        this.removeSubtree(entry.entry_id);
        return change;
      }
      case 'set': {
        if (!entry || !input.path) throw new Error('set requires entry and path');
        const prev = entry.properties[input.path];
        entry.properties[input.path] = input.value as Json;
        return { ...change, path: input.path, value: input.value, prev };
      }
      case 'move': {
        if (!entry || !entry.parent_id || !input.parent_id) throw new Error('move requires entry and parent_id');
        const oldParent = this.tree.entries[entry.parent_id];
        const newParent = this.tree.entries[input.parent_id];
        if (!newParent) throw new Error('move target parent missing');
        oldParent.children = oldParent.children.filter((c) => c !== entry.entry_id);
        const index = input.index ?? newParent.children.length;
        newParent.children.splice(index, 0, entry.entry_id);
        entry.parent_id = input.parent_id;
        return { ...change, parent_id: input.parent_id, index };
      }
      case 'splice': {
        if (!entry || !input.path) throw new Error('splice requires entry and path');
        const current = entry.properties[input.path];
        const start = input.start ?? 0;
        const del = input.delete_count ?? 0;
        let next: Json;
        if (typeof current === 'string') {
          next = current.slice(0, start) + String(input.insert ?? '') + current.slice(start + del);
        } else if (Array.isArray(current)) {
          const copy = current.slice();
          copy.splice(start, del, ...(Array.isArray(input.insert) ? input.insert : input.insert === undefined ? [] : [input.insert]));
          next = copy;
        } else {
          throw new Error('splice requires string or array property');
        }
        entry.properties[input.path] = next;
        return { ...change, path: input.path, start, delete_count: del, insert: input.insert, prev: current };
      }
    }
  }

  private removeSubtree(entry_id: string): void {
    const entry = this.tree.entries[entry_id];
    if (!entry) return;
    for (const child of entry.children) this.removeSubtree(child);
    delete this.tree.entries[entry_id];
  }
}
