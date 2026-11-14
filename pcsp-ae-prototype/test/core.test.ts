import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateStore, StaleWriteError } from '../src/core/state-store.js';
import { Session, ResyncRequiredError, DEFAULT_SESSION } from '../src/core/session.js';
import { Coalescer } from '../src/core/coalescer.js';
import { select, shouldInterrupt, DEFAULT_MAX_DEFER_MS } from '../src/core/selection.js';
import { McpBinding } from '../src/mcp/binding.js';
import { deltaTokens, fullStateTokens, summarize } from '../src/baseline/accounting.js';
import type { Change } from '../src/core/types.js';

function seeded(): StateStore {
  const s = new StateStore();
  s.apply([{ op: 'add', entry_id: 'layer1', parent_id: 'root', origin: 'tool', entry_type: 'layer', value: { name: 'a', x: 0 } }]);
  return s;
}

function mk(over: Partial<Change> & { version: number }): Change {
  return { change_id: `id${over.version}`, op: 'set', entry_id: 'layer1', origin: 'tool', ts: 0, path: 'x', value: 1, ...over };
}

interface PullData {
  delta: { base_version: number; version: number; changes: Change[] };
  summarized: Record<string, number>;
  truncated: boolean;
  cursor: number;
}

test('set records prev and stamps the store version on the change', () => {
  const s = seeded();
  const v = s.getVersion();
  const [c] = s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 5, origin: 'agent' }]);
  assert.equal(c.prev, 0);
  assert.equal(c.version, v + 1);
  assert.equal(s.getVersion(), v + 1);
});

test('user edit right after agent edit is marked conflict', () => {
  const s = seeded();
  s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 5, origin: 'agent' }]);
  const [c] = s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 9, origin: 'user' }]);
  assert.equal(c.conflict, true);
});

test('stale write is rejected', () => {
  const s = seeded();
  const seen = s.getVersion();
  s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 7, origin: 'user' }]);
  assert.throws(
    () => s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 8, origin: 'agent', expected_version: seen }]),
    StaleWriteError,
  );
});

test('splice keeps surrounding text', () => {
  const s = seeded();
  s.apply([{ op: 'set', entry_id: 'layer1', path: 'name', value: 'hello world', origin: 'user' }]);
  s.apply([{ op: 'splice', entry_id: 'layer1', path: 'name', start: 6, delete_count: 5, insert: 'there', origin: 'agent' }]);
  assert.equal(s.getEntry('layer1')?.properties.name, 'hello there');
});

test('splice rejects a non-string insert on a string property', () => {
  const s = seeded();
  s.apply([{ op: 'set', entry_id: 'layer1', path: 'name', value: 'abc', origin: 'user' }]);
  assert.throws(() => s.apply([{ op: 'splice', entry_id: 'layer1', path: 'name', start: 0, delete_count: 0, insert: 5, origin: 'agent' }]));
  assert.equal(s.getEntry('layer1')?.properties.name, 'abc');
});

test('set without a value is rejected', () => {
  const s = seeded();
  assert.throws(() => s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', origin: 'user' }]));
});

test('moving an entry into its own subtree is rejected', () => {
  const s = seeded();
  s.apply([{ op: 'add', entry_id: 'layer2', parent_id: 'layer1', origin: 'tool', entry_type: 'layer' }]);
  assert.throws(() => s.apply([{ op: 'move', entry_id: 'layer1', parent_id: 'layer2', origin: 'user' }]));
  assert.equal(s.getEntry('layer1')?.parent_id, 'root');
});

test('a failed batch leaves version and state unchanged', () => {
  const s = seeded();
  const before = s.getVersion();
  assert.throws(() =>
    s.apply([
      { op: 'set', entry_id: 'layer1', path: 'x', value: 9, origin: 'user' },
      { op: 'set', entry_id: 'missing', path: 'x', value: 1, origin: 'user' },
    ]),
  );
  assert.equal(s.getVersion(), before);
  assert.equal(s.getEntry('layer1')?.properties.x, 0);
});

test('coalescer merges a drag into one change with the first prev and last version', () => {
  const s = seeded();
  const c = new Coalescer({ windowMs: 250, maxHoldMs: 2000 });
  const t0 = 1000;
  for (let i = 1; i <= 5; i++) {
    const [ch] = s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: i * 10, origin: 'user' }]);
    c.push({ ...ch, ts: t0 + i * 20 }, t0 + i * 20);
  }
  assert.equal(c.ready(t0 + 150).length, 0);
  const out = c.ready(t0 + 500);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 50);
  assert.equal(out[0].prev, 0);
  assert.equal(out[0].version, s.getVersion());
});

test('coalescer keeps the conflict flag from an earlier change in the burst', () => {
  const s = seeded();
  const c = new Coalescer();
  s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 1, origin: 'agent' }]);
  const [u1] = s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 2, origin: 'user' }]);
  const [u2] = s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 3, origin: 'user' }]);
  assert.equal(u1.conflict, true);
  assert.equal(u2.conflict, undefined);
  c.push(u1, 1000);
  c.push(u2, 1010);
  const out = c.flushAll();
  assert.equal(out.length, 1);
  assert.equal(out[0].conflict, true);
  assert.equal(out[0].value, 3);
});

test('coalescer never emits a later version ahead of a held earlier one', () => {
  const s = seeded();
  const c = new Coalescer({ windowMs: 250, maxHoldMs: 2000 });
  const [held] = s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 1, origin: 'user' }]);
  const [later] = s.apply([{ op: 'add', entry_id: 'layer2', parent_id: 'root', origin: 'tool', entry_type: 'layer', value: {} }]);
  c.push({ ...held, ts: 1000 }, 1000);
  c.push({ ...later, ts: 1010 }, 1010);
  assert.deepEqual(c.ready(1100), []);
  assert.deepEqual(c.ready(1300).map((x) => x.version), [held.version, later.version]);
});

test('session delivers snapshot then delta, then nothing, and resync recovers', () => {
  const s = seeded();
  const sess = new Session(s);
  sess.open('c1', 1000, 0);
  const snap = sess.snapshotFor('c1');
  sess.ack('c1', snap.version, 1);
  assert.equal(sess.stateOf('c1'), 'ACTIVE');
  sess.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 3, origin: 'user' }], 10);
  sess.flush(10, true);
  const delta = sess.deltaFor('c1', 11);
  assert.ok(delta);
  assert.equal(delta.base_version, snap.version);
  assert.equal(delta.version, s.getVersion());
  assert.equal(sess.deltaFor('c1', 12), null);
  const fresh = sess.resync('c1');
  assert.equal(fresh.version, s.getVersion());
  assert.equal(sess.stateOf('c1'), 'RESYNCING');
  sess.ack('c1', fresh.version, 13);
  assert.equal(sess.stateOf('c1'), 'ACTIVE');
});

test('no delta is sent before the snapshot is acknowledged', () => {
  const s = seeded();
  const sess = new Session(s);
  sess.open('c1', 1000, 0);
  sess.snapshotFor('c1');
  sess.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 3, origin: 'user' }], 5);
  sess.flush(5, true);
  assert.equal(sess.deltaFor('c1', 6), null);
});

test('session expires after the ttl and a heartbeat keeps it alive', () => {
  const sess = new Session(seeded(), { ...DEFAULT_SESSION, ttlMs: 1000 });
  sess.open('c1', 1000, 0);
  sess.heartbeat('c1', 800);
  assert.deepEqual(sess.sweep(1500), []);
  assert.deepEqual(sess.sweep(2000), ['c1']);
  assert.equal(sess.stateOf('c1'), 'EXPIRED');
  assert.throws(() => sess.ack('c1', 0, 2100));
});

test('resume returns the missed changes while history is retained', () => {
  const s = seeded();
  const sess = new Session(s);
  sess.open('c1', 1000, 0);
  const snap = sess.snapshotFor('c1');
  sess.ack('c1', snap.version, 1);
  sess.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 1, origin: 'tool' }], 10);
  sess.apply([{ op: 'set', entry_id: 'layer1', path: 'name', value: 'b', origin: 'tool' }], 10);
  sess.flush(10, true);
  const r = sess.resume('c1', snap.version, 20);
  assert.equal(r.type, 'delta');
  if (r.type === 'delta') {
    assert.equal(r.changes.length, 2);
    assert.equal(r.base_version, snap.version);
  }
  assert.equal(sess.stateOf('c1'), 'ACTIVE');
  assert.equal(sess.deltaFor('c1', 21), null);
});

test('resume falls back to a snapshot when history was trimmed', () => {
  const s = seeded();
  const sess = new Session(s, { ...DEFAULT_SESSION, historyLimit: 2 });
  sess.open('c1', 1000, 0);
  const snap = sess.snapshotFor('c1');
  sess.ack('c1', snap.version, 1);
  for (let i = 0; i < 5; i++) sess.apply([{ op: 'set', entry_id: 'layer1', path: `p${i}`, value: i, origin: 'tool' }], 10);
  sess.flush(10, true);
  assert.equal(sess.resume('c1', snap.version, 20).type, 'snapshot');
});

test('resume rejects a version from the future', () => {
  const sess = new Session(seeded());
  sess.open('c1', 1000, 0);
  assert.throws(() => sess.resume('c1', 99, 1));
});

test('a consumer that fell behind trimmed history is told to resync', () => {
  const s = seeded();
  const sess = new Session(s, { ...DEFAULT_SESSION, historyLimit: 2 });
  sess.open('c1', 1000, 0);
  const snap = sess.snapshotFor('c1');
  sess.ack('c1', snap.version, 1);
  for (let i = 0; i < 5; i++) sess.apply([{ op: 'set', entry_id: 'layer1', path: `p${i}`, value: i, origin: 'tool' }], 10);
  sess.flush(10, true);
  assert.throws(() => sess.pendingFor('c1'), ResyncRequiredError);
  assert.equal(sess.stateOf('c1'), 'STALE');
});

test('selection always includes conflicts and reports truncation', () => {
  const other = mk({ version: 2 });
  const conflict = mk({ version: 3, origin: 'user', conflict: true });
  const r = select({ pending: [other, conflict], baseCursor: 1, budget: 1, focusEntries: new Set(), now: 0, tokenCost: () => 10 });
  assert.deepEqual(r.included.map((c) => c.version), [3]);
  assert.equal(r.truncated, true);
  assert.equal(r.cursor, 1);
  assert.deepEqual(r.summarized, { layer1: 1 });
});

test('selection summarizes what does not fit, holds the cursor, then catches up without charging twice', () => {
  const a = mk({ version: 2, path: 'x' });
  const b = mk({ version: 3, path: 'name' });
  const c = mk({ version: 4, path: 'y' });
  const tokenCost = (ch: Change) => (ch.path === 'name' ? 100 : 5);
  const first = select({ pending: [a, b, c], baseCursor: 1, budget: 50, focusEntries: new Set(), now: 0, tokenCost });
  assert.deepEqual(first.included.map((ch) => ch.version), [2, 4]);
  assert.deepEqual(first.summarized, { layer1: 1 });
  assert.equal(first.cursor, 2);
  assert.equal(first.truncated, false);
  const second = select({ pending: [b, c], delivered: new Set([c.change_id]), baseCursor: 2, budget: 200, focusEntries: new Set(), now: 0, tokenCost });
  assert.deepEqual(second.included.map((ch) => ch.version), [3]);
  assert.equal(second.cursor, 4);
  assert.equal(second.tokensUsed, 100);
});

test('a change deferred too long is included even when it exceeds the budget', () => {
  const b = mk({ version: 3, ts: 0 });
  const r = select({ pending: [b], baseCursor: 2, budget: 50, focusEntries: new Set(), now: DEFAULT_MAX_DEFER_MS, tokenCost: () => 100 });
  assert.equal(r.included.length, 1);
  assert.equal(r.truncated, true);
  assert.equal(r.cursor, 3);
});

test('interrupts respect the minimum gap and only fire for conflicts or the entry being edited', () => {
  const conflict = mk({ version: 2, origin: 'user', conflict: true });
  const userOnEdited = mk({ version: 3, origin: 'user' });
  const tool = mk({ version: 4 });
  assert.equal(shouldInterrupt(conflict, new Set(), 0, 4000), false);
  assert.equal(shouldInterrupt(conflict, new Set(), 0, 6000), true);
  assert.equal(shouldInterrupt(userOnEdited, new Set(['layer1']), 0, 6000), true);
  assert.equal(shouldInterrupt(userOnEdited, new Set(), 0, 6000), false);
  assert.equal(shouldInterrupt(tool, new Set(['layer1']), 0, 6000), false);
});

test('binding pull defers what does not fit, never loses it, and does not resend delivered changes', () => {
  const t0 = Date.now();
  const s = seeded();
  const sess = new Session(s);
  const bind = new McpBinding(sess);
  const opened = bind.handle('pcsp.open', { consumer_id: 'c1', budget: 120 }, t0);
  assert.equal(opened.ok, true);
  const snapVersion = (opened.data as unknown as { snapshot: { version: number } }).snapshot.version;
  assert.equal(bind.handle('pcsp.ack', { consumer_id: 'c1', version: snapVersion }, t0).ok, true);

  const [a, b, c] = sess.apply(
    [
      { op: 'set', entry_id: 'layer1', path: 'p1', value: 1, origin: 'tool' },
      { op: 'set', entry_id: 'layer1', path: 'big', value: 'z'.repeat(2000), origin: 'tool' },
      { op: 'set', entry_id: 'layer1', path: 'p2', value: 2, origin: 'tool' },
    ],
    t0,
  );

  const first = bind.handle('pcsp.pull', { consumer_id: 'c1' }, t0 + 1000);
  assert.equal(first.ok, true);
  const f = first.data as unknown as PullData;
  assert.deepEqual(f.delta.changes.map((x) => x.change_id), [a.change_id, c.change_id]);
  assert.equal(f.delta.base_version, snapVersion);
  assert.deepEqual(f.summarized, { layer1: 1 });
  assert.equal(f.truncated, false);
  assert.equal(f.cursor, a.version);

  assert.equal(bind.handle('pcsp.ack', { consumer_id: 'c1', version: c.version }, t0 + 1100).ok, true);
  assert.equal(bind.handle('pcsp.ack', { consumer_id: 'c1', version: c.version + 5 }, t0 + 1100).ok, false);

  const second = bind.handle('pcsp.pull', { consumer_id: 'c1' }, t0 + DEFAULT_MAX_DEFER_MS + 1000);
  assert.equal(second.ok, true);
  const g = second.data as unknown as PullData;
  assert.deepEqual(g.delta.changes.map((x) => x.change_id), [b.change_id]);
  assert.equal(g.truncated, true);
  assert.equal(g.cursor, c.version);

  const third = bind.handle('pcsp.pull', { consumer_id: 'c1' }, t0 + DEFAULT_MAX_DEFER_MS + 2000);
  assert.deepEqual(third, { ok: true, data: null });
});

test('binding reports resync_required after history is trimmed and recovers through resync', () => {
  const t0 = Date.now();
  const s = seeded();
  const sess = new Session(s, { ...DEFAULT_SESSION, historyLimit: 1 });
  const bind = new McpBinding(sess);
  const opened = bind.handle('pcsp.open', { consumer_id: 'c1' }, t0);
  const snapVersion = (opened.data as unknown as { snapshot: { version: number } }).snapshot.version;
  bind.handle('pcsp.ack', { consumer_id: 'c1', version: snapVersion }, t0);
  sess.apply(
    [
      { op: 'set', entry_id: 'layer1', path: 'p0', value: 0, origin: 'tool' },
      { op: 'set', entry_id: 'layer1', path: 'p1', value: 1, origin: 'tool' },
      { op: 'set', entry_id: 'layer1', path: 'p2', value: 2, origin: 'tool' },
    ],
    t0,
  );
  const pulled = bind.handle('pcsp.pull', { consumer_id: 'c1' }, t0 + 1000);
  assert.equal(pulled.ok, false);
  assert.equal(pulled.error?.code, 'resync_required');
  const resynced = bind.handle('pcsp.resync', { consumer_id: 'c1' }, t0 + 1100);
  assert.equal(resynced.ok, true);
  const version = (resynced.data as unknown as { version: number }).version;
  assert.equal(bind.handle('pcsp.ack', { consumer_id: 'c1', version }, t0 + 1200).ok, true);
  assert.deepEqual(bind.handle('pcsp.pull', { consumer_id: 'c1' }, t0 + 1300), { ok: true, data: null });
});

test('binding validates arguments, answers heartbeats and rejects unknown tools', () => {
  const bind = new McpBinding(new Session(seeded()));
  assert.equal(bind.handle('pcsp.open', {}, 0).ok, false);
  assert.equal(bind.handle('pcsp.open', { consumer_id: 'c1', budget: -5 }, 0).ok, false);
  assert.equal(bind.handle('pcsp.open', { consumer_id: 'c1' }, 0).ok, true);
  const beat = bind.handle('pcsp.heartbeat', { consumer_id: 'c1' }, 10);
  assert.equal(beat.ok, true);
  assert.equal((beat.data as unknown as { type: string }).type, 'heartbeat');
  assert.equal(bind.handle('pcsp.nope', {}, 0).error?.code, 'unknown_tool');
});

test('baseline accounting totals tokens and savings', () => {
  const s = seeded();
  assert.ok(fullStateTokens(s.snapshot().state) > 0);
  assert.equal(deltaTokens([]), 0);
  const r = summarize([
    { turn: 1, baselineTokens: 100, pcspTokens: 40 },
    { turn: 2, baselineTokens: 200, pcspTokens: 60 },
  ]);
  assert.equal(r.baselineTotal, 300);
  assert.equal(r.pcspTotal, 100);
  assert.ok(Math.abs(r.savedPercent - 66.6667) < 0.001);
  assert.equal(summarize([]).savedPercent, 0);
});
