# Security and Trust of Pushed Persistent Context

## Idea
A threat model for a live stream that writes into the model's context: injection through tool state, stale state overriding fresh observation, and provenance gaps.

## Why a separate paper
Security needs its own attack experiments and defenses. It would crowd the protocol paper.

## Link to PCSP
PCSP's freshness and provenance fields are the proposed mitigations to test.

## Method sketch
- Threat model for pushed deltas.
- Attack set: poisoned tool state, replayed old deltas, forged origin tags.
- Evaluate defenses: signed deltas, expiry, trust tiers.

## Closest existing work
- [Always-On Agents survey](https://arxiv.org/html/2606.30306v1)
- [From Untrusted Input to Trusted Memory](https://arxiv.org/html/2606.04329v1)
- [MemoryGraft](https://arxiv.org/abs/2512.16962)
- [MCPSecBench](https://arxiv.org/html/2508.13220v3)
- [Portable Agent Memory protocol](https://arxiv.org/html/2605.11032v1)
