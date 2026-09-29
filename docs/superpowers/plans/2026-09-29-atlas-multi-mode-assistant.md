# Atlas Multi-Mode Local Assistant Implementation Plan

> **For agentic workers:** This is a phase-level detail sheet, not authorization to implement every subsystem. Before coding a phase, use its decision gate and create a task-level plan for that subsystem. Do not batch independent phases into one implementation.

**Goal:** Deliver Atlas’s approved local-first modes, measured RAG, local-runtime management, model routing, guarded tool integrations, and per-thread graph UI as independently verifiable slices.

**Architecture:** Keep the Electron renderer as the user-facing control surface, Electron main as the owner of local child processes, and FastAPI as the policy/model/tool boundary. Resolve mode and policy before model routing; execute tools only through a validated backend broker; preserve provenance and evaluation metadata end-to-end.

**Tech Stack:** Existing Electron + React + TypeScript, FastAPI/Python, SQLite/sqlite-vec, existing provider adapters and local model discovery. Prefer stdlib and existing dependencies; add no dependency until an evaluation or platform need justifies it.

**Spec:** [`../specs/2026-09-29-atlas-multi-mode-assistant-design.md`](../specs/2026-09-29-atlas-multi-mode-assistant-design.md)

## Global Constraints

- Keep the desktop app and backend local; do not add hosted or multi-user behavior in this plan.
- A policy decision is enforced in backend code, never solely in a prompt or renderer.
- Auto and explicit modes cannot expand the user’s allowed model/tool set.
- No arbitrary shell strings, silent model downloads, or silent cloud routing.
- Tools validate typed inputs, enforce per-call policy, and expose bounded failures.
- Retrieved documents, web pages, model output, MCP output, and custom Skills are untrusted input.
- Use offline fixtures for routine tests; live-provider tests require explicit opt-in and may incur cost or disclose prompts.
- Keep existing SQLite until evaluation justifies a storage change.
- Do not implement graph-based conversation branching in the entity-graph UI phase.

---

## Scope and decomposition

This roadmap contains independent subsystems. The sequence below captures dependencies and acceptance boundaries; it is intentionally not a single all-at-once coding plan. The selected phase must receive its own task-level plan after its decision gate is resolved.

## Phase 0 — Policy, privacy, and evaluation foundation

**Purpose:** Establish the contracts that every router, retriever, runtime, and tool must obey.

**Likely files:**
- Create `server/policy.py` for typed mode, privacy, permission, and approval decisions.
- Create `server/tests/test_policy.py` with stdlib `unittest` cases.
- Modify `server/api.py` and `apps/desktop/src/renderer/src/lib/api.ts` only after the mode/request/response schema is frozen.
- Create `server/evals/` with versioned, non-sensitive fixtures and a deterministic runner.

**Interfaces to freeze:**
- `ExecutionMode`: `auto | research | coding | documentation`.
- Per-turn request: explicit/automatic mode plus optional model preference and existing prompt/attachment fields.
- Route result: chosen mode, provider/model, reason, fallback/degraded state.
- Tool permission result: `allow | require_approval | deny`, plus human-readable action summary and required capability.

**Decision gate:** Select Auto classification approach; define the user’s cloud/privacy preference; decide whether web search can run without per-call confirmation when enabled; choose how local API requests are authorized before privileged tools exist.

**Acceptance:** Unit tests prove explicit modes override Auto classification, a blocked cloud model is never selected, an unavailable eligible model produces an explicit failure/degraded state, and no user-facing mode can authorize a denied tool.

**Verification:** `cd server && .venv/bin/python -m unittest discover -s tests -p 'test_*.py'`; `cd apps/desktop && npm run typecheck && npm run lint` after typed API/UI integration.

## Phase 1 — Retrieval and chunking evaluation, then document ingestion

**Purpose:** Measure the existing conversation-memory vector baseline before changing ranking; add a bounded, user-selected document corpus with citations.

**Likely files:**
- Create `server/evals/rag_fixtures.jsonl` and `server/evals/rag.py` for fixed queries, relevant source/chunk IDs, and metric output.
- Modify `server/brain/schema.sql`, `server/brain/store.py`, `server/brain/retriever.py`, and `server/brain/chunking.py` to preserve source identity and distinguish chat memory from documents.
- Add a focused ingestion module under `server/brain/` and request/response contracts in `server/api.py`.
- Add typed client methods in `apps/desktop/src/renderer/src/lib/api.ts` and an explicitly selected document-ingestion UI only after the server contract is approved.

**Evaluation contract:** Report Recall@k and MRR/nDCG for retrieval; compare chunking variants on the same fixtures; retain the current cosine-distance result as the baseline. Answer-level source support is reviewed separately and cannot be inferred from retrieval scores alone.

**Decision gate:** Approve file formats, size limits, deletion/re-index behavior, source retention, and whether URL ingestion follows as a separate phase. Do not add background folder crawling.

**Acceptance:** Fixture results are reproducible offline; each retrieved chunk maps to a source and version; the UI can identify source-backed material; a retrieval/chunking change is kept only with measured improvement and no lost provenance.

**Verification:** `cd server && .venv/bin/python -m evals.rag`; `cd server && .venv/bin/python tests/test_brain.py`; TypeScript typecheck/lint after UI integration.

## Phase 2 — Local runtime lifecycle

**Purpose:** Start and monitor supported, already-installed local model servers without asking users to manually start them each time.

**Likely files:**
- Modify `apps/desktop/src/main/index.ts` to own allowlisted child processes and shutdown only processes Atlas started.
- Extend `apps/desktop/src/preload/index.ts` and `.d.ts` with narrow start/status/stop IPC methods; do not expose general `spawn` or shell access.
- Reuse `server/api.py` local model discovery and `apps/desktop/src/renderer/src/lib/api.ts` model settings; add runtime status only through the approved typed contract.
- Add platform-specific verification notes/tests for each explicitly supported runtime.

**Decision gate:** Approve a runtime/version/OS matrix. Start with only runtimes whose executable and arguments are verified on supported platforms; do not infer arbitrary launch commands from a user-provided URL.

**Acceptance:** Atlas can detect an existing service, opt-in start a supported installed runtime, report `starting | ready | unavailable | failed`, list models after readiness, and stop only its own process. No runtime or model is downloaded automatically; startup failure leaves the rest of the app usable.

**Verification:** Manual test matrix on each supported OS plus unit tests for command construction/state transitions; `cd apps/desktop && npm run typecheck && npm run lint`.

## Phase 3 — Modes and model router

**Purpose:** Replace prompt-only mode labels with a typed per-turn policy and route each turn to an eligible model.

**Likely files:**
- Create `server/routing.py` and a model capability catalog; keep provider construction in `server/factory.py`.
- Modify request/response schemas and route orchestration in `server/api.py`.
- Update `apps/desktop/src/renderer/src/pages/Home.tsx`, `ChatArea.tsx`, and `lib/api.ts` for mode selection, per-turn route metadata, and visible fallback.
- Preserve manual provider/model selection as an override within user policy; use a bounded conversation-context handoff on provider changes.
- Add routing fixtures and metrics under `server/evals/`.

**Decision gate:** Approve mode-specific goals and the model capability fields used for eligibility. Establish benchmark prompts and quality/cost/latency scoring before assigning model rankings.

**Acceptance:** Auto classifies per message; explicit mode takes precedence; user model preference is honored only when eligible; model choice and reason are visible; cross-provider context loss is explicit and bounded; routing evaluation does not require API keys by default.

**Verification:** `cd server && .venv/bin/python -m unittest discover -s tests -p 'test_*.py'`; deterministic routing eval with fixtures; `cd apps/desktop && npm run typecheck && npm run lint`.

## Phase 4 — Guarded dynamic tool broker

**Purpose:** Let models propose useful operations while keeping the backend in control of validation, permission, and execution.

**Likely files:**
- Create a backend tool registry/broker under `server/` with typed schemas, risk/capability metadata, timeouts, and bounded results.
- Adapt existing web-search and image-generation operations into registered capabilities without changing their current behavior until parity tests pass.
- Modify `server/api.py` and `apps/desktop/src/renderer/src/lib/api.ts` for streamed tool progress, approval requests, and visible failures.
- Add a focused approval surface in the renderer; keep approval summaries human-readable and specific to one invocation.

**Decision gate:** Define exact tool scopes, network disclosure behavior, approval expiration, and the local API authorization mechanism. Do not enable arbitrary file writes or shell execution in the first broker slice.

**Acceptance:** A model proposal cannot execute without schema validation and a policy decision; denied actions stay denied; approval grants only the shown invocation; timeouts/errors are visible; tool output is treated as untrusted context.

**Verification:** Offline unit tests for allow/deny/approval paths and malformed arguments; mocked tool adapters; `cd server && .venv/bin/python -m unittest discover -s tests -p 'test_*.py'`; desktop typecheck/lint.

## Phase 5 — MCP and custom Skills

**Purpose:** Add user-configured extensions through the same guarded broker, not as a second permission system.

**Likely files:**
- Add extension configuration and lifecycle modules under `server/` or Electron main only after ownership/transport is decided.
- Add typed MCP/Skill metadata and validation; update Profile/Advanced UI and the API client only for supported configuration.
- Keep custom extension storage separate from API credentials and user profile preferences.

**Decision gate:** Choose MCP transport(s), custom Skill format, trust display, extension process owner, and sandbox/permission model. A custom Skill is instruction content, not authority to run a tool.

**Acceptance:** Users can explicitly add/remove a configured extension; each capability declares its origin and permissions; untrusted output cannot modify policy; disabling an extension stops future calls and owned processes.

**Verification:** Recorded protocol fixtures and mocked servers; no external services or arbitrary commands in default tests; platform checks for supported local transports.

## Phase 6 — Structured documentation output and graph UI

**Purpose:** Complete structured-document output for Documentation mode and expose the existing per-thread entity graph without expanding to chat branching.

**Likely files:**
- Complete Documentation mode behavior in `server/routing.py`/mode policy and renderer mode selection; default output is Markdown.
- Require user approval before writing a generated document to disk; use existing export capability where appropriate.
- Add `getThreadGraph` to `apps/desktop/src/renderer/src/lib/api.ts` and a focused graph view component under `apps/desktop/src/renderer/src/components/`.
- Use existing `GET /threads/{thread_id}/graph`; do not add a graph package until a tested UI need requires it.

**Decision gate:** Confirm document templates/export formats and whether the existing Plan card is retired, folded into Documentation, or kept separate. Confirm the graph view is the memory entity graph, not branching chat.

**Acceptance:** Documentation mode produces the approved Markdown structure and never silently saves; an empty or unavailable graph has an explicit empty/degraded state; nodes and relations shown match the backend response for the active thread.

**Verification:** `cd apps/desktop && npm run typecheck && npm run lint`; manual checks with fixture graph responses for populated, empty, and failed states.

## Verification baseline and limits

- Existing desktop checks: `npm run typecheck`, `npm run lint`, `npm run build` from `apps/desktop`.
- Existing backend smoke check: `cd server && .venv/bin/python tests/test_brain.py` (uses a fake adapter; it does not evaluate retrieval quality or routing).
- Add deterministic stdlib tests and fixture evaluations; do not require a new test framework for the first slices.
- No code has been changed as part of writing this plan. The above commands are planned checks, not checks run for this document.

## Next checkpoint

Review the spec and this phase sheet. Then select **one** phase—recommended next: Phase 0—and settle its decision gate before creating a task-level execution plan. The broader roadmap is not approval to implement all phases.
