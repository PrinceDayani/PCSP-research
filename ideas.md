# PCSP Paper Ideas

Ideas to compose into the main PCSP paper. Sources and evidence are in [docs/RESEARCH.md](docs/RESEARCH.md) and [docs/SOURCES.md](docs/SOURCES.md). Ideas that belong in a separate paper live in [related-papers/](related-papers/).

## 1. Core contribution
One protocol that combines three things that exist only separately today:
- Persistent session state held on the tool-server side, context shared once.
- Delta streaming of live session changes into the model's view.
- A context-selection layer that decides what enters the model's window each turn under a token budget.

## 2. Protocol specification (earns the word "protocol")
- Session lifecycle: open, resume, expire, close.
- Message types: snapshot, delta, ack, resync, event.
- Versioning and cursors so the model and server agree on the last state seen.
- Resync rule when the model's view is stale or a delta is lost.
- Transport mapping onto MCP (Streamable HTTP with SSE, and the subscriptions/listen stream).
- Compatibility with MCP Events instead of replacing it. State clearly how PCSP differs.

## 3. Delta format
- Entry-level diffs instead of whole-field replacement, so concurrent edits inside one field both survive.
- Compact structured diff of scene state (for example an After Effects composition tree) rather than a full re-read.
- Token cost comparison of delta versus full re-send.

## 4. Origin tagging: user edits versus agent edits
- Every change carries an origin (user, agent, tool, system).
- Lets the model avoid reverting or misreading the user's work.
- Evaluated by edit-conflict rate against plain MCP.

## 5. Context-selection layer
- Salience scoring: which changes are worth the model's attention.
- Batching and coalescing of rapid changes (for example dragging a layer) into one delta.
- Token budget enforcement with graceful degradation to summaries.
- Interrupt versus defer policy: push now, or hold until the next turn.

## 6. Freshness and trust
- Staleness markers so old state cannot override fresh observation.
- Provenance on every delta.
- Treat pushed context as untrusted input, with limits on what a stream can inject.

## 7. Reference implementation
- One After Effects MCP server with a PCSP layer, using an existing open-source After Effects MCP server as the baseline.
- Same tasks run twice: plain MCP and PCSP.

## 8. Evaluation plan
- Tokens per task, total and per turn.
- Latency per turn.
- Task success rate.
- Edit-conflict and overwrite rate when a human edits mid-session.
- Ablations: persistence only, deltas only, selection only, all three.
- Scenario sweep: small, medium and large scenes; slow and fast human edits.

## 9. Related-work positioning
Cite and differentiate from: MCP Events, the asynchronous interrupt paper, Context-Aware MCP, stateful inference (KV cache level), and provider prompt caching. Claim novelty only for the combination plus measured results.

## 10. Limitations to state honestly
- The model itself is stateless, so something must still place context in the window each turn.
- Prompt caching already reduces cost for repeated prefixes, so compare against it.
- Prototype covers one tool; generality is future work.

## 11. Scope guard
Keep the main paper to ideas 1 to 5 plus the evaluation. Security depth, multi-agent sharing, and other directions go to [related-papers/](related-papers/).
