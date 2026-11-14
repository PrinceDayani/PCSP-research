import type { Change, StateTree } from '../core/types.js';
import { estimateTokens } from '../core/selection.js';

export function fullStateTokens(state: StateTree): number {
  return Math.ceil(JSON.stringify(state).length / 4);
}

export function deltaTokens(changes: Change[]): number {
  return changes.reduce((sum, c) => sum + estimateTokens(c), 0);
}

export interface TurnRecord {
  turn: number;
  baselineTokens: number;
  pcspTokens: number;
}

export function summarize(turns: TurnRecord[]): { baselineTotal: number; pcspTotal: number; savedPercent: number } {
  const baselineTotal = turns.reduce((s, t) => s + t.baselineTokens, 0);
  const pcspTotal = turns.reduce((s, t) => s + t.pcspTokens, 0);
  const savedPercent = baselineTotal === 0 ? 0 : ((baselineTotal - pcspTotal) / baselineTotal) * 100;
  return { baselineTotal, pcspTotal, savedPercent };
}
