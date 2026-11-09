# Event Salience: Which Events Deserve the Model's Attention

## Idea
A learned or rule-based policy that decides which live events interrupt the model, which wait, and which are dropped, under a token budget.

## Why a separate paper
It is a modelling problem with its own datasets and metrics, beyond the protocol.

## Link to PCSP
PCSP's context-selection layer is a simple version. This paper would study stronger policies.

## Method sketch
- Collect human-labelled event importance from creative sessions.
- Compare heuristics, small classifiers and LLM judges on cost and accuracy.

## Closest existing work
- [Do Proactive Agents Need an LLM to Decide When to Act?](https://arxiv.org/abs/2605.30152)
- [Proactive Agent](https://arxiv.org/html/2410.12361v3)
- [Building Interactive Real-Time Agents with Asynchronous I/O](https://arxiv.org/html/2605.13360v1)
