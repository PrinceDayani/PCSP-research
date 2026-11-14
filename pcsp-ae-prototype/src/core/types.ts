export type Origin = 'user' | 'agent' | 'tool' | 'system';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface Entry {
  entry_id: string;
  type: string;
  properties: Record<string, Json>;
  children: string[];
  parent_id: string | null;
}

export interface StateTree {
  root_id: string;
  entries: Record<string, Entry>;
}

export type ChangeOp = 'add' | 'remove' | 'set' | 'move' | 'splice';

export interface Change {
  change_id: string;
  version: number;
  op: ChangeOp;
  entry_id: string;
  origin: Origin;
  ts: number;
  conflict?: boolean;
  path?: string;
  value?: Json;
  prev?: Json;
  parent_id?: string;
  index?: number;
  start?: number;
  delete_count?: number;
  insert?: Json;
  entry_type?: string;
}

export type MessageType =
  | 'open'
  | 'accept'
  | 'snapshot'
  | 'delta'
  | 'event'
  | 'ack'
  | 'resync'
  | 'resume'
  | 'heartbeat'
  | 'close'
  | 'error';

export interface BaseMessage {
  type: MessageType;
  session_id: string;
  sender: string;
  message_id: string;
}

export interface OpenMessage extends BaseMessage {
  type: 'open';
  consumer_id: string;
  requested_budget: number;
  ttl: number;
  capabilities: string[];
}

export interface AcceptMessage extends BaseMessage {
  type: 'accept';
  version: number;
  granted_budget: number;
  ttl: number;
  capabilities: string[];
}

export interface SnapshotMessage extends BaseMessage {
  type: 'snapshot';
  version: number;
  state: StateTree;
  schema_id: string;
}

export interface DeltaMessage extends BaseMessage {
  type: 'delta';
  base_version: number;
  version: number;
  changes: Change[];
}

export interface EventMessage extends BaseMessage {
  type: 'event';
  version: number;
  kind: string;
  payload: Json;
  origin: Origin;
}

export interface AckMessage extends BaseMessage {
  type: 'ack';
  version: number;
}

export interface ResyncMessage extends BaseMessage {
  type: 'resync';
  last_version: number;
  reason: string;
}

export interface ResumeMessage extends BaseMessage {
  type: 'resume';
  last_version: number;
}

export interface HeartbeatMessage extends BaseMessage {
  type: 'heartbeat';
  version: number;
}

export interface CloseMessage extends BaseMessage {
  type: 'close';
  reason: string;
}

export interface ErrorMessage extends BaseMessage {
  type: 'error';
  code: string;
  message: string;
  retryable: boolean;
}

export type PcspMessage =
  | OpenMessage
  | AcceptMessage
  | SnapshotMessage
  | DeltaMessage
  | EventMessage
  | AckMessage
  | ResyncMessage
  | ResumeMessage
  | HeartbeatMessage
  | CloseMessage
  | ErrorMessage;

export type SessionState = 'OPEN' | 'ACTIVE' | 'STALE' | 'RESYNCING' | 'EXPIRED' | 'CLOSED';
