# Atlas Multi-Mode Local Assistant — Design Spec

**Status:** Direction approved; detailed subsystem contracts require review before implementation

**Date:** 2026-09-29

## Current phase and status

Atlas is an Electron/React desktop client with a local FastAPI backend. Provider and model selection are currently manual. The backend can discover models from an already-running OpenAI-compatible local service, stores conversation memory in SQLite, and exposes a per-thread entity graph API.

The UI has Search, Research, Write/Code, and Plan entries, but these are not a shared execution-mode system: Search/Research use Tavily; Write/Code and Plan mainly add prompt instructions. There is no model router, dynamic model-requested tool loop, MCP/Skills integration, document-ingestion pipeline, model/RAG evaluation suite, or graph visualization UI. The backend currently has no auth and permissive CORS; it is intended for localhost use.

## Objective

Make Atlas a local-deployed, multi-mode assistant with policy-constrained model routing, measurable retrieval quality, managed local-model startup, and extensible tools—while keeping user choice, privacy, and approval in control.

## Deliverables

- Four request modes: **Auto**, **Research**, **Coding**, and **Documentation**.
- An explainable router that selects only a model eligible under the user’s privacy and execution policies; users can explicitly choose a mode and, when permitted, a model.
- A backend-enforced tool policy with allowlisted low-risk actions and user approval for sensitive operations.
- Evaluation fixtures and reports for mode/model routing, retrieval, and chunking.
- Improved retrieval over chat memory and user-selected local documents, with source provenance. On-demand URL ingestion is a later increment.
- An opt-in lifecycle manager for supported, already-installed local runtimes; no silent model installation.
- MCP/custom Skills support behind the tool policy broker.
- A per-thread entity-graph UI using the existing graph API.

## In scope

### Modes, routing, and execution policy

- A mode is a task policy/profile, not a tool. Auto classifies each message; an explicit mode overrides classification for that message.
- Mode policy describes suitable model capabilities, output behavior, and eligible tools. The router selects only from eligible models and reports its selection and fallback reason.
- A user-selected provider/model is a preference, not a policy bypass. If it violates privacy or capability constraints, Atlas explains why and does not silently route elsewhere.
- Policy decisions live in code on the backend. Prompts may guide style and task behavior but are not a security boundary.
- Model choice may vary per turn in Auto. Conversation continuity across providers must be explicit and bounded; the current UI’s provider-switch context bootstrap is a starting point, not proof that all history is preserved.

### Modes

- **Auto:** choose among the other modes for each message, subject to user policy.
- **Research:** synthesize evidence from permitted memory and search sources; expose source provenance.
- **Coding:** generate and explain code. File changes or command execution require tool approval.
- **Documentation:** produce structured Markdown from supplied context. Saving or modifying files requires approval.

The existing tool picker must be reconciled with this model: mode selection expresses intent; tools are separate capabilities available within a mode. The exact treatment of the existing Plan entry is an open decision.

### Local model lifecycle

- Preserve existing local-model discovery for running Ollama/LM Studio/vLLM-compatible endpoints.
- Add opt-in start/status/stop management for explicitly supported, already-installed runtimes. Atlas stops only processes it started.
- Execute only fixed, allowlisted program paths and argument arrays; do not interpolate arbitrary shell commands.
- Do not download/install runtimes or model weights without a separate, explicit user approval. Show starting/ready/unavailable states and bounded startup failures.

### RAG and evaluation

- Preserve chat-memory retrieval and add an explicit, user-selected local-document corpus with source IDs, chunk IDs, and stable provenance.
- Treat retrieved content and fetched pages as untrusted data, not instructions.
- Establish an offline benchmark before changing ranking or chunking. Compare the current vector-distance baseline with candidate retrieval/ranking and chunking strategies. Promote a change only when measured results improve without breaking source attribution.
- Add on-demand URL ingestion after local-document ingestion. Do not silently crawl folders or the web.

### Tools, MCP, Skills, and guardrails

- Model-requested tool calls pass through a backend registry with typed input validation and a policy check before execution.
- Allowlisted low-risk operations may run automatically. Sensitive network disclosure, file writes, shell/process execution, and model installation require approval unless the user has granted a narrower explicit permission.
- Approval is per invocation by default. Any persistent grant must name the tool and exact capabilities, be visible, and be revocable.
- MCP servers and custom Skills are untrusted extensions. They inherit the same policy, approval, timeout, and observability controls; they cannot expand their own permissions.
- User-custom guardrails may constrain behavior, but policy enforcement remains deterministic code. A prompt cannot authorize a blocked operation.

### Graph UI

- Visualize the existing per-thread entity/relation graph returned by `GET /threads/{thread_id}/graph`.
- Conversation branching is not included in this graph view; it would need a separate data model and spec.

## Out of scope

- Hosted or multi-user deployment, shared database/session state, or remote exposure of the API.
- Unattended arbitrary shell execution, file modification, runtime installation, or model downloads.
- Silent cloud routing or silent transfer of user content to external providers.
- Replacing SQLite or the current embedding model before evaluations justify it.
- Community/hierarchical GraphRAG and branchable conversation graphs in the first graph UI.
- Training or fine-tuning models.

## Proposed contracts and boundaries

1. **Renderer → API:** each user turn carries a typed mode (`auto | research | coding | documentation`), optional model preference, and prompt/attachments. The API returns response text plus selected mode/model, route explanation, memory/source references, and tool activity needed for the UI.
2. **Policy → router:** policy filters candidate models and tools before selection. The router cannot widen the candidate set.
3. **Model → tool broker:** a model proposes a tool name and typed arguments. The broker validates, checks policy, obtains approval where required, executes with bounded time/resources, and returns a visible result or degraded error.
4. **Retriever → answer:** memory/document hits retain source identity and ranking metadata through response rendering so citations and evaluation are possible.
5. **Electron main → local runtime:** only named runtime adapters may spawn processes; the renderer never receives a shell API.

Exact serialized request/response schemas are to be frozen in the first implementation slice before wiring UI and server changes.

## Implementation order

1. Freeze policy, privacy, mode, approval, and response-observability contracts; add offline evaluation foundations.
2. Evaluate current retrieval, then add selected-document ingestion, provenance, and measured retrieval/chunking improvements.
3. Add opt-in lifecycle management for supported installed local runtimes.
4. Add Auto/explicit modes and model routing with manual overrides and evaluation.
5. Add dynamic tools, then MCP/custom Skills, through the same policy broker.
6. Add the per-thread graph UI. This can be scheduled earlier as an independent UI slice once the graph meaning is confirmed.

## Acceptance criteria

- Auto selects a supported mode per message; explicit mode selection takes precedence over classification.
- Routing decisions obey privacy, capability, and user policy; blocked routes fail visibly and do not silently fall back to a disallowed provider.
- Tool calls are schema-validated and backend-authorized; approvals identify the proposed action and its effects before execution.
- Atlas can discover supported local models, start only an enabled/installed runtime through an allowlisted command, report readiness/failure, and stop only its own process.
- Retrieval/chunking changes are compared against a checked-in offline baseline using reported metrics; sources remain traceable to the answer.
- Research responses expose sources; Documentation mode does not write files without approval.
- The graph UI renders the current thread’s existing nodes and relations and degrades clearly when the graph is empty/unavailable.
- Unit/evaluation tests run without provider credentials or network access. Live-provider evaluations require explicit opt-in.

## Known risks

- Per-turn model changes can lose provider-specific conversation state. The current switch-context bootstrap includes only recent messages.
- Local deployment does not imply local inference; privacy policy must be visible before routing to cloud models.
- Custom MCP servers and Skills can expose files, processes, and network access; prompt-only restrictions are insufficient.
- Retrieval metrics need a representative, non-sensitive labeled corpus. Synthetic fixtures alone will not prove production relevance.
- Runtime commands and packaging differ by OS; supported runtimes must be tested on each target platform.
- The current local API has no auth and permissive CORS. Tool execution must not be added until the local API trust boundary is reviewed and constrained.

## Open decisions before implementation

- Auto classifier strategy: deterministic rules, model classifier, or a measured hybrid.
- Whether the user’s existing Plan UI is retired, folded into Documentation, or retained as a separate action.
- Exact policy controls and whether web search may run automatically when enabled.
- Supported runtime/version/OS matrix and the initial model-runtime allowlist.
- MCP transport(s) and custom Skill format/permissions model.
- Local document formats, indexing limits, and URL-fetch scope.
- Evaluation corpus ownership, expected quality thresholds, and opt-in rules for paid-provider tests.
- Whether the package’s “legal work” description is still the intended primary audience or stale metadata.

## Next checkpoint

Review this spec, settle the open decisions needed for the first slice, and select one subsystem for a task-level execution plan. Do not start implementation from the umbrella roadmap alone.

## Sources

- `README.md` — product overview, current features, limitations, and documentation index.
- `server/api.py` — local-model discovery, chat/session APIs, graph endpoint, CORS, and current API boundary.
- `server/factory.py` — current provider/model catalog and adapter construction.
- `server/brain/retriever.py`, `server/brain/store.py`, `server/brain/chunking.py`, `server/brain/schema.sql` — existing memory retrieval, vector ranking, chunking, and graph storage.
- `apps/desktop/src/renderer/src/pages/Home.tsx` — current prompt presets, explicit search flow, and provider-switch context.
- `apps/desktop/src/renderer/src/components/ui/chatgpt-prompt-input.tsx` and `apps/desktop/src/renderer/src/components/ChatArea.tsx` — current tool picker and response presentation.
- `apps/desktop/src/main/index.ts` — Electron process ownership and embedded backend lifecycle.
- `server/tests/test_brain.py` and `apps/desktop/package.json` — existing verification surface.
