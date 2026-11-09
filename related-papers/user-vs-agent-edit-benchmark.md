# Benchmark: User Edits Versus Agent Edits

## Idea
A benchmark that measures how often an agent overwrites, reverts or ignores human changes made while it works in a live shared session.

## Why a separate paper
It is useful without PCSP: any MCP server can be scored. A benchmark paper gets cited on its own.

## Link to PCSP
PCSP's origin tagging is one candidate fix. The benchmark gives PCSP an independent yardstick.

## Method sketch
- Scripted human edits injected at fixed times during agent tasks.
- Metrics: overwrite rate, revert rate, time to notice an edit, task success.
- Run across several creative-tool MCP servers.

## Closest existing work
- [When to Hand Off, When to Work Together](https://arxiv.org/html/2603.02050v5)
- [adb-mcp note on changes made during AI work](https://github.com/mikechambers/adb-mcp)
- [design-os-studio issue 75](https://github.com/jangtrinh/design-os-studio/issues/75)
