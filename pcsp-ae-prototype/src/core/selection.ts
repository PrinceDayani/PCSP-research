import type { Change } from './types.js';

export interface SelectionWeights {
  user: number;
  conflict: number;
  focus: number;
  recency: number;
  magnitude: number;
}

export const DEFAULT_WEIGHTS: SelectionWeights = { user: 5, conflict: 10, focus: 4, recency: 2, magnitude: 1 };

export interface SelectionInput {
  pending: { version: number; change: Change }[];
  budget: number;
  focusEntries: Set<string>;
  now: number;
  weights?: SelectionWeights;
  tokenCost?: (change: Change) => number;
}

export interface SelectionResult {
  included: { version: number; change: Change }[];
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

export function score(change: Change, focus: Set<string>, now: number, w: SelectionWeights): number {
  let s = 0;
  if (change.origin === 'user') s += w.user;
  if (change.conflict) s += w.conflict;
  if (focus.has(change.entry_id)) s += w.focus;
  const ageSec = Math.max(0, (now - change.ts) / 1000);
  s += w.recency / (1 + ageSec);
  s += w.magnitude * magnitude(change);
  return s;
}

function mustInclude(change: Change, focus: Set<string>): boolean {
  return Boolean(change.conflict) || (change.origin === 'user' && focus.has(change.entry_id));
}

export function select(input: SelectionInput): SelectionResult {
  const w = input.weights ?? DEFAULT_WEIGHTS;
  const cost = input.tokenCost ?? estimateTokens;
  const sorted = input.pending.slice().sort((a, b) => a.version - b.version);

  const always = sorted.filter((p) => mustInclude(p.change, input.focusEntries));
  const rest = sorted
    .filter((p) => !mustInclude(p.change, input.focusEntries))
    .map((p) => ({ p, s: score(p.change, input.focusEntries, input.now, w) }))
    .sort((a, b) => b.s - a.s);

  const includedSet = new Set<number>();
  let used = 0;
  let truncated = false;

  for (const p of always) {
    includedSet.add(p.version);
    used += cost(p.change);
  }
  if (used > input.budget) truncated = true;

  for (const { p } of rest) {
    const c = cost(p.change);
    if (used + c <= input.budget) {
      includedSet.add(p.version);
      used += c;
    }
  }

  const included = sorted.filter((p) => includedSet.has(p.version));
  const summarized: Record<string, number> = {};
  for (const p of sorted) {
    if (!includedSet.has(p.version)) {
      const key = p.change.entry_id;
      summarized[key] = (summarized[key] ?? 0) + 1;
    }
  }

  let cursor = sorted.length ? sorted[0].version - 1 : 0;
  for (const p of sorted) {
    if (includedSet.has(p.version)) cursor = p.version;
    else break;
  }

  return { included, summarized, truncated, cursor, tokensUsed: used };
}

export function shouldInterrupt(change: Change, agentEditing: Set<string>, lastInterruptMs: number, now: number, minGapMs = 5000): boolean {
  if (now - lastInterruptMs < minGapMs) return false;
  return Boolean(change.conflict) || (change.origin === 'user' && agentEditing.has(change.entry_id));
}
