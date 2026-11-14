import { randomUUID } from 'node:crypto';
import type { Change, Entry, Json, Origin, StateTree } from './types.js';

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

  apply(inputs: ChangeInput[]): Change[] {
    const backup =
      inputs.length > 1
        ? { tree: structuredClone(this.tree), version: this.version, lastTouch: new Map(this.lastTouch) }
        : null;
    const out: Change[] = [];
    try {
      for (const input of inputs) out.push(this.applyInput(input));
    } catch (error) {
      if (backup) {
        this.tree = backup.tree;
        this.version = backup.version;
        this.lastTouch = backup.lastTouch;
      }
      throw error;
    }
    return out;
  }

  private applyInput(input: ChangeInput): Change {
    const entry = this.tree.entries[input.entry_id];
    this.checkExpected(input, entry);
    const change = this.applyOne(input, entry);
    this.version += 1;
    change.version = this.version;
    if (input.op === 'remove') return change;
    const touch = this.lastTouch.get(input.entry_id);
    if (input.origin === 'user' && touch?.origin === 'agent' && this.version - touch.version <= 1) {
      change.conflict = true;
    }
    this.lastTouch.set(input.entry_id, { version: this.version, origin: input.origin });
    return change;
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
    return { change_id: randomUUID(), version: 0, op: input.op, entry_id: input.entry_id, origin: input.origin, ts: Date.now() };
  }

  private applyOne(input: ChangeInput, entry: Entry | undefined): Change {
    const change = this.base(input);
    switch (input.op) {
      case 'add': {
        if (!input.entry_id) throw new Error('add requires entry_id');
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
        if (input.value === undefined) throw new Error('set requires value');
        const prev = entry.properties[input.path];
        entry.properties[input.path] = input.value;
        return { ...change, path: input.path, value: input.value, prev };
      }
      case 'move': {
        if (!entry || !entry.parent_id || !input.parent_id) throw new Error('move requires entry and parent_id');
        const newParent = this.tree.entries[input.parent_id];
        if (!newParent) throw new Error('move target parent missing');
        for (let cursor: string | null = input.parent_id; cursor; cursor = this.tree.entries[cursor]?.parent_id ?? null) {
          if (cursor === entry.entry_id) throw new Error('cannot move an entry into its own subtree');
        }
        const oldParent = this.tree.entries[entry.parent_id];
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
        if (start < 0 || del < 0) throw new Error('splice start and delete_count must not be negative');
        let next: Json;
        if (typeof current === 'string') {
          if (input.insert !== undefined && typeof input.insert !== 'string') {
            throw new Error('splice on a string property requires a string insert');
          }
          next = current.slice(0, start) + (input.insert ?? '') + current.slice(start + del);
        } else if (Array.isArray(current)) {
          const copy = current.slice();
          const items = Array.isArray(input.insert) ? input.insert : input.insert === undefined ? [] : [input.insert];
          copy.splice(start, del, ...items);
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
    this.lastTouch.delete(entry_id);
  }
}
