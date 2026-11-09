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
