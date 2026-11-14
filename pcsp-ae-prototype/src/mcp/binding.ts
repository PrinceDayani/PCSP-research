import type { Change, Json } from './types.js';
import type { Session } from './session.js';
import type { StateStore } from './state-store.js';
import { StaleWriteError } from './state-store.js';
import { select } from './selection.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const PCSP_TOOLS: ToolDefinition[] = [
  { name: 'pcsp.open', description: 'Open a PCSP session and receive a snapshot', inputSchema: { type: 'object', properties: { consumer_id: { type: 'string' }, budget: { type: 'number' } }, required: ['consumer_id'] } },
  { name: 'pcsp.pull', description: 'Return deltas after the last delivered version', inputSchema: { type: 'object', properties: { consumer_id: { type: 'string' }, budget: { type: 'number' }, focus: { type: 'array', items: { type: 'string' } } }, required: ['consumer_id'] } },
  { name: 'pcsp.ack', description: 'Acknowledge a version', inputSchema: { type: 'object', properties: { consumer_id: { type: 'string' }, version: { type: 'number' } }, required: ['consumer_id', 'version'] } },
  { name: 'pcsp.resync', description: 'Request a fresh snapshot', inputSchema: { type: 'object', properties: { consumer_id: { type: 'string' } }, required: ['consumer_id'] } },
  { name: 'pcsp.resume', description: 'Resume from a last acknowledged version', inputSchema: { type: 'object', properties: { consumer_id: { type: 'string' }, last_version: { type: 'number' } }, required: ['consumer_id', 'last_version'] } },
  { name: 'pcsp.close', description: 'Close the session for a consumer', inputSchema: { type: 'object', properties: { consumer_id: { type: 'string' } }, required: ['consumer_id'] } },
];

export interface BindingResult {
  ok: boolean;
  data?: Json;
  error?: { code: string; message: string; current?: Json };
}

export class McpBinding {
  constructor(private readonly session: Session, private readonly store: StateStore) {}

  handle(name: string, args: Record<string, Json>, now: number): BindingResult {
    try {
      switch (name) {
        case 'pcsp.open': {
          const consumer_id = String(args.consumer_id);
          const accept = this.session.open(consumer_id, Number(args.budget ?? 2000), now);
          const snapshot = this.session.snapshotFor(consumer_id);
          return { ok: true, data: JSON.parse(JSON.stringify({ accept, snapshot })) };
        }
        case 'pcsp.pull': {
          const consumer_id = String(args.consumer_id);
          this.session.flush(now);
          const delta = this.session.deltaFor(consumer_id);
          if (!delta) return { ok: true, data: null };
          const focus = new Set<string>(Array.isArray(args.focus) ? args.focus.map(String) : []);
          const pending = delta.changes.map((change: Change, i: number) => ({ version: delta.base_version + i + 1, change }));
          const result = select({ pending, budget: Number(args.budget ?? 2000), focusEntries: focus, now });
          return { ok: true, data: JSON.parse(JSON.stringify({ delta: { ...delta, changes: result.included.map((p) => p.change) }, summarized: result.summarized, truncated: result.truncated, cursor: result.cursor })) };
        }
        case 'pcsp.ack':
          this.session.ack(String(args.consumer_id), Number(args.version), now);
          return { ok: true, data: null };
        case 'pcsp.resync':
          return { ok: true, data: JSON.parse(JSON.stringify(this.session.resync(String(args.consumer_id)))) };
        case 'pcsp.resume':
          return { ok: true, data: JSON.parse(JSON.stringify(this.session.resume(String(args.consumer_id), Number(args.last_version)))) };
        case 'pcsp.close':
          this.session.close(String(args.consumer_id));
          return { ok: true, data: null };
        default:
          return { ok: false, error: { code: 'unknown_tool', message: name } };
      }
    } catch (e) {
      if (e instanceof StaleWriteError) {
        return { ok: false, error: { code: 'stale_write', message: e.message, current: e.current } };
      }
      return { ok: false, error: { code: 'error', message: e instanceof Error ? e.message : String(e) } };
    }
  }
}
