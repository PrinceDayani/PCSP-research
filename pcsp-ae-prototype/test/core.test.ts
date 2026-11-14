import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateStore, StaleWriteError } from '../src/core/state-store.js';
import { Session } from '../src/core/session.js';
import { Coalescer } from '../src/core/coalescer.js';
import { select } from '../src/core/selection.js';

function seeded(): StateStore {
  const s = new StateStore();
  s.apply([{ op: 'add', entry_id: 'layer1', parent_id: 'root', origin: 'tool', entry_type: 'layer', value: { name: 'a', x: 0 } }]);
  return s;
}

test('set records prev and increments version', () => {
  const s = seeded();
  const v = s.getVersion();
  const [c] = s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 5, origin: 'agent' }]);
  assert.equal(c.prev, 0);
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

test('coalescer merges a drag into one change with first prev', () => {
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
});

test('session delivers snapshot then delta, and resync recovers', () => {
  const s = seeded();
  const sess = new Session(s);
  sess.open('c1', 1000, 0);
  const snap = sess.snapshotFor('c1');
  sess.ack('c1', snap.version, 1);
  assert.equal(sess.stateOf('c1'), 'ACTIVE');
  const changes = s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 3, origin: 'user' }]);
  sess.record(changes, 10);
  sess.flush(10, true);
  const delta = sess.deltaFor('c1');
  assert.ok(delta);
  assert.equal(delta?.base_version, snap.version);
  const fresh = sess.resync('c1');
  assert.equal(fresh.version, s.getVersion());
});

test('session expires after ttl with no activity', () => {
  const s = seeded();
  const sess = new Session(s, { ttlMs: 1000, coalescer: { windowMs: 250, maxHoldMs: 2000 }, maxChangesPerDelta: 500, historyLimit: 100 });
  sess.open('c1', 1000, 0);
  assert.deepEqual(sess.sweep(5000), ['c1']);
  assert.equal(sess.stateOf('c1'), 'EXPIRED');
});

test('selection always includes conflicts and reports truncation', () => {
  const s = seeded();
  s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 1, origin: 'agent' }]);
  const changes = s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 2, origin: 'user' }]);
  const pending = changes.map((change, i) => ({ version: 10 + i, change }));
  const r = select({ pending, budget: 1, focusEntries: new Set(), now: Date.now() });
  assert.equal(r.included.length, 1);
  assert.equal(r.truncated, true);
});

test('selection summarizes what does not fit and holds the cursor', () => {
  const s = seeded();
  const a = s.apply([{ op: 'set', entry_id: 'layer1', path: 'x', value: 1, origin: 'tool' }]);
  const b = s.apply([{ op: 'set', entry_id: 'layer1', path: 'name', value: 'z'.repeat(400), origin: 'tool' }]);
  const pending = [
    { version: 1, change: a[0] },
    { version: 2, change: b[0] },
  ];
  const r = select({ pending, budget: 60, focusEntries: new Set(), now: Date.now() });
  assert.ok(Object.keys(r.summarized).length >= 1);
  assert.ok(r.cursor < 2);
});
