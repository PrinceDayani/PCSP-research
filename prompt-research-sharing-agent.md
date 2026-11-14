# Prompt: Research Sharing Agent

You are a senior research engineer and protocol designer. You are being handed a research direction called PCSP, the Persistent Context Streaming Protocol. Read everything below, form your own understanding, and then decide for yourself what is worth doing with it. Nothing here tells you how to proceed. Use your own judgment and your own thinking process.

## 1. The problem

AI models work in stateless request-response turns. When a model is connected to a live tool, such as Adobe After Effects, the context about the tool's state has to be sent to the model again and again. Three things go wrong:

- **Token and memory waste.** The same state is re-sent every turn.
- **Blindness to live changes.** The model only learns that something changed in the tool session when it asks again. A human editing the project while the model works is invisible to it until the next request.
- **No shared memory of the session.** Nothing on the tool side persists the context the model has already seen, so every turn starts from scratch.

## 2. The idea

PCSP is a protocol in which context about a live session is shared once, kept alive on the tool side, and afterwards only small changes are streamed to the model. The model can see what is happening in the live session, including edits made by a human, without having to ask and without being re-sent the full state.

The protocol combines three pieces:

1. **Persistent session state** held on the tool-server side, so context is shared once.
2. **Delta streaming** of live session changes, including user edits, into the model's view.
3. **A context-selection layer** that decides what enters the model's context window each turn, under a token budget.

The intended outcome is fewer tokens, lower memory use, and a model that stays aware of the live session.

## 3. Target environment

The working environment is Adobe After Effects. You are to think about building the PCSP protocol itself for After Effects, starting from nothing. Assume no existing connector or prior implementation is available to you.

## 4. Design principles already decided

These are decisions, not suggestions to be re-litigated unless you find a strong reason.

- **The core specification is transport-neutral.** PCSP is a general persistent-context layer, not only a model-to-tool protocol. Its endpoints could be a model and a tool, two agents, or an agent and a human interface. Specific transports are treated as bindings of the core.
- **Two bindings are envisioned.** One maps PCSP onto the Model Context Protocol (MCP), which connects a model to tools and data. The other maps it onto the Agent2Agent protocol (A2A), which connects agents to other agents. The MCP binding is the primary one. The A2A binding is a smaller extension.
- **Per-participant cursors belong in the core.** Each participant tracks which state it has already seen, so that it receives only what it has not seen.
- **The word "protocol" must be earned.** That means a defined specification covering message types, session lifecycle, push rules, and context-selection rules, plus a working implementation and measured results.
- **Implementation language is TypeScript** for the server and protocol layer. Code that runs inside After Effects is constrained by its legacy scripting engine, which is an older JavaScript dialect.

## 5. Open gaps the work could address

1. **Telling user edits apart from agent edits.** Agents cannot reliably distinguish a human change from their own on a shared canvas, which leads to overwriting and reverting. Origin tagging of every change is a candidate approach.
2. **Fine-grained delta merging.** Replacing whole fields loses concurrent edits made inside the same field. Entry-level diffs are a candidate approach.
3. **Measuring state-diff streaming against full re-sends.** There is no clear benchmark of how much a diff-based approach saves.
4. **Trust and freshness of pushed context.** A live stream into a model's context raises questions of staleness, provenance and poisoning.
5. **Deciding which events deserve the model's attention.** Choosing what to push, what to batch, and what to hold under a token budget.

## 6. Open design questions

These are left for you to think about.

- What messages does the protocol need, and what is its session lifecycle?
- How are state, changes and the model's last-seen position represented and versioned?
- How should the protocol recover when the model's view is stale or a change is lost?
- How should rapid changes, such as dragging a layer, be coalesced?
- When should a change interrupt the model, and when should it wait?
- How should freshness and provenance be recorded and enforced?
- How can the design be evaluated fairly, and what should it be compared against?

## 7. Known limitations to respect

- The model itself is stateless. Something must still place the relevant context into its window each turn. PCSP changes where state lives and what is sent. It does not give the model true memory.
- Provider-side prompt caching already reduces the cost of repeated prompt prefixes, so any claimed saving must be weighed against it.
- A single-tool prototype does not prove generality.
- Novelty has not been verified by a systematic literature review. Do not assume the idea is untouched.

## 8. Related directions (out of scope for the first piece of work)

These connect to PCSP but are intended as separate efforts. Do not fold them in unless you judge it necessary.

- Benchmarks for state-diff cost and for edit awareness.
- Standard state schemas for creative tools.
- Security and trust of pushed persistent context.
- Event salience, meaning which events deserve a model's attention.
- Multi-agent sharing of one session, where specialist agents coordinate through a shared table of persistent state. This should not be called "mixture of experts", which has a different established meaning.
- Extension to other tool domains, and cooperation with inference-level caching.

## 9. What I want from you

Think independently. Tell me:

- What you understand PCSP to be, in your own words.
- What you think is strongest and weakest about the idea.
- What you would investigate or build first, and why.
- What risks or flaws you see that are not listed here.
- What you would need from me to go further.

Ask questions where the material is unclear or incomplete.
