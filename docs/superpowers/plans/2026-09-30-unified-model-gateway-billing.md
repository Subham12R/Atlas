# Atlas unified gateway and Razorpay delivery gates

**Status:** Proposed; documentation only. Implement no cloud inference or payments before the decision gates below are closed.

**Spec:** `../specs/2026-09-30-unified-model-gateway-billing-design.md` (sections 20–25 supersede earlier proposals where they differ).

## Boundaries

The existing packaged FastAPI server and its `ATLAS_API_TOKEN` protect localhost APIs; they are **not** an account-authenticated, multi-user cloud gateway. Keep existing local/BYOK inference working without a live cloud connection for an existing profile; first-run local-only account policy remains unresolved. Add a separately deployed Contabo cloud service to own Atlas-managed secrets, plans, Razorpay webhooks, quota transactions, and managed inference. The desktop is never a source of truth for those records. Prompts and completions pass through cloud memory only; do not persist them in Atlas cloud storage or logs. The chosen upstream provider receives the prompt and must be disclosed.

## Gates before code

- Confirm Contabo VPS city/region, cloud domain/TLS, PostgreSQL backups and recovery owner, and host firewall/secret-storage operations.
- Approve Plus/Pro INR pricing, billing cadence, trial policy, GST/invoicing, cancellation/refund/chargeback terms, and payment/usage metadata retention with the appropriate experts. No speculative amounts or tax logic.
- Confirm the approved upstream provider routes, privacy terms, cost limits, and current Razorpay Subscription/Checkout/webhook contracts in the official documentation.
- Approve migration from existing desktop-local accounts to cloud-linked accounts without copying local chats or credentials; define conflict, logout, recovery, and whether a first-run local-only profile is allowed. Decide whether paid agent capabilities run in the cloud or local orchestration is available to all; offline desktop-only tier gating is bypassable. Current local login must not be silently reinterpreted as verified cloud identity.

## Phase 1 — Cloud identity and gateway skeleton

1. Deploy an independent HTTPS cloud API with PostgreSQL and restricted service credentials on Contabo. No Razorpay or provider secrets in the Electron bundle.
2. Add cloud accounts with verified email, Argon2id password hashes, bounded login/reset attempts, short-lived signed access JWTs validated with a fixed algorithm/issuer/audience, hashed rotating/revocable refresh tokens, device controls, and explicit account recovery. Electron main holds tokens in OS secure storage and exposes only scoped IPC to the renderer. Local/BYOK still work when cloud sign-in fails.
3. Add server-owned model/plan/route registry and typed deny reasons. Read-only endpoints return account-scoped plan, catalog, usage, and route status. Do not allow the desktop to set prices, entitlements, or quota balances.
4. Verify: invalid/revoked/expired credentials, stolen refresh replay, fake desktop plan, cross-account reads, offline-local independence, and no credentials in renderer/logs.

## Phase 2 — Transactional managed inference

1. For each authenticated `POST /inference/chat`, resolve the Atlas model on the server, verify billing/plan/capabilities/privacy, and atomically reserve both unit and monetary budgets. A denied request must never invoke a provider.
2. Hold Atlas-owned provider keys only on the cloud server; use a configured eligible route, stream the result transiently, and settle or release the reservation exactly once. Bound request rate, concurrent prompts, time, tokens, child-agent budgets, and retries.
3. An idempotent retry must not re-run a billable completed or unknown stream: if its response is no longer available (no completion storage), return an explicit degraded result and reconcile usage.
4. Verify: forged model/provider/base URL, changed client clock, insufficient or raced quota, revoked plan, failed billing, free-to-paid fallback, disconnected streams, child budget exhaustion, and cloud log/tracing scans proving no prompt or completion persistence.

## Phase 3 — Razorpay Subscriptions

1. Store approved INR product configuration and provider plan IDs server-side. Checkout request accepts only a known plan ID, creates a pending account-bound subscription/nonce, and opens an Atlas-hosted HTTPS Standard Checkout page in the system browser.
2. The public webhook endpoint verifies `X-Razorpay-Signature` over raw bytes with the correct webhook secret, handles secret rotation, and durably records unique `x-razorpay-event-id` values before acknowledging. Match subscription IDs to server-created account and product records, not user-provided notes. Restrict PII access. An idempotent transactional worker applies verified subscription transitions and immutable payment entries; periodically reconcile provider state.
3. A checkout return or client payment signature does not activate a plan. The desktop polls a read-only entitlement endpoint. Cancellation takes effect at the paid period end unless verified refund/chargeback policy requires earlier revocation.
4. Verify with synthetic/test-mode fixtures: forged/empty signatures, altered body, duplicate/out-of-order events, retry after database outage, refund, chargeback, failed renewal, cancelled subscription, invalid plan/price supplied by the desktop, and unavailable reconciliation. Do not call live Razorpay or process real payments for tests.

## Phase 4 — Desktop UX and release

1. Link the desktop account to a verified cloud account without uploading existing local chats; show managed model availability and precise `model_not_entitled`, `billing_inactive`, `quota_exhausted`, and route outage states.
2. Show local/BYOK vs cloud routing explicitly. No cloud model calls occur while offline; signed cached entitlements are UX-only for at most 72 hours and cannot authorize hosted inference. A modified desktop cannot unlock managed access.
3. Add account-scoped usage and subscription status views only after the cloud ledger is trusted; keep prompts, attachment bodies, and chats off the billing API.
4. Ship after staging with Razorpay Test mode and a documented rollback, key rotation, backup restore, webhook replay/reconciliation, and incident response check.

**Acceptance:** On every managed inference request, the cloud—not the client—authorizes the account, model, plan, billing state, quota and cost budget before calling a provider; Razorpay webhooks alone update payment-backed entitlements; an unmodified or reversed desktop cannot grant itself a paid plan or bypass cloud checks; local/BYOK remain usable offline. No claim that client-side anti-tamper prevents local modification.
