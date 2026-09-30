# Atlas Agentic Tools Implementation Plan

> **For agentic workers:** Implement this plan one task at a time. Keep each task's tests green before moving on; do not build later-phase tools before the earlier contracts and boundaries are accepted.

**Goal:** Replace misleading prompt-only tool modes with a bounded, observable research workflow and a safe, provider-neutral foundation for future tools.

**Architecture:** User-selected workflows run in the FastAPI server. A static registry validates and executes only allowed tools; provider adapters eventually normalize native tool calls into the same run loop. Brain provides memory once per logical turn and persists only the user question and final answer, while typed events carry progress, evidence, cancellation, and errors to the renderer.

**Tech Stack:** Existing FastAPI/Pydantic/httpx backend, provider SDK adapters, React/Electron renderer, built-in Python `unittest`, Node `node:test`, SSE. No new dependency is required for the first research release.

**Spec:** `docs/superpowers/specs/2026-09-29-agentic-tools-design.md`

## Global Constraints

- Keep all provider/search credentials in the backend `credentials_store.py`; never send keys to the renderer, model, logs, or tool outputs.
- Use a static allowlisted registry. No model-selected imports, shell, arbitrary SQL, arbitrary file paths, or dynamic remote tool loading.
- Research ceiling: 3 search queries, 8 results/query, 12 unique results, 3 fetched pages, 10 seconds/page, 1 MiB/page, 12,000 extracted characters/page, 90 seconds/run.
- Generic model tool loop ceiling: 4 rounds, 6 tool calls, 3 concurrent read-only calls. Stop when any budget or cancellation signal fires.
- Fetch only server-issued `source_id`s. Revalidate redirects and resolved IPs; deny private, loopback, link-local, and reserved destinations.
- Read-only tools may run only under the selected mode or an explicit safe-tool grant. Every write requires user confirmation and a user-selected destination.
- Persist one user turn and one final answer per agent run. Do not embed raw pages, tool arguments, or intermediate planning in Brain memory by default.
- Preserve current no-tool chat, image generation, voice transcription, and memory behavior.

## File ownership map

- `server/tools/contracts.py`: validated tool inputs, run context, outputs, and safe event models.
- `server/tools/registry.py`: static names, schemas, effects, approvals, limits, and handler lookup.
- `server/tools/web.py`: read-only search/page handlers reusing `server/websearch.py` for Tavily.
- `server/agents/research.py`: bounded Research workflow and planner/synthesizer boundary.
- `server/agents/runner.py`: provider-native bounded function-call loop, added after explicit Research works.
- `server/adapters/base.py` and provider adapter files: normalized provider capabilities, message roles, and tool-call events.
- `server/brain/brain.py`: one recall/finalize boundary per logical agent turn.
- `server/api.py`: request validation, session lock, cancellation, and typed SSE boundary; no tool business rules.
- `apps/desktop/src/renderer/src/lib/api.ts`: typed requests and SSE event decoding.
- `Home.tsx` and `ChatArea.tsx`: mode selection, cancellation, run state, and evidence/source rendering.
- `server/tests/`: deterministic backend fixtures and policy tests; `apps/desktop/test/`: built-in Node tests for pure renderer flow helpers.

---

## Phase 0 — Fix and accurately label today's tools

### Task 1: Make Search cancellation and mode behavior correct

**Files:**

- Modify: `apps/desktop/src/renderer/src/lib/api.ts`
- Modify: `apps/desktop/src/renderer/src/pages/Home.tsx`
- Modify: `server/api.py`
- Modify: `server/websearch.py`
- Create: `apps/desktop/src/renderer/src/lib/search-flow.mjs`
- Create: `apps/desktop/src/renderer/src/lib/search-flow.d.mts`
- Create: `apps/desktop/test/search-flow.test.mjs`
- Create: `server/tests/test_websearch.py`

- [x] Add a pure `runSearchBeforeChat({query, maxResults, signal, search})` helper. It passes the same signal to search, checks cancellation before returning results, and rejects with a stable cancellation error.
- [x] Add Node tests proving that the signal reaches the search stub, cancellation prevents the next chat/session step, and normal results pass through unchanged. Run `cd apps/desktop && node --test test/search-flow.test.mjs` and confirm the cancellation case fails before implementation.
- [x] Add optional `signal` to `webSearch`; pass it in `fetch` options through `request`. Convert `AbortError` to the existing `ApiAborted` type.
- [x] Call the helper before creating the assistant placeholder/session. If cancelled, return through the existing silent-cancel path and do not show a provider failure.
- [x] Make the backend cancel its upstream HTTPX task when the client disconnects, while retaining the 20-second upstream timeout. Test with a fake delayed search coroutine; no live Tavily key is used.
- [x] Run `cd apps/desktop && node --test test/search-flow.test.mjs && npm run typecheck` and `cd server && python3 -m unittest tests.test_websearch -v`.

**Acceptance:** Stop during Tavily search stops the upstream operation where supported, creates no model session afterward, adds no generic error bubble, and always clears the busy state.

### Task 2: Bound search input and fix misleading labels

**Files:**

- Modify: `server/api.py`
- Modify: `server/websearch.py`
- Modify: `apps/desktop/src/renderer/src/components/ui/chatgpt-prompt-input.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Sidebar.tsx`
- Modify: `README.md`
- Test: `server/tests/test_websearch.py`

- [x] Make `WebSearchRequest.query` non-empty and length-bounded; validate `max_results` from 1 through 8. Reject bad input with HTTP 422 before calling Tavily.
- [x] Normalize only valid `http`/`https` result URLs and handle a malformed result without failing the entire search response.
- [x] Update the stale `ToolItem` comment and the Sidebar feature card. Until Research Nodes exist, label the card as planned or remove it; do not imply that pages are saved to workspaces.
- [x] Make the labels honest: Search means one search request; Research is marked planned until Task 8 makes it multi-step. Keep Plan as a concise plan mode, not a request for hidden step-by-step reasoning.
- [x] Add unit tests for empty/oversized queries, limits below/above the range, malformed URL handling, Tavily error mapping, and no-results behavior.
- [x] Run `cd server && python3 -m unittest tests.test_websearch -v`; run `cd apps/desktop && npm run typecheck`.

**Acceptance:** Invalid inputs never reach Tavily, and no UI card advertises an unimplemented save/workspace operation.

---

## Phase 1 — Shared tool contracts and run lifecycle

### Task 3: Add typed tool contracts and a static registry

**Files:**

- Create: `server/tools/__init__.py`
- Create: `server/tools/contracts.py`
- Create: `server/tools/registry.py`
- Create: `server/tests/test_tool_registry.py`

- [ ] Define Pydantic `ToolContext`, `ToolResult`, `ToolSpec`, and `ToolRunBudget` types from the spec. Inputs reject unknown fields; limits are explicit data, not prompt text.
- [ ] Define `AgentTurnRequest` with the validated mode enum, original prompt, existing optional `images` field, optional current-turn text attachments, and at most four recent user/assistant turns capped at 8,000 characters total. Validate attachment IDs/types and the 5-file, 5 MiB/file, 10 MiB total limits at this trust boundary. Preserve current image/attachment behavior and reject arbitrary tool names or policy overrides.
- [ ] Register only `web_search` initially. Registry lookup accepts a stable name and returns a known definition; unknown names raise a typed `ToolNotFound` error.
- [ ] Store each definition's effect, approval requirement, timeout, output cap, and handler. Do not add dynamic imports or plugin loading.
- [ ] Test schema rejection, unknown tool, max output, deadline expiration, cancellation, and read/write policy with fake handlers.
- [ ] Run `cd server && python3 -m unittest tests.test_tool_registry -v`.

**Acceptance:** A model-supplied tool name or arguments cannot bypass static registration, schema validation, or run policy.

### Task 4: Define normalized messages/events and implement OpenAI support

**Files:**

- Modify: `server/adapters/base.py`
- Modify: `server/adapters/openai_adapter.py`
- Modify: `server/api.py`
- Create: `server/tests/test_adapter_tool_contract.py`

- [ ] Add normalized `TurnMessage` roles (`system`, `user`, `assistant`, `tool`) and `AdapterEvent` variants for text delta, tool call, and final/stop state. Keep `send(prompt, images)` and text-only streaming as compatibility wrappers.
- [ ] Add explicit per-adapter capabilities, including native tool calls and streamed arguments; never infer support solely from provider name.
- [ ] Implement OpenAI message/tool-call normalization. Preserve provider call IDs and raw arguments as bounded strings; do not execute calls in the adapter.
- [ ] Add mocked SDK tests for plain text, fragmented tool arguments, multiple calls, final answer, malformed arguments, and unsupported response shapes.
- [ ] Run `cd server && python3 -m unittest tests.test_adapter_tool_contract -v`.

**Acceptance:** Existing OpenAI text chat remains compatible and tool calls are represented as data, not executed.

### Task 5: Add provider-specific normalized tool support

**Files:**

- Modify: `server/adapters/anthropic_adapter.py`
- Modify: `server/adapters/gemini_adapter.py`
- Modify: `server/adapters/openrouter_adapter.py`
- Modify: `server/adapters/local_adapter.py`
- Modify: `server/api.py`
- Test: `server/tests/test_adapter_tool_contract.py`

- [ ] Map Anthropic and Gemini messages, partial tool-call streams, tool results, and stop reasons to the shared contract using the installed SDK versions.
- [ ] Let OpenRouter report tool support only for the selected model/route when confirmed; model-specific provider errors become a visible unsupported/degraded response.
- [ ] Keep local models `tool_calls=false` by default. Add an explicit tested capability setting only for runtimes/models that pass the contract suite.
- [ ] Advertise capability per provider/model in `/providers`; do not expose autonomous tools in the UI when unsupported.
- [ ] Test each adapter with mocked SDK events; do not call real providers. Run `cd server && python3 -m unittest tests.test_adapter_tool_contract -v`.

**Acceptance:** Every provider either maps calls/results correctly or explicitly reports no support; none silently treats a tool payload as assistant text.

### Task 6: Make Brain aware of one logical agent turn

**Files:**

- Modify: `server/brain/brain.py`
- Modify: `server/api.py`
- Create: `server/tests/test_brain_agent_turn.py`

- [ ] Factor Brain's current recall and persistence into `prepare_agent_turn(prompt)` and `finish_agent_turn(prompt, final_text, recall, safe_metadata)` operations.
- [ ] `prepare_agent_turn` recalls once from the real user question. `finish_agent_turn` stores one user message and one final answer, then runs the existing best-effort summary/enrichment once.
- [ ] Keep intermediate planner messages, raw external page text, and tool arguments out of vector memory. Store only source IDs and bounded safe metadata with the chat turn.
- [ ] Preserve `send`/`send_stream` semantics by implementing them through the same prepare/finalize helpers for ordinary chats.
- [ ] Add fake-adapter tests proving one user/final pair is persisted when several tool calls occur and Brain retrieval runs once.
- [ ] Run `cd server && python3 -m unittest tests.test_brain_agent_turn -v && python3 tests/test_brain.py`.

**Acceptance:** Normal chats remain unchanged; an agent run produces one persisted user turn and one final answer, not one memory turn per tool step.

---

## Phase 2 — Reliable web evidence

### Task 7: Register search and add safe page fetching

**Files:**

- Create: `server/tools/web.py`
- Create: `server/tests/test_web_tools.py`
- Modify: `server/websearch.py`
- Modify: `server/tools/registry.py`

- [ ] Return typed `SearchHit` values with stable source/query IDs, canonical URL, host, snippet, publication date/score when provided, and provider metadata.
- [ ] Add `fetch_page(source_id)` which resolves only a source ID from the current run. Do not accept model-supplied arbitrary URLs.
- [ ] Validate every resolved address and redirect hop. Reject credentials in URLs, private/loopback/link-local/reserved addresses, unsupported schemes, unsupported MIME types, oversized bodies, and redirect loops.
- [ ] Enforce 10 seconds, 1 MiB body, 12,000 extracted characters, and no cookies/browser sessions. Extract readable HTML text only for the first version.
- [ ] Test with fake DNS, HTTP, redirect, MIME, timeout, and body-size fixtures. Cover public success and each blocked class; no live web requests.
- [ ] Run `cd server && python3 -m unittest tests.test_web_tools tests.test_websearch -v`.

**Acceptance:** Only bounded public page content from a search-result source ID can enter the run; SSRF and resource limits have deterministic tests.

### Task 8: Implement bounded Research planning and execution

**Files:**

- Create: `server/agents/__init__.py`
- Create: `server/agents/research.py`
- Modify: `server/tools/registry.py`
- Create: `server/tests/test_research.py`

- [ ] Define Pydantic `ResearchPlan`, `ResearchSource`, and `ResearchRunResult` schemas. `ResearchPlan` allows 1–3 unique, non-empty queries and a short objective; reject extra fields.
- [ ] Implement the planner using a separate adapter from `build_adapter(provider, model=model)`: send one bounded JSON-only planning prompt with the original question and approved recent typed conversation (never attachment contents), parse it into `ResearchPlan`, and close the adapter in `finally`. It must not mutate the active chat session or persist planner text. If parsing fails, fall back to the original user query and emit `plan.degraded`.
- [ ] Execute at most 3 Tavily queries concurrently from the user question/typed conversation only; never put attachment contents into a web query. Normalize/deduplicate to 12 unique sources; select no more than 3 source IDs for page fetch. Preserve deterministic result ordering after concurrency completes.
- [ ] Synthesize from structured evidence using the selected conversation adapter. Require source IDs for evidence-backed claims and include an explicit insufficient-evidence response when no useful evidence exists.
- [ ] Validate citation IDs against the evidence bundle. Retry citation repair at most once; if it remains invalid, mark the answer degraded and omit invalid links rather than inventing sources.
- [ ] Stop after the 90-second deadline, 6 tool calls, or 4 model/tool rounds. Return partial sources and a visible reason when capped.
- [ ] Test normal multi-query success, one-query fallback, duplicate URLs, conflicting dates, no results, planner invalid JSON, attachment text excluded from Tavily queries, unknown citation IDs, timeout, cancellation, and exact call-budget exhaustion.
- [ ] Run `cd server && python3 -m unittest tests.test_research -v`.

**Acceptance:** A normal multi-angle request executes more than one distinct search query, can fetch pages, produces mapped citations, and always terminates within policy.

---

## Phase 3 — Streaming trace and renderer experience

### Task 9: Stream typed run events through the API and renderer

**Files:**

- Modify: `server/api.py`
- Modify: `server/brain/brain.py`
- Modify: `apps/desktop/src/renderer/src/lib/api.ts`
- Modify: `apps/desktop/src/renderer/src/pages/Home.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChatArea.tsx`
- Create: `server/tests/test_agent_stream.py`
- Create: `apps/desktop/test/agent-events.test.mjs`

- [ ] Extend the SSE payload to typed `run.started`, `plan.ready`, `tool.started`, `tool.progress`, `source.found`, `tool.completed`, `tool.failed`, `approval.required`, `assistant.delta`, `run.completed`, `run.failed`, and `run.cancelled` events.
- [ ] Keep FastAPI responsible for validation, session locking, disconnect/cancellation, and serialization. Keep execution policy in `AgentRunner`, not `api.py`.
- [ ] Update the renderer event parser with a discriminated union. Unknown event types are logged safely and ignored; malformed JSON does not swallow a real tool error.
- [ ] Pass one `AbortSignal` through search, fetch, planning, and synthesis. On abort, cancel in-flight tasks, prohibit subsequent steps, and clear UI busy state in a `finally` path.
- [ ] Show current phase, query count, sources found/fetched, partial/degraded states, and actionable missing-Tavily-key errors. Do not display hidden chain-of-thought.
- [ ] Render source cards with title, host, publication date when present, snippet, citation ID, and an external-open action. Keep original URL and source metadata attached to the assistant message.
- [ ] Test event decoding, progress order, cancellation, malformed events, and end-state cleanup. Run `cd apps/desktop && node --test test/agent-events.test.mjs && npm run typecheck` and `cd server && python3 -m unittest tests.test_agent_stream -v`.

**Acceptance:** The user can see what Research is doing, stop it at any stage, distinguish a partial result from success, and open every cited source.

### Task 10: Replace fake modes and update product copy

**Files:**

- Modify: `apps/desktop/src/renderer/src/components/ui/chatgpt-prompt-input.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/Home.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Sidebar.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChatArea.tsx`
- Modify: `README.md`
- Modify: `apps/desktop/README.md`

- [ ] Map existing Search/Research/Plan/Write IDs to the validated mode enum in one typed boundary mapping; test every current ID and the normal-chat fallback. Keep `generateImage` on its existing explicit image-generation action, outside the agent mode enum.
- [ ] Send the original prompt and selected mode in the validated `AgentTurnRequest`, plus at most four recent user/assistant turns (8,000 characters total) for follow-up query resolution. Keep Search web as one bounded `web_search` operation.
- [ ] Remove `applyTool` and `buildSearchContext` orchestration from `Home.tsx`; Home renders state and forwards mode, it does not own research policy or stitch external pages into the user's prompt.
- [ ] Forward existing image payloads and selected text attachments through their separate `AgentTurnRequest` fields; preserve image-chat and normal attachment behavior while the server constructs bounded user-context blocks.
- [ ] Trace all `/websearch` callers after migration; remove the duplicate renderer path and endpoint only if unused, otherwise keep the validated endpoint as compatibility API.
- [ ] Rename Plan mode to a visible-plan action and return a short structured plan with goal, steps, assumptions, and risks. Do not request chain-of-thought.
- [ ] Keep Write/code as a response-style preset; show no fake tool trace for it.
- [ ] Remove or mark the Deep Research Nodes card as planned until a workspace persistence model exists.
- [ ] Update feature descriptions, setup requirements, limits, cancellation, and citations so docs describe the delivered behavior exactly.
- [ ] Run `cd apps/desktop && npm run typecheck`; manually verify Search, Research, Plan, and normal chat states with the test fixtures.

**Acceptance:** UI labels correspond to real behavior and every Research result has a trace; no generic task indicator is presented as a tool execution.

---

## Phase 4 — Additional safe tools and explicit writes

### Task 11: Add scoped memory and attachment search

**Files:**

- Modify: `server/tools/registry.py`
- Create: `server/tools/local_search.py`
- Modify: `server/api.py`
- Modify: `apps/desktop/src/renderer/src/lib/api.ts`
- Modify: `apps/desktop/src/renderer/src/pages/Home.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ui/chatgpt-prompt-input.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChatArea.tsx`
- Create: `server/tests/test_local_tools.py`
- Create: `apps/desktop/test/attachment-limits.test.mjs`

- [ ] Register `memory_search` with current-thread scope by default and `top_k` capped at 5. Cross-thread search requires explicit user selection and must not be inferred from a broad model query.
- [ ] Wire the existing user-selected `FileAttachment` UI and opaque IDs into the validated `AgentTurnRequest`; do not add another picker or accept disk paths. Preserve the existing text-file allowlist and normal-chat attachment behavior. Enforce 5 files, 5 MiB/file, and 10 MiB total before browser reading; the server-side limit is already enforced by the request contract. Discard contents when the run ends.
- [ ] Add `search_attached_files` and `read_attached_file` using only those opaque IDs. Reject unknown IDs and never accept or open a disk path.
- [ ] Mark memory hits as private local context and attachment snippets as user-provided content; keep them separate from web citations. Use `[A#]` evidence IDs for attachment excerpts and render their filename/section without an external link. Exclude attachment contents from planner input and all Tavily queries.
- [ ] Test thread-scope isolation, selected-attachment isolation, output caps, and Brain-disabled degradation; test UI count/size limits before `FileReader` reads content.
- [ ] Run `cd server && python3 -m unittest tests.test_local_tools -v` and `cd apps/desktop && node --test test/attachment-limits.test.mjs && npm run typecheck`.

**Acceptance:** Tools can access only current-thread memory and files the user explicitly attached or selected; attached content remains local to the run and every file citation maps to an attachment ID/section.

### Task 12: Add document drafting and a confirmed save path

**Files:**

- Create: `apps/desktop/src/renderer/src/components/DocumentDraftReview.tsx`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/index.d.ts`
- Modify: `apps/desktop/src/renderer/src/pages/Home.tsx`
- Create: `apps/desktop/test/document-save.test.mjs`

- [ ] Expose `draft` as an explicit `AgentTurnRequest` mode and `draft_document` as a chat artifact; supported templates are research brief, comparison, decision memo, and README. A draft does not touch disk.
- [ ] Add `save_document` only after a user presses Save and chooses a destination using Electron's file dialog. The model supplies a draft ID and suggested filename, never an absolute path.
- [ ] Preview the complete content and destination; refuse overwrite by default; validate filename; write a temporary file and atomically rename. Use an idempotency key to prevent duplicate saves after retry.
- [ ] Test cancel, path traversal filename, overwrite refusal, successful atomic save, and duplicate request. No test writes outside a temporary directory.
- [ ] Run `cd apps/desktop && node --test test/document-save.test.mjs && npm run typecheck`.

**Acceptance:** Drafting is side-effect free; saving is an explicit, previewed, user-confirmed operation scoped to one selected path.

---

## Phase 5 — Provider-native dynamic calls and evaluation

### Task 13: Enable model-selected tools only where supported

**Files:**

- Modify: provider adapter files listed in Tasks 4–5
- Modify: `server/agents/runner.py`
- Modify: `server/api.py`
- Modify: provider settings/model capability UI
- Create: `server/tests/test_agent_loop.py`

- [ ] Implement the bounded provider loop over normalized tool-call events. Start with OpenAI and Anthropic mocks, then Gemini; OpenRouter inherits only where the selected model supports it. Local models remain off unless explicitly capability-tested.
- [ ] For each loop, enforce allowed names, input schema, approval policy, call IDs, deadline, rounds, call count, and output size before invoking a handler.
- [ ] Send tool results through provider-native tool-result messages. Keep tool calls/results in adapter context for the current run but persist one logical chat turn in Brain.
- [ ] Test final-without-tools, one call, parallel safe calls, malformed args, unknown tool, tool error, denied approval, repeated call ID, max rounds, cancellation, and unsupported provider.
- [ ] Run `cd server && python3 -m unittest tests.test_agent_loop tests.test_adapter_tool_contract tests.test_brain_agent_turn -v`.

**Acceptance:** A provider can request only explicitly enabled tools; unsupported providers fall back visibly rather than simulating success.

### Task 14: Add deterministic tool evaluations and release gates

**Files:**

- Create: `server/tests/fixtures/research/`
- Create: `server/tests/test_research_eval.py`
- Modify: `.github/workflows/release-macos.yml`
- Modify: `README.md`
- Modify: `apps/desktop/RELEASE.md`

- [ ] Add recorded search/page fixtures covering stale sources, contradictory sources, prompt-injection text, empty results, malformed URLs, and citation errors. Tests never access the public internet or require API keys.
- [ ] Assert that retrieved instructions cannot change the allowlist, every citation ID exists, a failed run is not labeled complete, cancellation halts later calls, and budgets are honored.
- [ ] Keep live provider quality evaluation manual/opt-in and record provider/model/version, input query, source IDs, and reviewer outcome without storing secrets.
- [ ] Add release CI checks for unit tests, typecheck, built-server smoke test, ARM64 signature check, and DMG checksum before publishing.
- [ ] Run `cd server && python3 -m unittest discover -s tests -v` and `cd apps/desktop && npm run typecheck && npm run test:backend-port`; review repository-wide lint separately because existing unrelated lint failures were observed.

**Acceptance:** CI proves contracts, safety limits, and build integrity offline; quality claims are not inferred from a successful HTTP response alone.

---

## Audit checkpoint (worktree; not a release sign-off)

- Offline verification: 63 backend tests passed (1 embedded-bundle runtime test skipped), desktop typecheck/production renderer build passed, and 10 Node tests passed. The actual packaged app and live providers have not been exercised for this worktree.
- Fixed during review: Safe Tools cannot combine private Brain/selected-file reads with model-chosen public web tools; Electron opens only HTTP(S) external links without credentials. Both boundaries have offline regression tests.
- **Local API boundary implemented, not yet packaged-verified:** the server requires a per-process bearer token on all HTTP routes and sends no cross-origin allow headers. Electron generates the embedded server's token per launch, restricts its IPC delivery to the loaded renderer entry, and attaches it in renderer/main requests; development requires the same explicit token in both process environments. Offline hostile-origin tests pass. A fresh packaged-server smoke test and desktop launch are still required before release sign-off.
- Remaining spec gaps include partial source/answer reporting on tool-round or call-budget exhaustion, manual Search/Research/Plan/normal-chat UI verification, built-server smoke test on a freshly packaged app, live-provider quality review, and final checklist-by-checklist sign-off. Leave unchecked tasks unchecked until demonstrated.

## Rollout gates

1. Ship Tasks 1–2 first as a correctness/copy fix. Do not call the current single-query mode “Deep Research” during this interval.
2. Ship Tasks 3–10 behind an explicit Research mode. Do not enable model-autonomous tools by default.
3. Add local search/document tools only after scope and approval tests pass.
4. Enable provider-native dynamic calls per provider/model capability after mocked tests pass. A disabled capability is a valid degraded state.
5. Add each new tool only when a concrete Atlas workflow needs it; do not expose the entire catalog at once.
