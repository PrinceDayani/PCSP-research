import { randomUUID } from 'node:crypto';
import type { DeltaMessage, Json } from '../core/types.js';
import { ResyncRequiredError, type Session } from '../core/session.js';
import { select } from '../core/selection.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const consumerOnly = { type: 'object', properties: { consumer_id: { type: 'string' } }, required: ['consumer_id'] };

export const PCSP_TOOLS: ToolDefinition[] = [
  { name: 'pcsp.open', description: 'Open a PCSP session and receive a snapshot', inputSchema: { type: 'object', properties: { consumer_id: { type: 'string' }, budget: { type: 'number' } }, required: ['consumer_id'] } },
  { name: 'pcsp.pull', description: 'Return selected deltas after the delivery cursor', inputSchema: { type: 'object', properties: { consumer_id: { type: 'string' }, budget: { type: 'number' }, focus: { type: 'array', items: { type: 'string' } } }, required: ['consumer_id'] } },
  { name: 'pcsp.ack', description: 'Acknowledge a delivered version', inputSchema: { type: 'object', properties: { consumer_id: { type: 'string' }, version: { type: 'number' } }, required: ['consumer_id', 'version'] } },
  { name: 'pcsp.heartbeat', description: 'Keep the session alive', inputSchema: consumerOnly },
  { name: 'pcsp.resync', description: 'Request a fresh snapshot', inputSchema: consumerOnly },
  { name: 'pcsp.resume', description: 'Resume from a last acknowledged version', inputSchema: { type: 'object', properties: { consumer_id: { type: 'string' }, last_version: { type: 'number' } }, required: ['consumer_id', 'last_version'] } },
  { name: 'pcsp.close', description: 'Close the session for a consumer', inputSchema: consumerOnly },
];

export interface BindingResult {
  ok: boolean;
  data?: Json;
  error?: { code: string; message: string };
}

function text(args: Record<string, Json>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value === '') throw new Error(`${key} must be a non-empty string`);
  return value;
}

function num(args: Record<string, Json>, key: string, fallback?: number): number {
  const value = args[key];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a number`);
  return value;
}

function ok(data: unknown): BindingResult {
  return { ok: true, data: data === null ? null : (JSON.parse(JSON.stringify(data)) as Json) };
}

export class McpBinding {
  constructor(private readonly session: Session) {}

  handle(name: string, args: Record<string, Json>, now: number): BindingResult {
    try {
      switch (name) {
        case 'pcsp.open': {
          const consumer_id = text(args, 'consumer_id');
          const accept = this.session.open(consumer_id, num(args, 'budget', 2000), now);
          const snapshot = this.session.snapshotFor(consumer_id);
          return ok({ accept, snapshot });
        }
        case 'pcsp.pull':
          return this.pull(args, now);
        case 'pcsp.ack':
          this.session.ack(text(args, 'consumer_id'), num(args, 'version'), now);
          return ok(null);
        case 'pcsp.heartbeat':
          return ok(this.session.heartbeat(text(args, 'consumer_id'), now));
        case 'pcsp.resync':
          return ok(this.session.resync(text(args, 'consumer_id')));
        case 'pcsp.resume':
          return ok(this.session.resume(text(args, 'consumer_id'), num(args, 'last_version'), now));
        case 'pcsp.close':
          this.session.close(text(args, 'consumer_id'));
          return ok(null);
        default:
          return { ok: false, error: { code: 'unknown_tool', message: name } };
      }
    } catch (e) {
      if (e instanceof ResyncRequiredError) return { ok: false, error: { code: 'resync_required', message: e.message } };
      return { ok: false, error: { code: 'error', message: e instanceof Error ? e.message : String(e) } };
    }
  }

  private pull(args: Record<string, Json>, now: number): BindingResult {
    const consumer_id = text(args, 'consumer_id');
    this.session.touch(consumer_id, now);
    this.session.flush(now);
    const view = this.session.pendingFor(consumer_id);
    if (!view || view.pending.length === 0) return ok(null);
    const budget = Math.min(num(args, 'budget', view.budget), view.budget);
    const focus = new Set<string>(Array.isArray(args.focus) ? args.focus.map(String) : []);
    const result = select({
      pending: view.pending,
      delivered: view.delivered,
      baseCursor: view.base,
      budget,
      focusEntries: focus,
      now,
    });
    const cursor = this.session.commit(consumer_id, result.included, now);
    const delta: DeltaMessage = {
      type: 'delta',
      session_id: this.session.session_id,
      sender: 'source',
      message_id: randomUUID(),
      base_version: view.base,
      version: result.included.length ? result.included[result.included.length - 1].version : cursor,
      changes: result.included,
    };
    return ok({ delta, summarized: result.summarized, truncated: result.truncated, cursor });
  }
}
