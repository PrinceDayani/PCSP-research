# Benchmark: Delta State Versus Full Re-Send in MCP

## Idea
Measure the token and latency cost of sending state diffs against re-sending full state, across tool types and scene sizes.

## Why a separate paper
The measurement stands alone and needs no new protocol. It also gives PCSP a baseline.

## Link to PCSP
Supplies the evidence for the delta format and a fair comparison point.

## Method sketch
- Record real tool sessions, replay them with full re-send and with diffs.
- Vary state size and edit frequency.
- Compare against provider prompt caching.

## Closest existing work
- [Notation Matters: Token-Optimized Formats](https://arxiv.org/html/2605.29676v1)
- [Network and Systems Performance Characterization of MCP-Enabled LLM Agents](https://arxiv.org/html/2511.07426)
- [Don't Break the Cache](https://arxiv.org/html/2601.06007v2)
- [Stateful Inference for Low-Latency Multi-Agent Tool Calling](https://arxiv.org/abs/2605.26289)
