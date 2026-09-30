# Atlas Agentic Tools and Research Design

**Status:** Implementation is in the working tree; offline suites pass, but security review, packaged-app verification, and live-provider evaluation remain open (see the plan's audit checkpoint).

## Delivery status

Implemented in this worktree: per-instance bearer authorization for the loopback HTTP API (with CORS disabled), bounded Search and multi-query Research; typed SSE progress/source/error states; citation-ID validation/repair; safe public-page fetching; current-thread memory and selected-text-file tools; provider-native read-only tools for advertised OpenAI, Anthropic, and Gemini models; and reviewed Markdown drafts with explicit destination selection and atomic save. Limits are 3 Research queries, 8 results/query, 12 unique sources, 3 page fetches, 10 seconds/page, 1 MiB/page, 12,000 extracted characters/page, 90 seconds/run, and a generic 4-round/6-call/3-concurrent-read loop.

Provider boundary: OpenAI supports fragmented streamed arguments; Anthropic and Gemini normalize complete tool calls but do not advertise streamed-argument support. OpenRouter and local models do not expose native tools. Safe Tools excludes public search/fetch when Brain or selected files are in scope, preventing local evidence from becoming a model-chosen Tavily query; explicit Search/Research use server-owned queries. Citations prove only that a source ID exists, not that the source supports a claim.

Not implemented: Research Nodes/workspace persistence, PDF/Office parsing, arbitrary document collections, calculator/compare-source tools, model-authorized writes, or live-provider quality evaluation. Document saving is only the explicit user-confirmed desktop path described below.

## Goal

Make Atlas's tool modes honest, useful, cancellable, evidence-grounded, and extensible across its existing provider adapters without granting the model ambient access to the user's machine or network.

## Initial audit (before implementation; historical snapshot)

The following records behavior found before this design was implemented; it is not a description of the current worktree.

- The prompt box sends a selected tool ID through `ChatArea` to `Home.tsx`. Selection is per-message and resets after sending.
- **Search web** calls `POST /websearch`, which uses the configured Tavily key and one query. Search passes 5 results; Research passes 8. `Home.tsx` places the result snippets and URLs into the prompt before normal chat streaming.
- **Research mode is not a research agent.** It uses the same single Tavily request as Search web, with a different instruction and result count. There is no query planning, page retrieval, or iterative research loop.
- **Write or code** and **Plan mode** add text prefixes. They do not invoke tools. Plan mode currently asks for step-by-step thinking instead of a concise, user-visible plan.
- Chat adapters expose `send(prompt, images)` and text streaming; they do not expose provider tool calls. There is no tool registry or MCP integration in the app/backend.
- The Brain adds memory context when enabled. `/memory/search` exists, but the model cannot call it as a tool.
- Search source UI receives titles and URLs, not full result cards or claim-level verified citations. The raw snippets are folded into the same user prompt as the question.
- Stop aborts the model stream, but the web-search call is made without the existing `AbortSignal`.
- The sidebar's “Deep Research Nodes” card describes a workspace workflow that is not implemented. A `ToolItem` comment still describes future Serper/multi-step support. Align this copy with actual behavior before shipping more modes.
- Search requires its own Tavily key in Profile settings. This audit did not inspect the key or make a live Tavily request.

Primary references: `apps/desktop/src/renderer/src/pages/Home.tsx`, `components/ui/chatgpt-prompt-input.tsx`, `components/ChatArea.tsx`, `server/websearch.py`, `server/api.py`, `server/adapters/base.py`, `server/brain/brain.py`, and the current “Feature flows” section in `README.md`.

## Product boundaries

### Goals

1. Keep existing normal chat working unchanged when no tool mode is selected.
2. Make Search web and Research observably different in execution, not just labels.
3. Support explicit, bounded workflows across providers before relying on provider-native function calling.
4. Add a static, typed, least-privilege tool registry; model output can request only registered tools allowed for the current run.
5. Show progress, sources, errors, cancellation, and approval state in the UI.
6. Preserve memory semantics: one user turn and one final assistant answer are persisted as a chat turn. Intermediate planner/tool traffic is not silently embedded as user memory.
7. Keep keys in `credentials_store.py`; never send provider or Tavily credentials to the renderer, model, search results, or logs.

### Non-goals for the first delivery

- Arbitrary shell, Python, SQL, or JavaScript execution.
- A general-purpose logged-in browser or use of browser cookies.
- Loading tools dynamically from arbitrary URLs, packages, or MCP servers.
- Automatically editing files or workspaces without user review.
- Exposing hidden chain-of-thought. Planning may produce a concise, inspectable plan; it must not request or display private reasoning traces.
- Replacing Atlas's provider adapters or memory store.

## Architecture recommendation

Use two layers rather than pretending every mode is an autonomous agent:

1. **Explicit workflows** (`search`, `research`, `plan`, `draft`) are selected by the user and run through a server-owned workflow. This gives the same bounded behavior even when a provider lacks native tool calls.
2. **Provider-native tool calls** are enabled only for advertised provider/model combinations. Adapters normalize provider-specific tool-call events into one contract; a server-side runner validates and executes them. Providers/local models that do not declare support are not offered autonomous tools.

The server owns orchestration, credentials, validation, budgets, cancellation, and network access. The renderer only requests a mode, includes user-selected current-turn attachment payloads and bounded recent context when applicable, and renders typed run events. Implement the initial research path before exposing broad autonomous tool selection. Research remains usable through the explicit bounded workflow on providers without native tool calls; autonomous model-selected tools are hidden/disabled for those providers rather than simulated.

```text
PromptBox mode
  -> typed API request + run ID
  -> FastAPI boundary
  -> AgentRunner (policy, budget, cancellation, trace)
       -> Brain recall once for the user turn
       -> provider adapter (plan / final answer)
       -> static ToolRegistry
            -> web_search (Tavily)
            -> fetch_page (public web, read-only)
            -> memory_search (existing Brain store, scoped)
  -> typed SSE events (progress, sources, text, error, completion)
  -> ChatArea tool trace, source cards, final answer
```

`api.py` remains the HTTP boundary. A small `server/agents/runner.py` owns the bounded loop; `server/tools/` owns validated tool contracts and implementations. `server/websearch.py` remains the existing Tavily transport instead of adding a second HTTP client. `Brain` must prepare recall once and persist only the user prompt/final answer for an agentic turn; intermediate tool output belongs in the run trace, not the vector memory by default.

## Contracts

### Tool definition

Each statically registered tool has:

- `name`: stable snake-case identifier.
- `description`: concise model-facing purpose, input requirements, and limitations.
- `input_model`: Pydantic schema; reject extra fields and invalid values.
- `effect`: `local_read`, `external_read`, or `write`.
- `approval`: `none`, `mode_selection`, or `explicit_user_confirmation`.
- `timeout_seconds` and `max_output_bytes`.
- `handler(context, validated_input) -> ToolResult`.

The registry is explicit Python code. A model cannot import modules, invent tool names, change policy, or pass a filesystem path as a capability. The API accepts attachment IDs plus bounded content only for files the user attached to that turn; it never asks the backend to open an arbitrary local path.

### Run context and result

`ToolContext` carries a server-generated `run_id`, session/thread identifiers, allowed tool names, deadline, cancellation signal, user-granted scope, and an in-memory map of attachments explicitly included in the current request. Attachment entries use UI-issued opaque IDs, have an initial cap of 5 files, 5 MiB per file, and 10 MiB total, and are discarded after the run. The context must not contain raw API keys in model-visible fields.

`ToolResult` contains a short `summary`, typed `data`, `source_ids`, and a flag identifying externally retrieved content as untrusted. Large bodies are held in a bounded evidence store for the duration of the run, not copied into event logs.

The streaming API accepts an `AgentTurnRequest` with the original `prompt`, a validated mode (`chat`, `search_web`, `research`, `plan`, `write`, `draft`, `tools`), the existing optional current-turn `images` field, optional current-turn text attachments, and at most four recent user/assistant messages with an 8,000-character total cap for resolving follow-up queries. Preserve the existing image-message path; text attachments are a separate scoped capability. The request does not accept arbitrary tool names or policy overrides. `Home.tsx` sends the selected mode; it does not build search prompts or decide tool limits.

### Provider-neutral messages and events

Add a normalized `TurnMessage` for `system`, `user`, `assistant`, and `tool` roles, with `tool_call_id` only for tool messages. Existing `send(prompt, images)` remains as a compatibility wrapper around one user message. Each provider adapter maps normalized messages and streamed tool calls/results to its SDK format; capability reporting says whether native function calling and streamed arguments are supported. Research evidence is passed as a distinct typed context/evidence message, not concatenated ahead of the user's question.

Normalize adapter and runner output into an event union such as:

- `run.started`, `plan.ready`
- `tool.started`, `tool.progress`, `tool.completed`, `tool.failed`
- `source.found`, `approval.required`
- `assistant.delta`, `run.completed`, `run.failed`, `run.cancelled`

Events include `run_id`, optional `call_id`, stable tool/source IDs, and safe display summaries. Never include API keys, raw credentials, unrestricted page bodies, or filesystem paths. Update the existing SSE parser; do not overload text tokens with ad-hoc strings.

### Model tool-call loop

For providers that support tool calls, the server loop is:

1. Build the allowed-tool list from the user's selected mode and policy. Default chat gets no tools unless the user enables an explicit safe auto-tool policy.
2. Send the user turn, bounded memory context, and tool schemas to the adapter.
3. If the model returns a final answer, validate citations if present and finish.
4. For each tool call, validate the tool name against the allowlist, parse arguments with that tool's Pydantic model, enforce the run budget, and request user approval for any write effect.
5. Execute only approved, validated calls. Run independent read-only calls concurrently under a small concurrency cap; serialize writes. Any future retry must be limited to one transient read-only retry. Never retry a write without an idempotency key.
6. Return results to the provider as structured tool-result messages, marked as untrusted evidence when sourced externally. Do not concatenate page text as though it were the user's instruction.
7. Repeat until final answer or a hard limit is reached. On limit, cancellation, or failure, return the partial trace and a clear degraded state; never claim unperformed work.

Initial ceilings, configurable in code rather than prompts: at most 4 model/tool rounds, 6 total tool calls, 3 concurrent read-only calls, and a 90-second Research run. Search permits at most 8 results per query; Research plans at most 3 distinct queries, keeps at most 12 unique results, and fetches at most 3 pages. A page fetch has a 10-second timeout, a 1 MiB response cap, and a 12,000-character extracted-text cap. These are safety ceilings, not quality targets; measure latency and cost before raising them.

### Mode-to-tool policy

| User mode                              | Allowed work                                                                                    | Automatic side effects                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Normal chat                            | No external tools by default; Brain recall only if enabled                                      | None                                                   |
| Search web                             | One `web_search` call                                                                           | Public read only                                       |
| Research                               | Planner, bounded `web_search`, `fetch_page`, optional selected-file search, citation validation | Public read only; attached files stay local to the run |
| Plan                                   | Produce concise user-facing plan and assumptions                                                | None                                                   |
| Write/code                             | Response-style preset; no code execution                                                        | None                                                   |
| Draft document                         | Read only selected evidence/attachments; return a draft                                         | None                                                   |
| Save document                          | Save a reviewed draft to a user-selected destination                                            | Explicit confirmation for every write                  |
| Image generation / voice transcription | Existing explicit UI actions                                                                    | Cost/provider call is visible and user-triggered       |

A user's explicit mode selection is the grant for that run. Do not infer that selecting a mode once grants future turns or grants write access. An optional “auto use safe tools” setting may later enable only listed read-only tools and must be separately opt-in.

### Efficiency and observability

Keep Search mode at one query; do not spend a planner call for it. For Research, run at most 3 independent searches concurrently, deduplicate URLs before fetching, and make at most one bounded planning call and one synthesis call by default (a single citation-repair call only when validation fails). Do not persist full web pages. Record per-run phase timings, provider/model, search query IDs, result counts, and error codes without raw credentials or full source bodies. Measure repeated-query frequency and latency before adding a cache, more parallel calls, or an optional citation-review model pass.

### Brain and conversation handling

`Brain.send_stream` is currently text-oriented and persists after one adapter response. Do not call it once per tool step: that would create false user turns and embed intermediate tool traffic. Add one agent-aware turn boundary that:

- recalls memory once from the actual user question and current thread;
- lets the runner make multiple provider/tool calls within that turn;
- persists the original user question and final answer once;
- stores source/run metadata separately from vector chunks;
- excludes raw fetched pages and planner output from long-term memory by default;
- emits memory recall and tool events as distinct typed events.

Normal non-agent chat keeps the current path. Tool traces may be stored with the chat message for replay, but secrets and full page bodies are not persisted by default.

## Research workflow

Research is a bounded workflow, not an unbounded “think harder” loop:

1. **Clarify scope:** use the current question and at most the last two relevant user/assistant turns. Do not search a pronoun-only follow-up without resolving its referent. Show the effective query/subqueries in the trace.
2. **Plan:** produce a small structured plan: objective, 1–3 distinct search queries, freshness needs, and source criteria. Use a schema-validated planner; if the plan is invalid, fall back to the original query and state that planning degraded. The plan shown to the user is concise and contains no private chain-of-thought.
3. **Search:** execute the planned queries through Tavily with bounded concurrency. Normalize, deduplicate by canonical URL, retain query ID, title, host, snippet, date/score when available, and stable `source_id`.
4. **Select and fetch:** fetch no more than 3 selected search-result IDs. The model cannot supply an arbitrary URL for this first version. Fetch only public HTTP(S) pages, revalidate every redirect and DNS resolution, block loopback/private/link-local/reserved IPv4 and IPv6, reject credentials in URLs, cap bytes/time, and accept only supported text content types. Do not send browser cookies.
5. **Synthesize:** if the user attached files, search only those in-memory files locally and add matched excerpts to the evidence bundle. Never derive Tavily queries from attachment contents. Provide evidence as a distinct structured message to the selected chat provider; keep the user's question separate. Require inline references such as `[S1]` for web sources and `[A1]` for attached-file excerpts, and identify conflicts/date limitations. The model must say when evidence is insufficient. Providers without native tool-result roles receive a bounded, clearly delimited evidence block plus a separate instruction that it is untrusted data; they are not offered autonomous arbitrary tool calls.
6. **Validate:** reject unknown citation IDs. A deterministic citation check proves that IDs exist, not that claims are entailed; do not label it a fact checker. An optional second model review may flag unsupported claims but cannot replace source inspection.
7. **Complete:** show the answer, query plan, source cards, fetched-page status, and any degraded steps. Users can open originals. Saving a report is a separate, user-confirmed operation.

No-result, partial-result, timeout, rate-limit, cancellation, and planner-invalid states are first-class outcomes. A search failure must not silently fall back to an uncited answer labeled “researched.”

## Tool catalog

### Existing capabilities and honest target behavior

#### `web_search` — keep and strengthen

- **Today:** Tavily search for one raw query; returns title, URL, and snippet. The caller chooses 5 or 8 results.
- **Implemented input:** non-empty query (max 1,000 characters) and result limit from 1 to 8. Recency and domain filters are not implemented.
- **Target output:** typed `SearchHit[]` with stable `source_id`, `query_id`, title, canonical URL, host, snippet, publication date/score when supplied, and provider name. Web citations use `[S#]`; attached-file evidence uses `[A#]` and displays a filename/section rather than an external link.
- **Effect/approval:** external read; allowed only when Search/Research is selected or an explicit read-only auto-tool grant is active.
- **Failure:** distinguish missing key, invalid query, rate limit, timeout, provider error, and no results. Never return a fake empty success for a failed request.

#### `deep_research` — implement as a workflow, not a primitive

- **Today:** one `web_search` call with 8 results and a prompt prefix.
- **Target:** the bounded workflow above, composed from `web_search`, `fetch_page`, optional search of the user's current-turn attachments, a planner, and synthesis. It reports exactly which steps ran and which did not.
- **Effect/approval:** selected by the user; read-only external calls. No file writes during research.
- **Failure:** partial evidence is shown as partial; do not claim full research on a timeout or failed fetch.

#### `memory_search` — expose existing Brain retrieval carefully

- **Today:** Brain recall is injected automatically when enabled; `/memory/search` can query persisted memory, including broad stored-thread scope.
- **Implemented input:** query and `top_k` capped at 5; scope is always the current Brain thread. Cross-thread search is not implemented.
- **Target output:** memory snippet, thread reference, and relevance score, not a web citation.
- **Effect/approval:** local read; allow only the current thread unless broader scope is explicitly granted.
- **Failure:** if Brain is disabled, report that capability as unavailable; do not fail the whole chat.

#### `image_generate` — keep as an explicit action

- **Today:** real OpenAI/Gemini image-generation endpoint and UI action; supported providers are already restricted.
- **Target:** keep separate from ordinary agent loops because it can cost money and produces a large artifact. Require explicit user action/confirmation, show provider/model and failure state, and never let a research page trigger generation.

#### `voice_transcribe` — keep as input capability

- **Today:** microphone audio is sent to Groq transcription; this is an input conversion, not a model-invoked reasoning tool.
- **Target:** retain the explicit microphone action and user consent; do not expose it as a general tool callable by the model.

#### `write_code` and `plan` — rename or define honestly

- **Today:** text prefixes only.
- **Target:** `Write` can remain a response-style preset. `Plan` should return a concise structured, user-visible plan (goal, steps, assumptions, risks) and must not ask the model to reveal hidden chain-of-thought. Any execution or file mutation is a separate tool and needs its own permission.

### Recommended new read-only tools

#### `fetch_page(source_id)`

Reads a page selected from this run's search results. Returns `source_id`, canonical/final URL, title, fetched time, status, and bounded extracted text. It accepts a source ID rather than arbitrary model-supplied URLs. It has the SSRF, redirect, MIME, byte, text, and timeout restrictions in the Research section. No cookies, logins, forms, downloads, or script execution.

#### `search_attached_files(attachment_ids, query)`

Today, the renderer already reads user-selected text attachments and inlines their contents into the prompt. Reuse that attachment UI and IDs; send current-turn attachment records as structured request data, validate count/type/size server-side, and keep their contents only in the run's in-memory `ToolContext`. Input uses UI-issued opaque IDs, never filesystem paths. Preserve the current text-file allowlist (`.md`, `.txt`, `.csv`, `.json`, `.log`, `.yaml`, `.yml`, `.py`, `.js`, `.jsx`, `.ts`, `.tsx`, `.html`, `.css`, `.sql`, `.java`, `.c`, `.cpp`, `.go`, `.rs`, `.sh`, plus browser-identified `text/*` files); PDF/Office parsing waits for a maintained parser and format-specific tests. Returns filename, section, and short excerpts. Attachment text is never sent to Tavily or used to construct an external search query. Large-file ingestion is a separate explicit action with size/type limits.

#### `read_attached_file(attachment_id, range)`

Reads a bounded section of a current-turn attachment when a snippet is insufficient. It is limited to UI-issued attachment IDs and a maximum byte/character range; it cannot browse the user's disk.

#### `calculator(expression)`

Evaluates bounded arithmetic using a parser and decimal arithmetic. Never use Python `eval`, shell, or model-generated code. Reject unsupported functions, excessive depth/length, non-finite values, and division by zero. This is a deterministic low-risk tool suitable for auto-use if enabled.

#### `compare_sources(source_ids, question)`

Compares only source records already present in the run. Returns a structured comparison with per-source evidence and disagreements. It cannot introduce new URLs or state that a source proves a claim without an excerpt. Prefer implementing this as a bounded workflow over an extra provider-specific primitive.

#### `citation_check(answer, source_ids)`

The runner structurally checks that cited IDs exist and that evidence-backed answers include a citation; it removes unknown IDs and performs at most one repair attempt in Research. It does not detect uncited factual paragraphs or verify entailment. This is a structural check, not a truth guarantee. A semantic support review, if added, must be visibly labeled as an estimate and include the passage it relied on.

### Documentation tools (future, with user control)

#### `draft_document(kind, outline, source_ids)`

Creates a Markdown draft from user instructions and selected source records. It returns content in the chat; it does not write files. It preserves source IDs/URLs and labels unsupported sections. Formats can include research brief, decision memo, meeting brief, README, and comparison table.

#### `search_documents(scope, query)`

Searches an explicitly selected Atlas document collection or user-selected folder. The first implementation should reuse `search_attached_files` and existing local indexing if available; do not assume the chat `Library` is a document workspace. Return file/section references and snippets.

#### `save_document(draft_id, destination_id, filename)`

A write action, never auto-approved. The UI shows a preview and chosen destination; the user confirms. Electron main owns the file dialog and write. Use only a user-selected directory capability, validate filename, write to a temporary file and atomically rename, refuse overwrite by default, and make retries idempotent. The model never supplies an absolute path.

#### `save_research_report(run_id, destination_id)`

A convenience workflow over `draft_document` + `save_document`, not a second file-writing implementation. It includes date, research question, methods/limits, answer, citations, and source list. It must confirm before writing.

### Defer or reject

- `run_shell`, arbitrary Python/JavaScript, unrestricted SQL, arbitrary file reads/writes, browser clicks with user cookies, and unrestricted MCP discovery are not v1 tools. If code execution becomes a concrete requirement, it needs a separately approved sandbox with no inherited credentials, network deny-by-default, filesystem isolation, CPU/memory/time limits, and auditable output.
- A general “open any URL” fetch call is rejected in favor of fetching only server-issued `source_id`s.
- Do not add search vendors just for quantity. Add a second search provider only after mocked/recorded evaluations show a coverage or reliability gap and the UI makes source provenance clear.

## User experience

- Keep one-turn mode selection explicit; show a mode badge and reset state only when the user expects it. Offer a separate “keep this mode on” preference only if users request persistence.
- Show states: `Searching`, `Planning research`, `Reading N sources`, `Writing answer`, `Cancelled`, `Partial results`, `No results`, and actionable errors (including “add Tavily key”).
- Add source cards with title, host, date when available, short excerpt, and “Open source”; retain source ID for citations. Make the process trace collapsible, but keep primary citations visible.
- Render citations only when their IDs match the run evidence. Web citations open the source in the system browser; attached-file citations show filename/section and never pretend to be web links.
- Do not show fabricated “Research nodes” or workspace actions until the actual storage model and write path exist.

## Security, privacy, reliability

- Search/fetch output is untrusted data. It may contain instructions; it is evidence, not authority. Keep it in structured tool-result messages and tell the model to treat it as data. Never let a source change tool policy or permissions.
- Keep secrets only in `credentials_store.py`/backend; redact them from prompts, events, tests, and logs.
- Public-page fetching must block private/loopback/link-local/reserved IPs, validate every redirect and resolved address, defend against DNS rebinding, and cap response/time/output.
- Each run has a deadline, max tool-call count, result/output budget, cancellation token, and trace. Use bounded concurrency and only bounded retries for idempotent reads.
- Write actions need explicit approval, selected destination capabilities, safe filenames, atomic/idempotent writes, and no silent overwrite.
- Persist final answer and source metadata; do not automatically persist full external page content in memory.

## Acceptance criteria

1. Search web uses the exact displayed effective query, validates result limits, supports cancellation, and reports missing key/no results/provider failures distinctly.
2. Research executes at least two distinct validated queries on a normal multi-angle request, deduplicates results, fetches selected pages within limits, and exposes each completed/degraded step.
3. Every displayed citation maps to a web or attached-file evidence ID returned in that run. Unknown IDs are rejected; unsupported evidence is labeled rather than fabricated.
4. Stop cancels pending search/fetch/model work, prevents later tool calls, and always clears the UI busy state.
5. Models can execute only registered tools allowed for the current mode. Invalid arguments, unknown tools, budget exhaustion, denied approvals, and provider failures have tests and visible outcomes.
6. Normal chat, image generation, voice transcription, and Brain memory retain their existing behavior when the relevant tool mode is not selected.
7. Tests use deterministic Tavily/page fixtures; no CI test requires real API keys or live web access.
8. Search key stays server-side; page fetching passes SSRF tests; file writes require explicit confirmation.
