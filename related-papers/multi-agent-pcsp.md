# Multi-Agent PCSP

## Idea
Several agents (and humans) share one persistent session, each with its own view cursor, so each receives only the deltas it has not yet seen.

## Why a separate paper
Concurrency, conflict resolution and fairness add a large design space.

## Link to PCSP
Extends per-session cursors in the core spec to per-participant cursors.

## Method sketch
- Per-agent subscriptions and cursors.
- Conflict handling with CRDT-style merging or claims.
- Measure token savings as agent count grows.

## Closest existing work
- [AgentRoom](https://arxiv.org/html/2608.23740v1)
- [Multi-agent Collaboration with State Management](https://arxiv.org/html/2605.20563v1)
- [Enhancing MCP with Context-Aware Server Collaboration](https://arxiv.org/html/2601.11595v2)
- [SAMEP](https://arxiv.org/abs/2507.10562)

## Shared blackboard (added)
Several specialist agents (for example motion, colour and audio) work around one shared table, which is the persistent PCSP session. Every agent reads and writes through deltas, and each receives only the changes relevant to its role. A coordinator decides which agent acts next on the user's task.

## Naming note
Do not call this "mixture of experts". That term already means a router activating sub-networks inside a single model. Use "multi-agent system with specialist agents" or "shared blackboard architecture" (the classic term for agents coordinating through a common table).

## Over A2A
A2A is the agent-to-agent protocol. This paper would be PCSP's second binding: instead of agents passing whole messages and task results, they share live state and receive deltas. Verify what A2A already offers for streaming and task state before claiming a gap.

## Scope decision
Kept as its own paper (paper C), not merged into the core paper. The core paper gets only a short extension section and per-participant cursors in the spec. Reason: coordination, conflict handling and agent roles need separate experiments, and one overloaded paper would prove none of them well.

## Added expected contribution
Token savings as agent count grows, with origin tags on every delta, compared against agents exchanging full messages. Prior work to differentiate from: AgentRoom and Multi-agent Collaboration with State Management.
