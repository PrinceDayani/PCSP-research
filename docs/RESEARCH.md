# PCSP Research Findings

PCSP: Persistent Context Streaming Protocol.

## Concept

Agents and MCP tool servers currently work in stateless request-response turns. Context is re-sent every turn, and the model only learns about live changes in a tool session when it asks again. PCSP proposes:

1. Persistent session state held on the tool-server side, with context shared once.
2. Delta streaming of live session changes (including user edits) into the model's view.
3. A context-selection layer that decides what enters the model's window each turn, under a token budget.

Reference scenario: Adobe After Effects connected to Claude through an MCP server.

## Name check

An exact-phrase search for "Persistent Context Streaming Protocol" returned no results at the time of searching. "Protocol" is justified only if the paper defines a spec: message types, session lifecycle, push rules, and context-selection rules, plus a working implementation and measured results.

## Closest existing work

### Push and event delivery in MCP
- [MCP Events, SEP-3415 (draft extension)](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415): lets a client subscribe to events from an upstream system.
- [MCP Events design sketch](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/main/docs/design-sketch-proposal.md): subscription model and delivery modes (poll, push, webhook).
- [The 2026-07-28 MCP specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/): change notifications move to a single subscriptions/listen stream.
- [MCP roadmap](https://modelcontextprotocol.io/development/roadmap): channels and subscriptions for push delivery.
- [Sanity: The dream of real-time MCP](https://www.sanity.io/engineering/the-dream-of-real-time-mcp): MCP Events streaming content changes and presence to an agent harness.
- [MCP Pulse](https://github.com/kohli6/mcp-pulse): demo of streaming live context to agents via MCP, Kafka and WebSockets.

### Interrupting the model with live events
- [Building Interactive Real-Time Agents with Asynchronous I/O and Speculative Tool Calling](https://arxiv.org/html/2605.13360v1): central event queue that interrupts the model and injects information into its context.
- [Asynchronous Tool Usage for Real-Time Agents](https://arxiv.org/html/2410.21620v1)
- [Revisable by Design: A Theory of Streaming LLM Agent Execution](https://arxiv.org/html/2604.23283v1): argues existing work is turn-based and lacks a bidirectional non-blocking channel.
- [LLMs are General Asynchronous Agents](https://arxiv.org/html/2609.35427v1)

### Persistent state and token savings
- [Remember, Don't Re-read: Stateful ReAct Agents](https://arxiv.org/abs/2606.14945): 52% fewer tokens on code optimization at comparable quality.
- [Stateful Inference for Low-Latency Multi-Agent Tool Calling](https://arxiv.org/abs/2605.26289): delta-only cost via a persistent KV cache (inference-server level).
- [Enhancing MCP with Context-Aware Server Collaboration](https://arxiv.org/html/2601.11595v2): shared context store for MCP servers.
- [MCP Server Architecture Patterns for LLM-Integrated Applications](https://arxiv.org/html/2606.30317v1): stateful session pattern for MCP.
- [Concord: When Agent Context Goes Stale](https://arxiv.org/html/2610.05281): links each tool observation to its source, detects source changes, and updates, annotates or suppresses stale context before reuse. Closest work to PCSP's freshness idea; it keeps context consistent but does not stream live deltas or select what reaches the model.
- [TokenPilot: Cache-Efficient Context Management for LLM Agents](https://arxiv.org/html/2606.17016v1)
- [Don't Break the Cache: Prompt Caching for Long-Horizon Agentic Tasks](https://arxiv.org/html/2601.06007v2)
- [SAMEP: Secure Protocol for Persistent Context Sharing Across AI Agents](https://arxiv.org/abs/2507.10562)
- [ChainStream: Stream-based LLM Agent Framework](https://doi.org/10.1145/3662006.3662063)
- [Memori: Persistent Memory Layer for LLM Agents](https://arxiv.org/abs/2603.19935)

### Human and agent concurrent editing
- [When to Hand Off, When to Work Together](https://arxiv.org/html/2603.02050v5): agent could not distinguish user from agent actions, causing conflicts.
- [AgentRoom: Concurrent Multi-Agent Coding in a CRDT-Backed Shared Workspace](https://arxiv.org/html/2608.23740v1)
- [Multi-agent Collaboration with State Management](https://arxiv.org/html/2605.20563v1)
- [Collaborative Document Editing with Multiple Users and AI Agents](https://arxiv.org/html/2509.11826)

### Creative-tool MCP servers (After Effects and related)
- [adb-mcp (Adobe apps)](https://github.com/mikechambers/adb-mcp): notes that changes made in the apps during AI work must be reported to the AI manually.
- [aftereffects-mcp (Immersive Media Technologies)](https://github.com/Immersive-Media-Technologies/aftereffects-mcp)
- [after-effects-mcp (HeroicSwan)](https://github.com/HeroicSwan/after-effects-mcp)
- [after-effects-mcp (JUNKDOGE-JOE)](https://github.com/JUNKDOGE-JOE/after-effects-mcp)

### Provenance and attribution
- [Beyond Memory: A Templated Substrate for Heterogeneous Collaborative Knowledge Work with LLM Agents](https://arxiv.org/html/2607.24759v1): by-human-via-agent attribution line used as an awareness primitive across sessions.
- [From Agent Traces to Trust: Evidence Tracing and Execution Provenance in LLM Agents](https://arxiv.org/html/2606.04990v6)
- [When Agents Write Live Storefronts](https://www.laioutr.com/en/blog/agent-driven-edits-change-provenance-frontend-layer): provenance captured before an agent write is applied.

## Open gaps

1. **User edits versus agent edits.** Agents cannot reliably tell the two apart on a shared canvas. See [When to Hand Off, When to Work Together](https://arxiv.org/html/2603.02050v5).
2. **Fine-grained delta merging.** Whole-field replacement loses concurrent edits inside the same field. See [design-os-studio issue 75](https://github.com/jangtrinh/design-os-studio/issues/75).
3. **Delta encoding of tool state for token savings.** No benchmark found comparing state-diff streaming against full re-sends in MCP.
4. **Security of pushed persistent context.** Staleness, provenance and poisoning of a live stream. Staleness handling overlaps with [Concord: When Agent Context Goes Stale](https://arxiv.org/html/2610.05281), so differentiate from it. See [Always-On Agents survey](https://arxiv.org/html/2606.30306v1) and [Memory poisoning study](https://arxiv.org/html/2606.04329v1).
5. **Which events deserve the model's attention.** Proactive-agent work decides when to intervene but is not tied to MCP sessions with a token budget. See [Do Proactive Agents Need an LLM to Decide When to Act?](https://arxiv.org/abs/2605.30152).

## Suggested scope

Build PCSP around gaps 1 to 3, measured on one After Effects prototype against plain MCP (tokens, latency, edit-conflict rate). Treat gap 4 as a smaller section.

## Caveat

Findings come from web searches, not a systematic literature review. Verify novelty on Google Scholar and arXiv before claiming it.
