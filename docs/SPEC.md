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

## 5. Delta format

A delta carries a list of changes. Each change addresses one entry and one property path, so two edits inside the same field do not overwrite each other.

Change fields: op, entry_id, path, value, prev, origin, ts, change_id.

Operations:
- add: create an entry under a parent. Fields: parent_id, index, value.
- remove: delete an entry. Fields: entry_id.
- set: set a property at path. Fields: path, value, prev.
- move: reparent or reorder an entry. Fields: entry_id, parent_id, index.
- splice: insert or delete a range inside a list or string property. Fields: path, start, delete_count, insert. This is the entry-level operation that preserves concurrent edits inside one field.

Rules:
1. prev is the value the Source held before the change. A Consumer MAY use it to detect that its local view differs from the Source.
2. Changes inside one delta apply in order.
3. The Source MUST emit the same change_id only once. A Consumer MUST ignore a duplicate change_id.
4. If two changes from different origins touch the same entry and path within one coalescing window, the Source MUST emit both with their origins and MUST NOT merge them silently.

### 5.1 Coalescing
Rapid changes to the same entry and path, for example dragging a layer, are coalesced. The Source holds changes for a coalescing window (default 250 ms, negotiable in open) and emits one set whose value is the latest and whose prev is the value before the first change in the window. The final change in a burst MUST be flushed when the burst ends or when the window's maximum hold time (default 2 s) is reached.

## 6. Origin and conflict handling

1. Origin values: user (a human acted in the tool), agent (the Consumer's own tool call), tool (the tool changed state by itself, for example an automatic recalculation), system (session management).
2. When the Consumer makes a call through the Source, the Source tags the resulting changes origin agent and returns the new version in the call result. The Consumer SHOULD ack that version so its own changes are not re-reported as news.
3. A change with origin user that lands on an entry the agent modified in the same or the previous version is a conflict. The Source MUST mark that change conflict true.
4. On a conflict the Consumer SHOULD NOT revert or overwrite the user change without asking, and SHOULD surface the conflict in its next response.
5. An agent write MAY carry expected_version. If the entry changed after that version by a different origin, the Source MUST reject the write with error code stale_write and return the current entry value.

## 7. Freshness

1. Every snapshot and delta carries version and ts.
2. The Consumer tracks last_applied_version and last_message_ts. If now minus last_message_ts exceeds the ttl and no heartbeat arrived, the Consumer MUST mark its view STALE.
3. Any context derived from state, for example a summary the Consumer cached, MUST record the version it was derived from. If the entry has changed since that version, the Consumer MUST treat the derived context as stale and refresh or drop it before use.
4. A Consumer in STALE state MUST NOT present session state to the model as current. It MUST either resync first or label the state as possibly outdated.

## 8. Context selection

The selection layer decides what part of the shared state and the pending deltas enters the model's window on a given turn. It runs on the Consumer side with inputs supplied by the Source.

### 8.1 Inputs
- budget: maximum tokens for session context on this turn, granted in accept and adjustable per turn.
- pending: deltas and events with version greater than the model's last seen version.
- salience hints: per change fields from the Source: kind, entry depth, whether it intersects the current selection or focus in the tool, and origin.

### 8.2 Salience score
Each pending change gets a score from these factors, weights set by configuration: origin user highest, conflict true highest, intersection with the entry the current task refers to, recency, and magnitude of change. The Source MAY include a salience_hint, but the Consumer decides.

### 8.3 Algorithm
1. Coalesce pending changes per entry and path.
2. Score each change.
3. Always include: conflicts, user-origin changes on entries referenced by the task, and errors.
4. Fill the remaining budget in descending score order.
5. Changes that do not fit are summarized as counts per entry type, for example 14 property changes on 6 layers, and kept pending. They are not dropped.
6. Included changes are marked delivered. The model's cursor advances only to the highest version fully delivered with nothing skipped before it. Summarized changes remain retrievable by a read request on the entry.

### 8.4 Delivery timing
- defer: default. Pending context is placed in the window at the start of the next turn.
- interrupt: allowed only for conflict true changes, user-origin changes on the entry the agent is currently editing, and errors. An interrupt MUST respect a minimum gap between interrupts (default 5 s) to avoid flooding.

### 8.5 Budget degradation
If the budget is smaller than the always-include set, the layer sends the always-include set as compact entries and sets truncated true, so the model knows context was cut. The layer MUST NOT silently drop an always-include change.

## 9. Trust and limits

1. Streamed state is untrusted input. Text values from the tool, for example layer names or expressions, MUST be passed to the model as data, not instructions.
2. The Source MUST cap delta size, change count per delta and event rate, and reject or coalesce beyond the cap.
3. Every change keeps its origin and change_id so it can be audited.

## 10. MCP binding

1. Capability: the server advertises a pcsp capability in initialize, with supported versions and limits.
2. Session open and close map to tools or requests named pcsp.open and pcsp.close.
3. Snapshot: returned as the result of pcsp.open or pcsp.resync.
4. Deltas and events: delivered over the Streamable HTTP SSE stream or the subscriptions/listen stream where the client supports it. A client without push support polls with pcsp.pull, which returns deltas after a given version.
5. ack, resync, resume and heartbeat map to pcsp.ack, pcsp.resync, pcsp.resume and pcsp.heartbeat.
6. Compatibility: PCSP deltas MAY be carried as the payload of MCP Events. PCSP adds cursors, origin, conflict marking and selection on top of event delivery and does not replace it.

## 11. Out of scope for this draft

- A2A binding details beyond the per-participant cursor hook.
- Multi-writer merge beyond the conflict marking in section 6.
- Inference-level KV cache cooperation.
- Authentication and authorization, which are inherited from the transport.

## 12. Open items to settle before implementation

- Exact value of default coalescing window and interrupt gap, to be tuned by experiment.
- Schema format for state trees per tool, starting with After Effects compositions.
- Whether pcsp.pull should be mandatory for all Sources.
