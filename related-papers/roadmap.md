# PCSP Paper Roadmap

Decision: a series of six papers. The core paper is being written now. Rule used for bundling: one paper has one main claim and one evaluation setup.

## Core paper (written first)
PCSP: the Persistent Context Streaming Protocol.
- Main claim: persistent session state, delta streaming of live changes, and a context-selection layer, combined in one protocol.
- Evaluation: one After Effects prototype over MCP against plain MCP and prompt caching. Metrics: tokens, latency, task success, edit-conflict rate, with ablations.
- Spec is written layer-neutral. A short extension section (about half a page) mentions the A2A binding and multi-agent sharing as future work. Per-participant cursors are included in the spec.
- Where to start: write the spec first (message types, session lifecycle, cursors, resync, delta format, origin tags, selection rules), then build the prototype, then write the prose.

## Paper A: benchmark and schema
Bundles three separate-paper ideas that share the same After Effects recordings and replay setup:
- Delta state versus full re-send token benchmark ([file](delta-state-token-benchmark.md)).
- User versus agent edit awareness benchmark ([file](user-vs-agent-edit-benchmark.md)).
- Standard state schemas for creative tools ([file](creative-tool-state-schemas.md)).

## Paper B: trust and attention
Bundles two ideas about what a live stream is allowed to push into the model, one for safety and one for relevance:
- Security and trust of pushed persistent context ([file](pushed-context-security.md)).
- Event salience: which events deserve the model's attention ([file](event-salience-for-agents.md)).

## Paper C: multi-agent PCSP over A2A
Kept on its own because it needs coordination experiments nothing else shares. Shared-blackboard design with specialist agents ([file](multi-agent-pcsp.md)). Not called "mixture of experts".

## Paper D: journal extension
Breadth: show PCSP works in other domains beyond creative software (for example CAD, IDEs, spreadsheets) with the same protocol and a similar evaluation. Cheap because it extends the core work. Depends on the core paper's results.

## Paper E: KV cache integration
Depth: make PCSP and the serving layer cooperate through inference-level KV cache reuse. Needs a modified inference engine and GPU experiments, so it can wait or go to a collaborator with inference-systems experience. Depends on earlier results.

## Why D and E are not merged
Different claims and experiments. D is breadth across domains. E is depth in the serving layer, with different skills, setups and reviewers.

## Caveat
Each paper needs its own prior-work check, since this area moves fast. Novelty is not verified beyond web searches.
