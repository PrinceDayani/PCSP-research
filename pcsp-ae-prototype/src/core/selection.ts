import type { Change } from './types.js';

export interface SelectionWeights {
  user: number;
  conflict: number;
  focus: number;
  recency: number;
  magnitude: number;
}

export const DEFAULT_WEIGHTS: SelectionWeights = { user: 5, conflict: 10, focus: 4, recency: 2, magnitude: 1 };

export const DEFAULT_MAX_DEFER_MS = 30_000;

export interface SelectionInput {
  pending: Change[];
  baseCursor: number;
  delivered?: ReadonlySet<string>;
  budget: number;
  focusEntries: ReadonlySet<string>;
  now: number;
  weights?: SelectionWeights;
  tokenCost?: (change: Change) => number;
  maxDeferMs?: number;
}

export interface SelectionResult {
  included: Change[];
  summarized: Record<string, number>;
  truncated: boolean;
  cursor: number;
  tokensUsed: number;
}

export function estimateTokens(change: Change): number {
  return Math.ceil(JSON.stringify(change).length / 4);
}

function magnitude(change: Change): number {
  if (change.op === 'add' || change.op === 'remove' || change.op === 'move') return 1;
  const size = JSON.stringify(change.value ?? change.insert ?? '').length;
  return Math.min(1, size / 200);
}

export function score(change: Change, focus: ReadonlySet<string>, now: number, w: SelectionWeights): number {
  let s = 0;
  if (change.origin === 'user') s += w.user;
  if (change.conflict) s += w.conflict;
  if (focus.has(change.entry_id)) s += w.focus;
  const ageSec = Math.max(0, (now - change.ts) / 1000);
  s += w.recency / (1 + ageSec);
  s += w.magnitude * magnitude(change);
  return s;
}

function mustInclude(change: Change, focus: ReadonlySet<string>, now: number, maxDeferMs: number): boolean {
  return (
    Boolean(change.conflict) ||
    (change.origin === 'user' && focus.has(change.entry_id)) ||
    now - change.ts >= maxDeferMs
  );
}

export function select(input: SelectionInput): SelectionResult {
  const w = input.weights ?? DEFAULT_WEIGHTS;
  const cost = input.tokenCost ?? estimateTokens;
  const maxDeferMs = input.maxDeferMs ?? DEFAULT_MAX_DEFER_MS;
  const delivered = input.delivered ?? new Set<string>();
  const sorted = input.pending.slice().sort((a, b) => a.version - b.version);
  const fresh = sorted.filter((c) => !delivered.has(c.change_id));

  const always = fresh.filter((c) => mustInclude(c, input.focusEntries, input.now, maxDeferMs));
  const optional = fresh
    .filter((c) => !mustInclude(c, input.focusEntries, input.now, maxDeferMs))
    .map((c) => ({ c, s: score(c, input.focusEntries, input.now, w) }))
    .sort((a, b) => b.s - a.s);

  const includedIds = new Set<string>();
  let used = 0;
  for (const c of always) {
    includedIds.add(c.change_id);
    used += cost(c);
  }
  const truncated = used > input.budget;

  for (const { c } of optional) {
    const cc = cost(c);
    if (used + cc <= input.budget) {
      includedIds.add(c.change_id);
      used += cc;
    }
  }

  const included = fresh.filter((c) => includedIds.has(c.change_id));
  const summarized: Record<string, number> = {};
  for (const c of fresh) {
    if (!includedIds.has(c.change_id)) summarized[c.entry_id] = (summarized[c.entry_id] ?? 0) + 1;
  }

  let cursor = input.baseCursor;
  for (const c of sorted) {
    if (delivered.has(c.change_id) || includedIds.has(c.change_id)) cursor = c.version;
    else break;
  }

  return { included, summarized, truncated, cursor, tokensUsed: used };
}

export function shouldInterrupt(
  change: Change,
  agentEditing: ReadonlySet<string>,
  lastInterruptMs: number,
  now: number,
  minGapMs = 5000,
): boolean {
  if (now - lastInterruptMs < minGapMs) return false;
  return Boolean(change.conflict) || (change.origin === 'user' && agentEditing.has(change.entry_id));
}
