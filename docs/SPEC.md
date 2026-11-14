# PCSP Core Specification

PCSP: Persistent Context Streaming Protocol. Draft 0.1.

## 1. Scope

PCSP is a transport-neutral layer for sharing the state of a live session once, keeping it persistent on the state-holder side, and streaming only deltas afterward. Endpoints are a Source (holds state, for example an After Effects MCP server) and a Consumer (receives state, for example a model host). Transport bindings are separate from the core. Binding 1 is MCP. Binding 2 is A2A and is out of scope for the first paper beyond a short extension note.

Key words MUST, SHOULD and MAY follow RFC 2119.

## 2. Data model

### 2.1 Session
A session is identified by session_id. The Source owns the authoritative state. The state is a tree of entries. Each entry has an entry_id, a type, a properties map, and child entry_ids.

### 2.2 Version
The Source keeps a monotonically increasing integer version. Every accepted change increments it by one. A snapshot carries the version it reflects.

### 2.3 Cursor
Each participant has its own cursor. A cursor is the highest version that participant has acknowledged. The Source MUST NOT assume a Consumer has seen a version until it is acknowledged. Cursors are per participant so more than one Consumer can attach to one session.

### 2.4 Origin tag
Every change carries an origin with one of four values: user, agent, tool, system. The Source MUST set origin. A Consumer MUST NOT overwrite it.

## 3. Session lifecycle

States: OPEN, ACTIVE, STALE, RESYNCING, EXPIRED, CLOSED.

1. OPEN: Consumer sends open. Source replies with accept containing session_id, current version and the selection budget it will honor.
2. ACTIVE: Source sends one snapshot, Consumer acknowledges it, then only deltas flow.
3. STALE: entered when the Consumer detects a version gap or the Source reports that history before a version is unavailable.
4. RESYNCING: Consumer sends resync. Source replies with a fresh snapshot. On acknowledgement the session returns to ACTIVE.
5. EXPIRED: no message or heartbeat within the negotiated ttl. The Source MAY discard state after expiry.
6. CLOSED: either side sends close.

A closed or expired session MAY be resumed with resume and the last acknowledged version. If the Source still holds history from that version, it replies with the missed deltas. Otherwise it replies with a snapshot.

## 4. Message types

All messages carry: type, session_id, sender, message_id. Messages that refer to state also carry version.

- open: Consumer to Source. Fields: consumer_id, requested_budget, ttl, capabilities.
- accept: Source to Consumer. Fields: version, granted_budget, ttl, capabilities.
- snapshot: Source to Consumer. Fields: version, state (full tree), schema_id.
- delta: Source to Consumer. Fields: base_version, version, changes (see section 5).
- event: Source to Consumer. Fields: version, kind, payload, origin. Used for things that are not state changes, for example a render finished.
- ack: Consumer to Source. Fields: version. Advances that Consumer's cursor.
- resync: Consumer to Source. Fields: last_version, reason.
- resume: Consumer to Source. Fields: last_version.
- heartbeat: either direction. Fields: version.
- close: either direction. Fields: reason.
- error: either direction. Fields: code, message, retryable.

A delta is valid only if its base_version equals the Consumer's last applied version. Otherwise the Consumer MUST enter STALE and send resync.
