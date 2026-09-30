# Atlas Multi-Mode Local Assistant Implementation Plan

> **For agentic workers:** Use the `executing-plans` skill and implement one task at a time. Each task is an independently reviewable vertical slice. Begin with a failing behavior test (RED), implement only enough to pass (GREEN), then run regressions and commit. Do not begin a task whose decision gate is unresolved.

**Goal:** Add local-first execution modes, evaluated RAG, managed local models, model routing, guarded tool extensions, structured documentation output, and a graph UI.

**Architecture:** The renderer sends a typed mode and user preferences per turn. FastAPI resolves policy before model selection and executes tools only through a backend authorization boundary. Electron main owns allowlisted local child processes; retrieval and routing preserve provenance for UI display and offline evaluation.

**Tech Stack:** Existing Electron + React + TypeScript, FastAPI/Python, SQLite/sqlite-vec, and provider adapters. Backend tests use stdlib `unittest`. Renderer behavior tests use Vitest + React Testing Library + jsdom because the desktop package currently has no test runner; select releases compatible with Vite 7 and React 19. No new runtime dependency without measured need.

**Spec:** [`../specs/2026-09-29-atlas-multi-mode-assistant-design.md`](../specs/2026-09-29-atlas-multi-mode-assistant-design.md)

## Global Constraints

- Keep the application and backend local; do not add hosted or multi-user behavior.
- Enforce privacy, mode, and tool policy in backend code, never only in prompts or the renderer.
- Auto and explicit modes cannot widen the user’s eligible model or tool set.
- No arbitrary shell strings, silent model downloads, or silent cloud routing.
- Tools validate typed inputs, use bounded time/resource limits, and report failures visibly.
- Retrieved documents, web pages, model output, MCP output, and custom Skills are untrusted input.
- Use offline fixtures for routine tests; live-provider tests require explicit opt-in and may incur cost or disclose prompts.
- Keep SQLite until evaluation justifies a storage change.
- Do not turn the entity-graph UI into branchable chat.
- The design spec is authoritative. Resolve each task’s decision gate before implementation.

---

## 1. Baseline and ownership

### Existing verification

- `server/tests/test_brain.py` is an offline smoke script using a fake adapter; it is not a discoverable `unittest` suite. No pytest dependency is present.
- `apps/desktop/package.json` provides `typecheck`, `lint`, and `build`; it has no test script or renderer test runner.
- The backend discovers models from running local endpoints and returns a per-thread entity graph. It does not launch model runtimes.

### File ownership

| Area | Files | Responsibility |
|---|---|---|
| Mode contract | `server/policy.py`, `server/api.py`, `apps/desktop/src/renderer/src/lib/api.ts` | Typed per-turn mode, privacy policy, and route/approval response contracts. |
| Mode UI | `apps/desktop/src/renderer/src/components/ModeSelector.tsx`, `chatgpt-prompt-input.tsx`, `pages/Home.tsx` | Choose and submit the mode for one prompt. |
| Model routing | `server/routing.py`, `server/factory.py`, `server/evals/` | Filter candidates by policy, rank eligible models, expose a route reason. |
| Retrieval | `server/brain/schema.sql`, `store.py`, `retriever.py`, `chunking.py`, `documents.py` | Persist source identity, index selected documents, retrieve and rank evidence. |
| Local runtime | `apps/desktop/src/main/localRuntime.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts` | Own and control only Atlas-started, allowlisted processes. |
| Tool broker | `server/tools/registry.py`, `broker.py` | Validate, authorize, execute, and report tool calls. |
| Extensions | `server/extensions/`, `server/tests/test_extensions.py` | Adapt configured MCP/Skills through the same broker after protocol decisions. |
| Documentation | `server/routing.py`, `pages/Home.tsx`, `components/ChatArea.tsx`, existing export IPC | Produce Markdown and require explicit user export. |
| Graph UI | `apps/desktop/src/renderer/src/lib/api.ts`, `components/MemoryGraph.tsx`, `components/ChatArea.tsx` | Render the existing per-thread graph with loading/empty/error states. |

Do not create a catch-all agent module or refactor unrelated code while adding these seams.

## 2. Test strategy and seams

### Test seams

- **Mode/policy/router:** public request validation and returned decisions; do not test private helper calls.
- **RAG:** retrieved results and source references through the store/retriever interface; use in-memory SQLite and deterministic embedding fixtures, not a downloaded embedding model.
- **Runtime:** start/status/stop boundary with a fake process launcher. Mock OS process creation, not Atlas-owned policy.
- **Tools/extensions:** broker request/result boundary; fake only external network/process adapters.
- **Renderer:** accessible UI behavior through React Testing Library; assert what the user can select, approve, and see.

Review these seams before implementation. Tests run one vertical slice at a time; do not write the whole suite before learning from the first cycle.

### Red → green rules

1. Add one behavior test with an independent expected result.
2. Run that exact test and observe failure for the missing behavior (RED).
3. Implement the smallest production change at the seam under test.
4. Rerun the exact test (GREEN), then the task regression checks.
5. Refactor only after GREEN; rerun tests and commit.

Backend tests use `unittest`; renderer tests use Vitest/RTL. On macOS/Linux, run backend commands with `.venv/bin/python`; on Windows, use `.venv\Scripts\python.exe`. Mock only system boundaries such as provider APIs, network, filesystem, and OS process creation. Do not use live provider credentials in routine tests.

### Shared contracts

Freeze these in Task 1 before wiring UI and server behavior:

- `ExecutionMode`: `auto | research | coding | documentation`.
- `ModelCandidate`: provider, model, declared capabilities, and local/cloud location.
- `ExecutionPolicy`: `allow_cloud` privacy setting and tool capabilities within the application-owned allowlist; an empty enabled-tool set denies execution. Unset/malformed policy is local-only and denies tools. User settings cannot widen the application-owned maximum.
- Optional custom instruction text is separate from structured policy and is advisory only; text cannot grant model, network, file, or process capabilities.
- `ModeDecision`: `requested_mode` plus nullable `effective_mode`; explicit modes resolve immediately, while Auto remains unresolved until Task 7.
- `RouteDecision`: effective mode, provider/model, reason, and `ready | no_eligible_model | degraded` status.
- `ToolDecision`: `allow | require_approval | deny`, reason, and invocation-bound approval data; implemented with Task 8’s broker.
- Each turn carries an optional mode (default `auto`) and optional model preference alongside existing prompt/image fields.
- Streaming events preserve existing token/memory/error behavior and add route/tool state with typed, documented event names.
- Python and TypeScript use the same enum values and serialized field names.

The classifier algorithm, event payload details, privacy UI, and external protocols remain decision gates where marked below; tests must not assume them early.

## 3. Dependency order

```text
Task 1: backend mode/policy contract ──┬────> Task 2: renderer mode UI
                                        ├────> Task 6: authenticated policy settings
                                        ├────> Task 7: model router
                                        └────> Task 10: Documentation output
Task 2: renderer test harness/mode UI ──┬────> Task 4: document UI tests
                                        ├────> Task 5: local runtime tests
                                        ├────> Task 6: policy settings UI
                                        └────> Task 7: route UI
Task 3: RAG evaluation baseline ──────────────> Task 4: selected-document RAG
Task 5: local runtime lifecycle ─────────────> Task 6: authenticated policy settings
Task 6: authenticated policy settings ──┬────> Task 7: model router
                                        └────> Task 8: tool broker ─> Task 9: MCP/Skills
Task 7: model router ────────────────────────> Task 8: tool broker
Task 7: model router ────────────────────────> Task 10: Documentation output
Existing graph API ───────────────────────────> Task 11: graph UI
```

Implement and review one task at a time. Do not parallelize changes to the shared request/stream contract.

---

## Phase 0 — Contracts and offline/test foundation

**Phase gate:** Freeze typed mode and policy contracts, safe default policy, and the renderer test stack before provider routing or tool execution.

### Task 1 — Backend mode and execution-policy contract

**Files:**
- Create: `server/policy.py`
- Test: `server/tests/test_policy.py`
- Modify: `server/api.py`

**Interfaces:**
- `ExecutionMode`: enum values `auto`, `research`, `coding`, `documentation`.
- `Message.mode` and `ChatOnce.mode`: optional typed fields defaulting to `auto`.
- `resolve_explicit_mode(mode) -> ModeDecision` preserves explicit choices; `auto` returns `effective_mode=None` until Task 7 adds classification.
- `eligible_models(mode, candidates, policy) -> list[ModelCandidate]` filters by capability and cloud/local policy before ranking. Each candidate exposes `provider`, `model`, `capabilities`, and `is_local`; policy exposes `allow_cloud` and `allowed_tools`.
- An unset policy is local-only with no enabled tools. This is an in-memory policy contract in this task; authenticated persistence is added before policy settings UI or tools.
- Tool execution remains unavailable until Task 8’s broker; custom instruction text is never read by `eligible_models` or tool authorization.

**TDD slice — request mode contract:**

- [ ] **Step 1: Write the failing behavior test.**

```python
from unittest import TestCase
from policy import ExecutionMode, ExecutionPolicy, ModelCandidate, eligible_models, resolve_explicit_mode

class ModeContractTests(TestCase):
    def test_explicit_coding_mode_is_preserved(self):
        decision = resolve_explicit_mode(ExecutionMode.CODING)
        self.assertEqual(decision.requested_mode, ExecutionMode.CODING)
        self.assertEqual(decision.effective_mode, ExecutionMode.CODING)

    def test_auto_remains_unresolved(self):
        decision = resolve_explicit_mode(ExecutionMode.AUTO)
        self.assertIsNone(decision.effective_mode)

    def test_unknown_mode_is_rejected(self):
        with self.assertRaises(ValueError):
            ExecutionMode('unknown')

    def test_local_only_policy_excludes_cloud_candidates(self):
        cloud = ModelCandidate('openai', 'model-a', frozenset({'research'}), is_local=False)
        local = ModelCandidate('local', 'model-b', frozenset({'research'}), is_local=True)
        result = eligible_models(
            ExecutionMode.RESEARCH, [cloud, local], ExecutionPolicy(allow_cloud=False)
        )
        self.assertEqual([item.provider for item in result], ['local'])
```

- [ ] **Step 2: Run RED.** From `server`, run `.venv/bin/python -m unittest tests.test_policy.ModeContractTests -v`. Expected: the policy contract is missing or fails one of its behavior assertions.
- [ ] **Step 3: Implement the typed mode and explicit-mode behavior only.** Do not add Auto heuristics or tools in this task.
- [ ] **Step 4: Run GREEN.** From `server`, run `.venv/bin/python -m unittest tests.test_policy -v`, `.venv/bin/python -m unittest discover -s tests -p 'test_*.py'`, and `.venv/bin/python tests/test_brain.py`.
- [ ] **Step 5: Commit.** `git add server/policy.py server/tests/test_policy.py server/api.py && git commit -m "feat: define execution mode policy"`.

**Acceptance:** The API has a typed per-turn mode with a safe `auto` default; explicit modes are preserved; unsupported values fail validation; the default policy is local-only/no-tools; policy filtering is separate from prompt construction.

---

### Task 2 — Renderer test harness and per-turn mode selection

**Files:**
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/src/renderer/src/lib/modes.ts`
- Create: `apps/desktop/src/renderer/src/components/ModeSelector.tsx`
- Test: `apps/desktop/src/renderer/src/components/ModeSelector.test.tsx`
- Test: `apps/desktop/src/renderer/src/lib/api.test.ts`
- Modify: `apps/desktop/package.json`, `apps/desktop/package-lock.json`, `apps/desktop/src/renderer/src/components/ui/chatgpt-prompt-input.tsx`, `apps/desktop/src/renderer/src/pages/Home.tsx`, `apps/desktop/src/renderer/src/lib/api.ts`

**Interfaces:**
- `ExecutionMode` in `lib/modes.ts` mirrors the Python enum exactly.
- `ModeSelector` accepts `{ value: ExecutionMode; onChange(mode: ExecutionMode): void }` and provides an accessible native select.
- The prompt submit callback carries the selected mode; the API client serializes it as `mode` on the per-turn request.

**TDD slice — mode choice reaches the request:**

- [ ] **Step 1: Add the minimal renderer test tooling.** From `apps/desktop`, run `npm install -D vitest @testing-library/react jsdom`; keep the resolved versions compatible with installed Vite 7/React 19. Add `npm test` as `vitest` and configure the existing `@` alias with jsdom for renderer tests. Mark Electron-main tests with the Node environment. Do not add `user-event` or a browser automation framework for this slice.
- [ ] **Step 2: Write failing component and API-client tests.** The component test below asserts the accessible mode change. The API test mocks only `fetch` and asserts the serialized request includes the selected mode and preserves existing prompt/images.

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ModeSelector } from './ModeSelector'

it('reports Research when selected', () => {
  const onChange = vi.fn()
  render(<ModeSelector value="auto" onChange={onChange} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Execution mode' }), {
    target: { value: 'research' }
  })
  expect(onChange).toHaveBeenCalledWith('research')
})
```

- [ ] **Step 3: Run RED.** `cd apps/desktop && npm test -- --run src/renderer/src/components/ModeSelector.test.tsx src/renderer/src/lib/api.test.ts`. Expected: selector behavior and request serialization fail before implementation.
- [ ] **Step 4: Implement the selector and prompt callback.** Use a native `<select>`; keep mode state scoped to the prompt/turn. Add the four labels and typed values.
- [ ] **Step 5: Run GREEN.** Rerun both focused tests and confirm mode selection reaches the request unchanged.
- [ ] **Step 6: Run regressions.** `cd apps/desktop && npm test -- --run && npm run typecheck && npm run lint`.
- [ ] **Step 7: Commit.** `git add apps/desktop/vitest.config.ts apps/desktop/package.json apps/desktop/package-lock.json apps/desktop/src/renderer/src/lib/modes.ts apps/desktop/src/renderer/src/components/ModeSelector.tsx apps/desktop/src/renderer/src/components/ModeSelector.test.tsx apps/desktop/src/renderer/src/lib/api.test.ts apps/desktop/src/renderer/src/components/ui/chatgpt-prompt-input.tsx apps/desktop/src/renderer/src/pages/Home.tsx apps/desktop/src/renderer/src/lib/api.ts && git commit -m "feat: select execution mode per turn"`.

**Acceptance:** Users can select all four modes accessibly; chosen mode reaches the API request; existing attachments, stop, and send behavior remain unchanged.

---

### Task 3 — Offline RAG ranking/chunking baseline

**Files:**
- Create: `server/evals/rag_metrics.py`
- Create: `server/evals/rag_fixtures.jsonl`
- Test: `server/tests/test_rag_metrics.py`
- Modify only if required to expose the existing baseline: `server/brain/store.py`, `server/brain/retriever.py`

**Interfaces:**
- `recall_at_k(relevant_ids, ranked_ids, k) -> float`.
- `reciprocal_rank(relevant_ids, ranked_ids) -> float`.
- `ndcg_at_k(relevant_ids, ranked_ids, k) -> float`, using binary relevance for the first fixture set.
- The fixture runner reports metric values and fixture version; it makes no LLM or external API calls.

**TDD slice — metric behavior:**

- [ ] **Step 1: Write failing tests with hand-calculated expected values and a versioned fixture.** Test each metric’s known result, empty inputs, invalid `k`, and runner output for the checked-in query/labels.

```python
from unittest import TestCase
from evals.rag_metrics import ndcg_at_k, recall_at_k, reciprocal_rank

class RagMetricTests(TestCase):
    def test_relevant_items_at_known_ranks(self):
        relevant = {'b', 'c'}
        ranked = ['a', 'b', 'x']
        self.assertEqual(recall_at_k(relevant, ranked, 2), 0.5)
        self.assertEqual(reciprocal_rank(relevant, ranked), 0.5)
        self.assertAlmostEqual(ndcg_at_k(relevant, ranked, 2), 0.3868528072)
```

- [ ] **Step 2: Run RED.** From `server`, run `.venv/bin/python -m unittest tests.test_rag_metrics -v`. Expected: missing functions or incorrect metric values.
- [ ] **Step 3: Implement metrics and runner with stdlib only.** Empty rankings and empty relevant sets return zero; invalid `k` is rejected.
- [ ] **Step 4: Run GREEN.** From `server`, run `.venv/bin/python -m unittest tests.test_rag_metrics -v` and `.venv/bin/python -m evals.rag_metrics`.
- [ ] **Step 5: Commit.** `git add server/evals/rag_metrics.py server/evals/rag_fixtures.jsonl server/tests/test_rag_metrics.py server/brain/store.py server/brain/retriever.py && git commit -m "test: establish offline rag baseline"` (omit unchanged paths from `git add`).

**Evaluation output:** Report Recall@k, MRR, and nDCG for fixed queries; for chunking comparisons, also report chunk count/size and source-level recall using identical source text and labels. Model-generated answer quality is reviewed separately from retrieval ranking.

**Acceptance:** Current retrieval has a reproducible offline baseline before ranking/chunking changes; metrics have independent expected values; fixtures contain no private user data.

---

## Phase 1 — Local retrieval and model runtime

**Phase gate:** Approve supported document formats/limits and runtime/OS allowlist before touching user files or starting processes.

### Task 4 — Selected-document ingestion and source-aware retrieval

**Files:**
- Create: `server/brain/documents.py`
- Test: `server/tests/test_documents.py`
- Create: `apps/desktop/src/renderer/src/components/DocumentLibrary.tsx`
- Test: `apps/desktop/src/renderer/src/components/DocumentLibrary.test.tsx`
- Modify: `server/brain/schema.sql`, `server/brain/store.py`, `server/brain/retriever.py`, `server/brain/chunking.py`, `server/api.py`, `apps/desktop/src/renderer/src/lib/api.ts`

**Interfaces:**
- `ingest_document(name, text) -> source_id`; `delete_document(source_id)`; `search_documents(query, limit) -> list[RetrievalHit]`.
- Each `RetrievalHit` retains `source_id`, display name, chunk ID, and ranking score.
- Re-ingesting identical content is idempotent; deleting a source removes its chunks from future results.

**Decision gate:** Approve text formats, size limits, deletion/re-index semantics, and whether URL ingestion is excluded. No binary extraction or background folder crawl in this task.

**TDD slice — source lifecycle:**

- [ ] **Step 1: Write failing backend and UI behavior tests before implementation.** Backend covers source ID/name provenance, unique-phrase search, deletion, identical-content idempotency, and rejected unsupported/oversized input without partial writes. The RTL test selects one supported text file, verifies one API submission, renders returned provenance, and checks deletion updates the list.
- [ ] **Step 2: Run RED.** From `server`, `.venv/bin/python -m unittest tests.test_documents -v`; from `apps/desktop`, `npm test -- --run src/renderer/src/components/DocumentLibrary.test.tsx`. Expected: both fail because document lifecycle/UI are missing.
- [ ] **Step 3: Implement minimal SQLite persistence and the API boundary.** Reuse the existing brain DB and add only source/version linkage for selected documents. Keep chat-memory retrieval unchanged; use deterministic embeddings in tests.
- [ ] **Step 4: Implement the document picker/list UI** using the browser File API only for the user-selected text file; no renderer filesystem access or background folder crawl.
- [ ] **Step 5: Run GREEN.** From `server`, run `.venv/bin/python -m unittest tests.test_documents -v`, `.venv/bin/python tests/test_brain.py`, and `.venv/bin/python -m evals.rag_metrics`; from `apps/desktop`, run the focused UI test.
- [ ] **Step 6: Run regressions.** Run backend discovery and desktop test/typecheck/lint.
- [ ] **Step 7: Commit.** `git add server/brain/documents.py server/tests/test_documents.py server/brain/schema.sql server/brain/store.py server/brain/retriever.py server/brain/chunking.py server/api.py apps/desktop/src/renderer/src/lib/api.ts apps/desktop/src/renderer/src/components/DocumentLibrary.tsx apps/desktop/src/renderer/src/components/DocumentLibrary.test.tsx && git commit -m "feat: index selected local documents"`.

**Acceptance:** Selected documents are searchable with provenance, duplicate ingestion is idempotent, deletion removes results, and any retrieval/chunking change is compared against Task 3’s baseline.

### Task 4a — Composer model picker and honest UI references

**Files:** `apps/desktop/src/renderer/src/components/ChatArea.tsx`, `components/ui/chatgpt-prompt-input.tsx`, their existing RTL tests.

**Decision:** Use the screenshot's searchable, upward-opening model picker inside the composer; show connected models only, with generic cloud/local glyphs instead of AI brand logos. Preserve the selected provider/model and mode on submission and across chat changes. Do not label a disconnected model as available.

**TDD slice:** First make `ChatArea.test.tsx` fail: the picker is inside the composer rather than the header; filtering hides nonmatches; selecting a local model sends its actual provider/model; reply avatars contain no brand-logo image. Then implement and rerun all renderer tests, typecheck, and build. Keep the existing local API security boundary unchanged.

**UI references:** https://www.beautifului.dev/ and the supplied Loading State, Thinking, Streaming Text, Approval Card, Tool Chips, Recommendation Card, Context Cards, and Code Block examples are *visual/interaction references*, not working agents or data fixtures. Use actual backend run events, source IDs, approval decisions, and file provenance when later tasks provide them. Do not copy hardcoded example searches, citations, model claims, commands, files, reasoning text, timers pretending work completed, or externally hosted meme video. Loading/failed/empty/cancelled states must be explicit; respect reduced motion and keyboard access.

**Deferred future scope:** `../specs/2026-09-30-unified-model-gateway-billing-design.md` and `2026-09-30-unified-model-gateway-billing.md` preserve the Contabo gateway/Razorpay architecture. Do not add payment or cloud billing work to Tasks 5–11; those gates remain unresolved.

### Task 4b — Honest pending-response loading state

**Files:** `apps/desktop/src/renderer/src/components/LoadingState.tsx`, `LoadingState.test.tsx`, `ChatArea.tsx`, `ChatArea.test.tsx`, `assets/main.css`.

**TDD slice:** Write a failing component test for a real elapsed timer whose ticks are hidden from assistive-tech announcements and an integration test that shows status only while `isSending` is pending. Replace the rotating invented activity verbs with the supplied pixel grid and existing neutral shimmer; freeze both for reduced-motion users. Run focused tests RED/GREEN, all renderer tests, typecheck, and build. No fake tool phases, reasoning trace, third-party video, or background network request.

**Registry reference:** https://www.beautifului.dev/r/loading-state.json and https://github.com/slev12397/beautiful-ui/blob/main/app/globals.css. The registry pulls `foundation.json` (global token overrides, base styles, and `shadow-plugin/unprefixed`), which does not belong in Atlas’s existing Electron theme. Adapt the scoped `pixel-on` keyframes only; do not run `shadcn add` against the app or load its external Surfer video.

**Acceptance:** Pending work shows accurate elapsed time; its indicator disappears when the reply stops pending, and no UI claims an unperformed search or tool call.

**Remaining Beautiful UI test seams:** Task 7 route events enable actual streamed-text/citation display (verified IDs only); Task 8 broker events enable expandable Thinking/Tool Chips and invocation-bound Approval Card; document-to-chat provenance enables Context Cards; an approved proposal/changed-file contract is required before Recommendation Card and diff-mode Code Block. Existing code highlighting and source cards remain in use until real replacements pass behavior tests. No sample rows, animations, or follow-ups may substitute for backend results.

---

### Task 5 — Allowlisted local-runtime lifecycle manager

**Files:**
- Create: `apps/desktop/src/main/localRuntime.ts`, `apps/desktop/src/shared/localRuntime.ts`
- Test: `apps/desktop/src/main/localRuntime.test.ts`, `apps/desktop/src/renderer/src/components/Profile.test.tsx`
- Modify: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/preload/index.d.ts`, `apps/desktop/src/renderer/src/components/Profile.tsx`

**Interfaces:**
- `start(runtimeId)`, `status(runtimeId)`, and `stop(runtimeId)` accept only registered runtime IDs.
- Each runtime registry entry owns the executable resolution and fixed argument array; `shell` is always false.
- Atlas stops only child processes it started; an already-running service is never killed.
- States are `starting | ready | unavailable | failed`; startup failure does not block cloud/chat use.

**Decision gate — approved:** Start an already-installed Ollama binary (version unpinned) on macOS ARM64 only. Keep discovery for other already-running OpenAI-compatible services; do not manage their processes.

**TDD slice — process ownership:**

- [x] **Step 1: Write failing lifecycle tests before implementation** with a fake process launcher: fixed command/arguments and `shell: false`; unknown runtime rejected; repeated start idempotent; external process never killed; missing executable, early exit, and readiness timeout bounded; shutdown skips probing unless Atlas owns a child. Added Profile-control coverage for explicit start/stop and process ownership.
- [x] **Step 2: Run RED.** The lifecycle test initially failed because the manager module was absent; the Profile-control test failed because the exported control was absent.
- [x] **Step 3: Implement the minimal manager.** Main-process IPC validates the renderer frame and fixed runtime ID; the renderer receives no process API.
- [x] **Step 4: Run GREEN.** The renderer/lifecycle suite, typecheck, and production build pass. Scoped ESLint reports no errors in the runtime/preload/UI additions; repo-wide lint remains blocked by 69 existing errors and 261 warnings. Manual start/stop was not run because `ollama` is not installed in the current environment.
- [x] **Step 5: Commit.** Stage only this task’s manager, shared contract, IPC, Profile control/tests, and this plan; commit as `feat: manage allowlisted local model runtime`.

**Acceptance:** Only approved installed runtimes start; readiness/failure is visible; arbitrary command text is never executed; Atlas never downloads a model or stops a process it did not start.

---

## Phase 2 — Policy-constrained routing and tools

**Phase gate:** Agree on Auto evaluation threshold, privacy behavior, tool scopes, and approval semantics before enabling routing or actions.

### Task 6 — Authenticated local policy settings

**Files:**
- Create: `server/api_auth.py`, `server/tests/test_api_auth.py`, `server/tests/test_policy_api.py`
- Create: `apps/desktop/src/main/apiAuth.ts`
- Test: `apps/desktop/src/main/apiAuth.test.ts`, `apps/desktop/src/renderer/src/lib/api.test.ts`
- Create: `apps/desktop/src/renderer/src/components/ExecutionPolicySettings.tsx`, `apps/desktop/src/renderer/src/components/ExecutionPolicySettings.test.tsx`
- Modify: `server/api.py`, `server/credentials_store.py`, `server/run_server.py`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/preload/index.d.ts`, `apps/desktop/src/renderer/src/lib/api.ts`, `apps/desktop/src/renderer/src/components/Profile.tsx`

**Interfaces:**
- Authenticated `GET/PUT /settings/policy` exposes only typed fields: cloud allowed/denied and `allowed_tools` within the application-owned allowlist.
- Persist a validated, versioned policy value in the existing local SQLite key/value store; unset or malformed state is local-only and denies all tools.
- All app data, model-execution, policy, and action routes require the approved current-app-session credential; only a minimal health probe may be exempt. CORS/origin checks are additional controls, not authentication.

**Decision gate:** Before implementation, choose the per-app-session credential bootstrap, renderer/main ownership, protected route list, and CORS/origin policy. The current wildcard CORS setting is not an authorization boundary; do not expose policy mutation or tool routes until this gate is approved.

**TDD slice — local API trust and policy persistence:**

- [ ] **Step 1: Write failing server/main/client tests before implementation.** Missing/invalid credentials and disallowed origins cannot read chat/stream data or mutate policy/tool routes; valid app-session calls can reach them and round-trip settings; malformed stored JSON fails closed; shared and streaming API requests include the session credential without persisting it.
- [ ] **Step 2: Run RED.** From `server`, run `.venv/bin/python -m unittest tests.test_api_auth tests.test_policy_api -v`; from `apps/desktop`, run `npm test -- --run src/main/apiAuth.test.ts`.
- [ ] **Step 3: Implement the approved session credential boundary** across Electron main/preload, the server bootstrap, shared/streaming API clients, and all app data/model/action routes (except the approved minimal health probe). Persist policy through `credentials_store` using a versioned key; do not source policy from renderer-only state or `.env`.
- [ ] **Step 4: Run GREEN** for the focused auth/policy tests.

**TDD slice — user policy controls:**

- [ ] **Step 5: Write failing RTL tests** for loading/saving cloud permission and enabled tools; invalid/unregistered tools cannot be selected; a saved setting survives reload.
- [ ] **Step 6: Run RED.** `cd apps/desktop && npm test -- --run src/renderer/src/components/ExecutionPolicySettings.test.tsx`.
- [ ] **Step 7: Implement the small settings panel** in the existing Profile advanced section; do not treat free-text custom instructions as security policy.
- [ ] **Step 8: Run GREEN/regressions.** From `server`, run focused auth/policy tests and full unittest discovery; from `apps/desktop`, run all Vitest tests, typecheck, and lint.
- [ ] **Step 9: Commit.** `git add server/api_auth.py server/tests/test_api_auth.py server/tests/test_policy_api.py server/api.py server/credentials_store.py server/run_server.py apps/desktop/src/main/apiAuth.ts apps/desktop/src/main/apiAuth.test.ts apps/desktop/src/renderer/src/lib/api.test.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/preload/index.d.ts apps/desktop/src/renderer/src/lib/api.ts apps/desktop/src/renderer/src/components/Profile.tsx apps/desktop/src/renderer/src/components/ExecutionPolicySettings.tsx apps/desktop/src/renderer/src/components/ExecutionPolicySettings.test.tsx && git commit -m "feat: secure local execution policy settings"`.

**Acceptance:** Only the running desktop app can access app data, trigger model execution, or change policy; the renderer exposes only allowlisted settings; persisted state fails closed; no cloud model or tool is silently enabled.

---

### Task 7 — Auto mode and evaluated model router

**Files:**
- Create: `server/routing.py`
- Test: `server/tests/test_model_routing.py`
- Create/modify: `server/evals/routing_fixtures.jsonl`, `server/evals/routing.py`
- Test: `server/tests/test_routing_api.py`, `server/tests/test_auto_mode.py`
- Test: `apps/desktop/src/renderer/src/components/ChatArea.test.tsx`, `apps/desktop/src/renderer/src/lib/api.test.ts`
- Modify: `server/policy.py`, `server/factory.py`, `server/api.py`, `apps/desktop/src/renderer/src/lib/api.ts`, `apps/desktop/src/renderer/src/pages/Home.tsx`, `apps/desktop/src/renderer/src/components/ChatArea.tsx`

**Interfaces:**
- `choose_model(mode, candidates, policy, preference=None) -> RouteDecision` first filters ineligible models, then ranks eligible ones.
- Candidate capability metadata is explicit; no unsupported capability is inferred from a model name.
- Evaluation records mode accuracy/confusion, human-reviewed task-quality score by mode, latency, estimated cost when available, and policy-violation count (required value: zero). Each report names fixture/model-catalog versions; self-reported model quality is not a score.
- Auto classification chooses one of Research/Coding/Documentation per turn. Explicit user mode wins for that turn.
- Route result includes chosen mode/model, reason, and `ready | no_eligible_model | degraded` state.

**Decision gate:** Agree on labeled intent examples, low-confidence behavior, capability fields, route explanation, and quality/cost/latency weights. Cloud use remains disabled until Task 6’s authenticated user setting is enabled. Freeze backward-compatible response/stream event names and payloads before Step 9 tests. Compare a deterministic classifier with any proposed model classifier using offline fixtures before external inference.

**TDD slice — hard-filter before ranking:**

- [ ] **Step 1: Write failing route tests.** Local-only policy chooses a local eligible model over a higher-scoring cloud model; cloud-only returns `no_eligible_model`; incompatible capabilities are filtered; a permitted manual preference is honored; forbidden preference never bypasses policy.
- [ ] **Step 2: Run RED.** From `server`, run `.venv/bin/python -m unittest tests.test_model_routing -v`.
- [ ] **Step 3: Implement filter-then-rank.** Policy filtering runs before quality/cost/latency scoring. No fallback can escape the eligible set.
- [ ] **Step 4: Run GREEN** for route-selection tests.

**TDD slice — Auto classification:**

- [ ] **Step 5: Add fixed labeled intent fixtures and failing tests** for each mode, ambiguous input, and the agreed low-confidence behavior. Fixture version and expected labels are checked in; no live model calls.
- [ ] **Step 6: Run RED.** From `server`, run `.venv/bin/python -m unittest tests.test_auto_mode -v`; expected: Auto decision/evaluation is missing or below the agreed behavior.
- [ ] **Step 7: Implement only the classifier approved at the decision gate.** Report accuracy/confusion and mode-level human-reviewed task quality; retain it only if it meets the agreed threshold.
- [ ] **Step 8: Run GREEN** and `.venv/bin/python -m evals.routing` against the fixed fixtures.

**TDD slice — API and route visibility:**

- [ ] **Step 9: Write failing API/renderer tests** before wiring: selected mode/model/reason and degraded/no-eligible status are returned in response/stream metadata and rendered; only context actually sent to a provider is retained when switching provider.
- [ ] **Step 10: Run RED.** From `server`, run `.venv/bin/python -m unittest tests.test_routing_api -v`; from `apps/desktop`, run `npm test -- --run src/renderer/src/components/ChatArea.test.tsx src/renderer/src/lib/api.test.ts`.
- [ ] **Step 11: Implement per-turn API and renderer wiring** using the frozen event contract.
- [ ] **Step 12: Run GREEN/regressions.** From `server`, run `.venv/bin/python -m unittest tests.test_model_routing tests.test_auto_mode tests.test_routing_api -v`, full unittest discovery, `.venv/bin/python tests/test_brain.py`, and `.venv/bin/python -m evals.routing`; from `apps/desktop`, run `npm test -- --run`, `npm run typecheck`, and `npm run lint`.
- [ ] **Step 13: Commit.** `git add server/routing.py server/tests/test_model_routing.py server/tests/test_auto_mode.py server/tests/test_routing_api.py server/evals/routing_fixtures.jsonl server/evals/routing.py server/policy.py server/factory.py server/api.py apps/desktop/src/renderer/src/lib/api.ts apps/desktop/src/renderer/src/lib/api.test.ts apps/desktop/src/renderer/src/pages/Home.tsx apps/desktop/src/renderer/src/components/ChatArea.tsx apps/desktop/src/renderer/src/components/ChatArea.test.tsx && git commit -m "feat: route turns by mode and policy"`.

**Acceptance:** Auto and explicit modes work per message; the user can manually prefer an eligible model; route choices are explainable and evaluated; privacy/capability constraints are never bypassed.

---

### Task 8 — Guarded dynamic tool broker and approval flow

**Files:**
- Create: `server/tools/__init__.py`, `server/tools/registry.py`, `server/tools/broker.py`, `server/tests/test_tool_broker.py`, `server/tests/test_tool_api.py`
- Create: `apps/desktop/src/renderer/src/components/ToolApproval.tsx`, `apps/desktop/src/renderer/src/components/ToolApproval.test.tsx`
- Modify: `server/api.py`, `apps/desktop/src/renderer/src/lib/api.ts`, `apps/desktop/src/renderer/src/pages/Home.tsx`
- Adapt existing `server/websearch.py` and `server/imagegen.py` only through explicit registry entries

**Interfaces:**
- A tool request has invocation ID, registered name, and typed arguments.
- Broker result is `completed | denied | awaiting_approval | failed`, with a user-readable summary and bounded output.
- Approval binds to the invocation and arguments; approval cannot be replayed for another invocation or changed arguments.
- Models propose calls; only the broker executes them.

**Decision gate:** Local API authorization is completed in Task 6. Define tool scopes, network-disclosure behavior, approval expiration, and which low-risk tools may run without approval before enabling any adapter. The initial broker slice excludes arbitrary shell and file writes; add workspace-scoped mutations/commands only after their boundary and approval UX are specified.

**TDD slice — broker authorization:**

- [ ] **Step 1: Write failing broker/API tests before implementation.** An enabled registered read-only call completes; existing Search/Image adapters preserve their response contracts under fixtures; a sensitive registered fixture returns `awaiting_approval`, then completes only after correct approval; approval for invocation A cannot authorize changed arguments or invocation B; unknown tool, malformed arguments, deny, timeout, external failure, or custom instructions asking to ignore policy never produce `completed`. File-write and shell executors remain absent in this phase.
- [ ] **Step 2: Run RED.** From `server`, run `.venv/bin/python -m unittest tests.test_tool_broker tests.test_tool_api -v`.
- [ ] **Step 3: Implement registry and broker.** Validate registered schemas, evaluate backend-owned policy, request approval when needed, execute only through injected registered adapters, and cap time/output.
- [ ] **Step 4: Run GREEN** for broker/API authorization tests.

**TDD slice — approval UI:**

- [ ] **Step 5: Write failing renderer tests** for the approval summary/effects; approve and deny produce distinct requests; prompts, modes, and custom instruction text never implicitly approve.
- [ ] **Step 6: Run RED.** `cd apps/desktop && npm test -- --run src/renderer/src/components/ToolApproval.test.tsx`.
- [ ] **Step 7: Implement the approval UI/API wiring** over the authenticated broker endpoint.
- [ ] **Step 8: Run GREEN/regressions.** From `server`, run focused broker/API tests, full unittest discovery, and `.venv/bin/python tests/test_brain.py`; from `apps/desktop`, run `npm test -- --run`, `npm run typecheck`, and `npm run lint`.
- [ ] **Step 9: Commit.** `git add server/tools/__init__.py server/tools/registry.py server/tools/broker.py server/tests/test_tool_broker.py server/tests/test_tool_api.py server/api.py apps/desktop/src/renderer/src/lib/api.ts apps/desktop/src/renderer/src/pages/Home.tsx apps/desktop/src/renderer/src/components/ToolApproval.tsx apps/desktop/src/renderer/src/components/ToolApproval.test.tsx server/websearch.py server/imagegen.py && git commit -m "feat: authorize dynamic tool calls"`.

**Acceptance:** Every model-proposed operation crosses the broker; high-risk actions require invocation-bound approval; custom instructions cannot authorize tools; existing explicit Search/Image behavior retains parity.

---

### Task 9 — MCP and custom Skills behind the broker

**Files:**
- Create: `server/extensions/__init__.py`, `server/extensions/mcp_client.py`, `server/extensions/skills.py`, `server/extensions/store.py`, `server/tests/fixtures/extensions/mcp_tools.json`, `server/tests/fixtures/extensions/denied_skill.md`, `server/tests/test_extensions.py`
- Create: `apps/desktop/src/renderer/src/components/ExtensionSettings.tsx`, `apps/desktop/src/renderer/src/components/ExtensionSettings.test.tsx`
- Modify: `server/api.py`, `apps/desktop/src/renderer/src/components/Profile.tsx`, `apps/desktop/src/renderer/src/lib/api.ts`
- Persist extension metadata/enable state separately from provider credentials; never store extension secrets in renderer profile data

**Interfaces:**
- MCP-declared capabilities register with the same tool broker as built-in tools.
- A Skill contributes instructions/context only; it cannot grant a capability.
- Extension origin, permissions, enable/disable state, and owned-process lifecycle are visible and revocable.

**Decision gate:** Choose MCP transport(s), custom Skill file format, extension process owner, and sandbox/permission model before implementation. The tests below use a recorded fixture for the selected protocol, not a live server.

**TDD slice — extension cannot widen policy:**

- [ ] **Step 1: Record protocol fixtures and write failing backend/UI tests before implementation.** Cover declared-but-denied action, Skill text requesting an unapproved action, disabled/revoked extension receiving no later call, owned-process-only shutdown, persistence/reload, and visible origin/permission/enable state.
- [ ] **Step 2: Run RED.** From `server`, run `.venv/bin/python -m unittest tests.test_extensions -v`; from `apps/desktop`, run `npm test -- --run src/renderer/src/components/ExtensionSettings.test.tsx`.
- [ ] **Step 3: Implement the smallest adapter and settings view** that maps declared capabilities to the broker without trusting extension output; no live protocol endpoint in routine tests.
- [ ] **Step 4: Run GREEN/regressions.** From `server`, run `.venv/bin/python -m unittest tests.test_extensions -v` and full unittest discovery; from `apps/desktop`, run `npm test -- --run`, `npm run typecheck`, and `npm run lint`. No external service runs in routine tests.
- [ ] **Step 5: Commit.** `git add server/extensions/__init__.py server/extensions/mcp_client.py server/extensions/skills.py server/extensions/store.py server/tests/fixtures/extensions/mcp_tools.json server/tests/fixtures/extensions/denied_skill.md server/tests/test_extensions.py server/api.py apps/desktop/src/renderer/src/components/Profile.tsx apps/desktop/src/renderer/src/components/ExtensionSettings.tsx apps/desktop/src/renderer/src/components/ExtensionSettings.test.tsx apps/desktop/src/renderer/src/lib/api.ts && git commit -m "feat: add policy-bound extensions"`.

**Acceptance:** Custom MCP servers and Skills cannot bypass the broker, authorize themselves, or continue operating after disable/revoke.

---

## Phase 3 — Documentation and graph experiences

**Phase gate:** Keep documentation generation side-effect-free; approve templates separately. Use the existing graph API and keep chat independent of graph loading.

### Task 10 — Documentation mode and explicit export

**Files:**
- Test: `server/tests/test_documentation_mode.py`
- Test: `apps/desktop/src/renderer/src/components/DocumentationExport.test.tsx`
- Modify: `server/routing.py`, `server/policy.py`, `apps/desktop/src/renderer/src/pages/Home.tsx`, `apps/desktop/src/renderer/src/components/ChatArea.tsx`; do not add export IPC in this task

**Interfaces:**
- Documentation mode returns Markdown content and mode metadata.
- Generation does not write files. Existing user-triggered export remains separate and goes through Electron-owned IPC; renderer has no filesystem access.
- The approved minimum Markdown structure is fixed for v1. Add user-selectable templates only after an explicit template decision; templates cannot relax tool/file policy.

**Decision gate:** Agree the exact minimum Markdown sections and keep the test fixture literal; confirm the existing export action remains separate. Do not infer a template system from “structured Markdown.”

**TDD slice — generation does not silently save:**

- [ ] **Step 1: Write failing tests.** A Documentation turn returns Markdown content and mode metadata; response completion does not invoke file export; the existing separate export remains user-triggered.
- [ ] **Step 2: Run RED.** `.venv/bin/python -m unittest tests.test_documentation_mode -v` and `cd apps/desktop && npm test -- --run src/renderer/src/components/DocumentationExport.test.tsx`.
- [ ] **Step 3: Implement the minimal Documentation mode framing** and leave output as Markdown; use a fake provider only at the external adapter boundary.
- [ ] **Step 4: Run GREEN.** From `server`, run `.venv/bin/python -m unittest tests.test_documentation_mode -v`; from `apps/desktop`, run `npm test -- --run src/renderer/src/components/DocumentationExport.test.tsx`.
- [ ] **Step 5: Run regressions.** From `server`, run full unittest discovery; from `apps/desktop`, run all Vitest tests, typecheck, lint, and existing export regression checks.
- [ ] **Step 6: Commit.** `git add server/tests/test_documentation_mode.py apps/desktop/src/renderer/src/components/DocumentationExport.test.tsx server/routing.py server/policy.py apps/desktop/src/renderer/src/pages/Home.tsx apps/desktop/src/renderer/src/components/ChatArea.tsx && git commit -m "feat: add documentation mode output"`.

**Acceptance:** Documentation mode produces the fixed v1 Markdown structure; generation never writes a file; any existing export remains an explicit user action.

---

### Task 11 — Per-thread entity graph UI

**Files:**
- Create: `apps/desktop/src/renderer/src/components/MemoryGraph.tsx`
- Test: `apps/desktop/src/renderer/src/components/MemoryGraph.test.tsx`
- Test: `apps/desktop/src/renderer/src/lib/api.test.ts`
- Modify: `apps/desktop/src/renderer/src/lib/api.ts`, `apps/desktop/src/renderer/src/components/ChatArea.tsx`

**Interfaces:**
- `getThreadGraph(threadId)` consumes the existing `GET /threads/{thread_id}/graph` shape.
- `MemoryGraph` receives typed nodes/edges; fetching remains in the API/client layer.
- Loading, empty, and error states are distinct and do not erase chat content.

**TDD slice — graph response and rendering:**

- [ ] **Step 1: Write failing API/UI tests before implementation.** Verify typed graph response parsing and visible non-2xx handling; render populated labels, empty graph, and unavailable state without erasing chat.
- [ ] **Step 2: Run RED.** `cd apps/desktop && npm test -- --run src/renderer/src/components/MemoryGraph.test.tsx src/renderer/src/lib/api.test.ts`.
- [ ] **Step 3: Implement the typed client call and minimal accessible view.** Use semantic lists or labeled SVG; add no graph dependency unless tests demonstrate a layout need.
- [ ] **Step 4: Run GREEN.** Rerun focused tests and desktop typecheck/lint.
- [ ] **Step 5: Manually check populated/empty/error states** in the app and verify chat remains usable when loading fails.
- [ ] **Step 6: Commit.** `git add apps/desktop/src/renderer/src/components/MemoryGraph.tsx apps/desktop/src/renderer/src/components/MemoryGraph.test.tsx apps/desktop/src/renderer/src/lib/api.ts apps/desktop/src/renderer/src/lib/api.test.ts apps/desktop/src/renderer/src/components/ChatArea.tsx && git commit -m "feat: visualize thread memory graph"`.

**Acceptance:** Active thread nodes and relations match the backend response; empty/error states are clear; chat remains usable when graph loading fails. Branchable chat remains out of scope.

---

## 4. Full verification and review gate

After a task passes its own checks, run these before closing the corresponding subsystem:

- Backend: from `server` with `.venv` activated, `python -m unittest discover -s tests -p 'test_*.py'` and `python tests/test_brain.py`.
- Evaluations: from `server`, `python -m evals.rag_metrics` and `python -m evals.routing`; record fixture versions and before/after metrics.
- Desktop: from `apps/desktop`, `npm test -- --run`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- Live provider/model evaluations: explicit user opt-in, configured credentials, and disclosed data/cost; never part of default tests.
- Runtime: manual matrix only for approved runtime/OS pairs; prove Atlas does not terminate a service it did not start.
- Review: `git diff --check`, inspect `git diff`, ensure no secrets/model artifacts are staged, and confirm only intended task paths changed.

## 5. Deferred decisions

- Auto classifier and low-confidence behavior.
- Cloud/privacy explanation and model-quality/cost/latency score weights.
- Workspace-scoped file mutations and command allowlist/approval required for Coding actions.
- Supported runtime/OS allowlist (proposed first target: installed Ollama only).
- Document formats, size limits, deletion/re-index semantics, and URL-ingestion follow-up.
- MCP transport, custom Skill format, process owner, and sandbox.
- Existing Plan UI treatment and Documentation templates.
- Graph presentation beyond the per-thread entity/relation view.

## Next checkpoint

Review the test seams and proposed Vitest dependencies. Then execute Task 1, one red→green slice at a time; keep later tasks blocked until their phase/task decision gates are resolved.
