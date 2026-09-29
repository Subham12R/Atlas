# ATLAS — Unified Model Gateway, Local Inference & Subscription Architecture

**Version:** 1.2
**Status:** Proposed technical specification; cloud-guardrail and Razorpay decisions recorded 2026-09-30
**Primary inference integration:** LiteLLM Python SDK
**Supported modes:** Offline Local, Online Free, Atlas Plus, Atlas Pro
**Deployment:** Local Atlas desktop backend + authenticated Atlas cloud backend

## 1. Executive summary

Atlas is a local-first AI desktop application with a unified model catalog. Users select models and execution modes without needing to configure individual provider API keys. They can also optionally connect their own provider accounts (BYOK) and use installed local models.

LiteLLM SDK provides the common inference interface for compatible local runtimes and hosted providers. Atlas, not LiteLLM, owns discovery, connectivity policy, subscription entitlements, quota enforcement, usage accounting, fallback authorization, and agent orchestration.

The product has three cumulative online tiers:

- **Free:** Approved zero-cost hosted endpoints through OpenRouter and authorized NVIDIA NIM routes, with a daily Atlas-managed inference allowance; basic assistant execution.
- **Plus:** Free models plus a curated intermediate catalog, 5× the Free daily usage allowance, and expanded agent capabilities.
- **Pro:** Free and Plus models plus benchmark-approved premium models, 20× the Free daily usage allowance, and advanced multi-agent orchestration.

**Local models and user-owned API connectors are available across all tiers.** Their inference does not debit Atlas-managed hosted inference quota. Subscription feature entitlements still apply to Atlas-specific agent functionality.

The initial free model catalog is intended to include eligible Qwen, Kimi, and DeepSeek endpoints. Plus model candidates include Claude Haiku/Sonnet, GPT Luna/Terra, DeepSeek V4, and selected other models. Pro model candidates include Claude Opus, GPT Sol, and other premium models. These are product catalog targets, not guaranteed current API model identifiers: every model must be validated for availability, cost, permitted usage, and capability before activation.

## 2. Architectural principles

1. A single Atlas model selector covers cloud, user-connected, and local models.
2. Offline mode is a hard execution policy: no hosted inference calls or internet-dependent tools.
3. A free request cannot silently fall back to a billable endpoint.
4. Model entitlements and agent-feature entitlements are separate.
5. User-owned credentials are never confused with Atlas-owned shared credentials.
6. Shared provider secrets remain server-side; no shared cloud API key is packaged in Electron or the local Python backend.
7. Hosted requests require authentication, entitlement validation, quota reservation, and settlement.
8. Every child-agent inference call counts toward the parent task's limits and the user's applicable allowance.
9. The cloud model catalog, pricing, provider mapping, and fallback policies are remotely configurable.
10. Atlas explicitly reports unavailable capabilities instead of bypassing user policies.

## 3. System architecture

```text
Atlas Desktop (Electron / React / TypeScript)
                  |
                  v
Local Atlas Backend (Python / FastAPI)
  |-- Local model discovery & registry
  |-- Connectivity / offline policy
  |-- Local credential store for BYOK
  |-- Agent runtime & execution policies
  |-- LiteLLM SDK / local runtime adapters
  |        |-- Ollama
  |        |-- llama.cpp / compatible local API
  |        `-- MLX-LM adapter / compatible local API
  |
  `-- HTTPS (only when allowed by policy)
                  |
                  v
Authenticated Atlas Cloud Backend
  |-- User authentication & entitlements
  |-- Managed cloud model registry
  |-- Daily quota / credit reservation
  |-- Usage ledger & payment verification
  |-- Free route / premium route selection
  `-- LiteLLM SDK gateway
           |-- OpenRouter (approved free and paid routes)
           |-- NVIDIA NIM (authorized routes)
           |-- Direct model providers, where supported
           `-- Other authorized hosted providers
```

A local model can be invoked through a supported LiteLLM adapter or a dedicated runtime adapter normalized into Atlas's common inference contract. LiteLLM is **not** assumed to discover local model files, determine hardware compatibility, or enforce offline mode on its own.

## 4. Inference source types

| Source | Credentials / ownership | Atlas-managed daily quota | Requirements |
|---|---|---|---|
| Local models | User's device | No | Installed model and compatible runtime |
| Atlas-managed OpenRouter | Atlas cloud backend | Yes | Eligible route, upstream capacity, accepted usage terms |
| Atlas-managed NVIDIA NIM | Atlas cloud backend | Yes | Authorized production entitlement or permitted use |
| User-owned OpenRouter | User-connected account | No | Valid user credential and provider allowance |
| User-owned NVIDIA NIM | User-connected account | No | Valid user credential and applicable provider terms |
| Other user-owned provider / custom API | User-connected account | No | Compatible provider and valid credential |

NVIDIA developer or trial access must not be treated as an unlimited, automatically commercially reusable pool. Free endpoint status, quota, and permissible usage must be verified for each route. LiteLLM itself does not supply free inference credits.

## 5. Model catalog and access tiers

### 5.1 Offline Local — all users

- Discover available Ollama models, configured MLX directories, GGUF files, and supported compatible local inference servers.
- Display model name, runtime, capabilities, model path, context limitations, and hardware compatibility where known.
- Permit users to import or select their own local model.
- Route inference locally when offline mode is enabled.
- Disallow hosted fallback, remote telemetry containing prompts, and network-dependent tools in strict offline mode.
- Explain when the requested capability (e.g. vision or reliable tool calling) is unavailable locally.

### 5.2 Atlas Free — 1× daily usage

- Access to explicitly approved, currently available free endpoints through OpenRouter and authorized NVIDIA NIM routes.
- Curated entry-level Qwen, Kimi, DeepSeek, and other eligible models, not entire provider families by default.
- Basic chat, conversation history, local memory, and limited single-agent/tool execution.
- Strict per-day Atlas-managed hosted usage cap and upstream-capacity guardrails.
- User-owned connectors and local inference remain available even after the Atlas-hosted free quota is exhausted.

### 5.3 Atlas Plus — 5× daily usage

- Everything in Free, including all Free models.
- Curated Plus catalog: target candidates include Claude Haiku, Claude Sonnet, GPT Luna, GPT Terra, DeepSeek V4, and selected Qwen/Kimi premium variants, subject to verification.
- Expanded agent execution and workflow allowances.
- Defined daily usage units and, where applicable, prepaid/included monetary inference credits.

### 5.4 Atlas Pro — 20× daily usage

- Everything in Free and Plus, including all lower-tier models.
- Benchmark-approved premium catalog: target candidates include Claude Opus, GPT Sol, and other premium reasoning/multimodal models.
- Advanced multi-agent orchestration, supervisor-led task delegation, concurrent specialized agents, and larger bounded task budgets.
- The highest Atlas-managed daily usage allowance, but **not unlimited premium inference**.

Model names such as Luna, Terra, and Sol are catalog labels/targets until corresponding currently purchasable API routes are confirmed. The cloud registry must use verified upstream model IDs rather than inferred or fabricated identifiers.

### 5.5 Entitlement matrix

| Capability | Free | Plus | Pro |
|---|---:|---:|---:|
| Offline local inference | Yes | Yes | Yes |
| User-owned provider connectors | Yes | Yes | Yes |
| Free hosted catalog | Yes | Yes | Yes |
| Plus hosted catalog | No | Yes | Yes |
| Pro hosted catalog | No | No | Yes |
| Daily hosted allowance | 1× | 5× | 20× |
| Single assistant / basic tools | Yes | Yes | Yes |
| Expanded agent workflows | No | Yes | Yes |
| Advanced multi-agent orchestration | No | No | Yes |

BYOK allows inference using a user's account but does not grant subscription-gated Atlas agent features. Local models likewise remain available independent of subscription.

## 6. Usage units and daily quotas

Set a remotely configurable Free baseline `B`. Then:

```text
FREE_DAILY_UNITS = B
PLUS_DAILY_UNITS = 5 * B
PRO_DAILY_UNITS = 20 * B
```

An illustrative starting baseline is `B = 10` units/day, yielding Free 10, Plus 50, and Pro 200 units/day. **These are proposed Atlas usage units, not guarantees of 10/50/200 upstream API requests.** Final values depend on actual usage patterns, upstream costs, and available provider quotas.

Usage units must have a documented conversion policy. At minimum, charge according to actual input/output tokens and model-specific cost; account for repeated tool-calling and child-agent inference. Maintain a separate monetary cost ledger, and enforce a monetary budget as well as unit limits so that a premium model cannot consume an economically unsustainable amount under the nominal 20× plan. Include request, session, agent, and daily caps.

**Daily reset:** Define a consistent reset window (e.g. 00:00 UTC) and show the user's local countdown in the UI. A quota check must be atomic and concurrency-safe. Reserve estimated usage before dispatch, settle against actual usage, and release unused reserved units. Retries and multiple child agents must not race past the cap.

**Upstream limits are separate:** OpenRouter's shared-account free rate/request limits or NVIDIA's applicable account restrictions can stop service before the user's Atlas quota is depleted. Do not imply that user sign-ups or Atlas purchases automatically increase provider-level free quota.

## 7. Provider routing and fallback

Routing starts with the user's chosen source and execution policy:

```text
Incoming request
  |
  +-- Explicit offline mode?
  |      `-- Local registry -> capability match -> local runtime ONLY
  |
  +-- User-selected BYOK connector?
  |      `-- Credential validation -> selected provider -> usage telemetry
  |
  `-- Atlas-managed hosted inference
         |-- Authenticate user
         |-- Validate model entitlement & feature entitlement
         |-- Check daily usage + monetary budget
         |-- Reserve capacity/usage
         |-- Select authorized eligible route
         |      |-- Free: OpenRouter free / authorized NVIDIA NIM
         |      |-- Plus: Free and Plus catalog
         |      `-- Pro: Free, Plus, premium catalog
         |-- LiteLLM SDK -> response/stream
         `-- Settle ledger / release reservations
```

Free routing can prioritize OpenRouter or NVIDIA NIM based on capability, service health, latency, cost eligibility, and remaining capacity. A free request can fail over only to another free and authorized route with compatible capabilities. If no such route exists, stop and explain the quota/outage; offer explicit local or user-owned options where possible.

For paid requests, fallback must remain within the user's model entitlement, data-routing preference, remaining units/credits, and request budget. Changes of provider/data destination should obey disclosure and user settings. An unavailable selected model must not silently be replaced with a lower-capability model when task requirements would be broken.

## 8. User-owned connectors (BYOK)

**Navigation:** `Settings → Model Providers → My Connections`

Supported targets initially:

- OpenRouter (supported account connection / user key)
- NVIDIA NIM (personal NVIDIA credential)
- OpenAI
- Anthropic
- Google Gemini
- Other LiteLLM-supported providers, as implemented
- Custom OpenAI-compatible endpoint

Each connection stores provider, encrypted credential reference, endpoint/base URL, health, eligible model IDs, and credential owner. Prefer system secure storage for desktop-resident secrets; never print secrets to logs or display them after initial entry. Where a provider supplies an officially supported OAuth/authorization flow, use it rather than demanding manually copied keys.

Personal connector inference does not debit Atlas's hosted daily quota; any provider-side charges and limits belong to the user's connected account. Atlas may show observed requests/tokens, but should not claim authoritative billing data unless supplied by that provider. Apply the user's subscription-based **feature** restrictions separately.

BYOK routing must not allow an untrusted custom endpoint to receive credentials intended for another provider. Keep endpoint allowlists/validation and origin-scoped secrets.

## 9. Local discovery and offline enforcement

On startup and on manual refresh:

1. Inspect configured local inference runtimes and model directories.
2. Retrieve installed models and metadata through runtime-specific adapters.
3. Validate actual availability and supported capabilities.
4. Register local Atlas model IDs.
5. Present discovered models in the unified picker.
6. Select a compatible local model based on user preference and execution policy.

Strict offline mode must disable remote model discovery, hosted inference, online tools, and automatic network fallback. Atlas should distinguish explicit offline mode from temporary connectivity loss: the user may configure an approved failover policy for the latter, but strict offline mode is never bypassed.

## 10. LiteLLM SDK responsibilities

LiteLLM is responsible for normalizing supported inference calls, streams, and provider-specific request/response formats. Atlas remains responsible for authorization, source selection, usage reservation, billing, telemetry boundaries, model discovery, and orchestration.

```python
from litellm import acompletion

class AtlasInferenceGateway:
    async def generate(self, resolved_route, messages, **kwargs):
        # resolved_route was authorized by Atlas's policy engine.
        return await acompletion(
            model=resolved_route.model_id,
            messages=messages,
            api_base=resolved_route.api_base,
            api_key=resolved_route.credential,
            **kwargs,
        )
```

In implementation, credentials must stay inside the trusted execution environment. Shared Atlas-owned keys only reside on the remote Atlas backend; do not send them to the desktop for direct calls. A local BYOK credential may be used locally or routed through a trusted authenticated service according to the selected feature and security design.

## 11. Usage & Billing tab

Create a **separate top-level `Usage & Billing` tab**. It must include:

- Current plan and cumulative Free/Plus/Pro model access.
- Today's Atlas-managed usage (`used / allowance`) and progress bar.
- Remaining units, reset time, and timezone-adjusted countdown.
- Plus = 5× and Pro = 20× comparison.
- Model-by-model and agent-by-agent usage breakdown.
- Per-request input/output tokens, units consumed, and cost where applicable.
- Included credits, top-up balance, billing history, and subscription renewal.
- Upstream-capacity / provider status messages, distinct from user quota exhaustion.
- Local inference summary showing no Atlas-hosted quota deduction.
- User-owned connector usage shown separately from Atlas-managed inference.
- Clear upgrade, top-up, and connection-management paths.

The Model Library remains a separate screen for model discovery/selection, and `My Connections` remains under Settings.

## 12. Agent execution policy

All agents use the same Atlas inference gateway and inherit the account's feature entitlements and applicable quotas. The supervisor may assign different eligible models to planning, coding, research, vision, and review agents according to benchmark evidence, capabilities, latency, and permitted cost.

A Pro multi-agent task must maintain a **shared parent task budget**, including every child call, retries, and tool-induced inference. Explicit controls should include maximum agent iterations, parallel child agents, tokens, wall time, and monetary budget.

Offline mode routes all eligible agent inference to local models and disables cloud-only tools. If a required capability is absent, surface a capability error and let the user choose whether to change mode.

## 13. Data and service boundaries

**Local desktop storage:** Local model registry, user preferences, local conversation/memory data as configured, cached cloud catalog, and encrypted user-owned credentials.

**Cloud storage:** Accounts, plan entitlements, catalog configuration, payment ledger, hosted usage events, reservations, provider usage reconciliation, and shared secrets in a secure secret manager.

Do not expose provider credentials, unredacted secrets, or protected user prompt contents in operational logs. Clearly communicate when a prompt leaves the device through hosted or BYOK inference. Offline mode must preserve local-only prompt handling.

## 14. Proposed implementation structure

```text
atlas/
├── core/
│   ├── config.py
│   └── exceptions.py
├── inference/
│   ├── gateway.py
│   ├── litellm_client.py
│   ├── streaming.py
│   ├── free_router.py
│   ├── cloud_router.py
│   └── byok_router.py
├── models/
│   ├── registry.py
│   ├── catalog.py
│   ├── capabilities.py
│   └── discovery/
│       ├── ollama.py
│       ├── mlx.py
│       └── gguf.py
├── connectors/
│   ├── manager.py
│   ├── credentials.py
│   ├── validation.py
│   ├── nvidia_nim.py
│   ├── openrouter.py
│   └── custom_provider.py
├── routing/
│   ├── policy_engine.py
│   ├── model_selector.py
│   ├── fallback.py
│   └── connectivity.py
├── entitlements/
│   ├── plans.py
│   └── permissions.py
├── usage/
│   ├── daily_quota.py
│   ├── usage_units.py
│   ├── provider_usage.py
│   ├── quota_reservation.py
│   └── reset_policy.py
├── billing/
│   ├── wallet.py
│   ├── ledger.py
│   ├── reservations.py
│   └── settlement.py
└── agents/
    ├── supervisor.py
    ├── executor.py
    ├── budget.py
    └── policies.py
```

Cloud-only services for account administration, hosted secret management, payment webhooks, and transaction-safe quotas should be deployed remotely rather than trusting the desktop process.

## 15. Model registry contract

```typescript
type AtlasTier = "free" | "plus" | "pro";
type InferenceSource = "local" | "atlas-cloud" | "user-connector";

interface AtlasModel {
  id: string;
  displayName: string;
  provider: string;
  family: string;
  source: InferenceSource;
  requiredTier?: AtlasTier; // Atlas-managed cloud access only
  upstreamModelId?: string;
  runtime?: string;
  localPath?: string;
  capabilities: {
    chat: boolean;
    reasoning: boolean;
    vision: boolean;
    toolCalling: boolean;
    structuredOutput: boolean;
    embeddings: boolean;
  };
  contextWindow?: number;
  pricing?: {
    inputPerMillion: number;
    outputPerMillion: number;
    currency: string;
  };
  availability: "available" | "unavailable" | "rate_limited" | "deprecated";
  enabled: boolean;
}

interface AtlasEntitlements {
  plan: AtlasTier;
  dailyHostedUnits: number;
  allowedModelIds: string[];
  multiAgentEnabled: boolean;
  maxConcurrentAgents: number;
  maxTaskBudgetUnits: number;
}
```

A local or user-connector model is not subscription-locked solely because the same model family also appears in Atlas's hosted Plus or Pro catalog. Product-feature access remains independently enforced.

## 16. API surface (proposed)

```text
GET    /models/catalog
GET    /models/local
POST   /models/local/refresh
GET    /connectors
POST   /connectors
POST   /connectors/{id}/validate
DELETE /connectors/{id}
POST   /inference/chat
GET    /usage/today
GET    /usage/history
GET    /usage/by-model
GET    /usage/by-agent
GET    /subscriptions/current
POST   /billing/checkout
POST   /billing/webhooks/provider
```

Hosted APIs authenticate every call. A client-supplied model ID is resolved against the server-side registry and entitlement policy rather than trusted directly.

## 17. Delivery roadmap

1. **Unified inference:** LiteLLM SDK, normalized responses/streaming, Atlas model IDs.
2. **Local-first:** runtime discovery, local selection, strict offline policy.
3. **Free cloud:** OpenRouter eligible endpoints, authorized NVIDIA NIM routes, upstream quota guards.
4. **BYOK:** OpenRouter, NVIDIA NIM, direct/custom connectors and encrypted credentials.
5. **Subscription:** Free/Plus/Pro catalog access and cumulative entitlements.
6. **Usage dashboard:** daily limits, reset tracking, model/agent breakdown, upstream status.
7. **Paid inference:** payment verification, credits, reservations, settlement, shared-key security.
8. **Agents:** Plus workflows, Pro multi-agent supervisor and shared budgets.
9. **Catalog operations:** route health, model benchmarking, remote catalog updates and approved fallbacks.

## 18. Acceptance criteria

- [ ] Atlas works with an installed supported model in strict offline mode without hosted calls.
- [ ] Local models appear in the same model picker as hosted models.
- [ ] OpenRouter and NVIDIA NIM routes can be separately configured and health-checked.
- [ ] A Free request never falls back to a paid upstream endpoint.
- [ ] Upstream free quota exhaustion is distinct from Atlas per-user quota exhaustion.
- [ ] Free, Plus, and Pro hosted limits enforce 1×, 5×, and 20× configured allowances.
- [ ] Plus inherits Free; Pro inherits Free and Plus.
- [ ] Users can connect their own NVIDIA NIM, OpenRouter, and other supported credentials.
- [ ] BYOK and local inference do not debit Atlas-managed hosted usage.
- [ ] BYOK does not bypass Atlas's agent-feature entitlements.
- [ ] The Usage & Billing tab shows daily remaining usage, reset time, and separate source breakdowns.
- [ ] Every agent and child agent draws against an enforced parent task budget.
- [ ] Shared provider keys never appear in desktop application bundles or client responses.
- [ ] Hosted payments and quota settlements are transactional and idempotent.
- [ ] An outdated/unavailable model can be disabled centrally without a desktop update.

## 19. Final decision

Atlas will provide one model interface across locally installed models, user-owned provider connections, and Atlas-managed inference. LiteLLM SDK normalizes supported inference providers. Atlas owns routing policy, entitlement, billing, quota, and agent orchestration.

**Offline = local-only. Free = limited eligible free inference via OpenRouter and authorized NVIDIA NIM. Plus = 5× hosted usage and expanded models/features. Pro = 20× hosted usage, cumulative premium catalog, and advanced multi-agent workflows. BYOK/local inference remain available across tiers.**

## Reference documentation

- LiteLLM: https://docs.litellm.ai/
- OpenRouter free models and API: https://openrouter.ai/docs/
- OpenRouter OAuth PKCE: https://openrouter.ai/docs/use-cases/oauth-pkce
- NVIDIA NIM / build APIs: https://build.nvidia.com/

Provider quotas, commercial terms, pricing, and exact model identifiers must be revalidated before public launch.

## 20. Recorded cloud-guardrail decisions

This section records decisions made after the initial proposal. It takes precedence
where it differs from earlier proposed API wording.

- Atlas remains local-first: an existing local profile may use installed
  models or the user's own provider credentials without a live cloud request.
  Whether first-run use may create a local-only profile before cloud sign-in is
  an unresolved product decision. Local/BYOK inference cannot be made
  subscription-locked by a desktop client and does not debit managed quota.
- Atlas-managed models, paid agent features, checkout, and usage data require a
  cloud Atlas account. A signed-in desktop profile is linked to that account;
  it is never the authority for a plan, entitlement, price, credit, or quota.
- The Atlas cloud API runs on the owner's Contabo VPS. The exact VPS city/region
  is a deployment gate and must be recorded before production launch.
- Authentication is custom server-side authentication: passwords use Argon2id;
  access JWTs are short-lived and signed; refresh credentials are opaque,
  rotated, revocable, and stored only as hashes. Tokens belong in OS secure
  storage through the Electron main process, never renderer storage.
- Managed inference prompts, completions, attachments, and chat history are
  processed transiently and are not stored in Atlas databases, application
  logs, analytics, traces, error reports, or payment records. The selected
  upstream provider still receives the prompt; the UI and route registry must
  disclose that destination and its approved data terms.
- Every managed-model request is checked by the cloud gateway for the account,
  billing state, plan, model entitlement, source/privacy policy, quota, and
  request budget before an upstream request is made. An ineligible model
  request receives `403 model_not_entitled`; the gateway must not attempt a
  fallback. Other denials use specific typed reasons.
- A paid agent feature implemented entirely in the local desktop cannot be
  reliably tier-gated while offline: a modified binary can unlock it. Keep
  locally runnable orchestration available across tiers, or require a cloud
  service for enforceable paid capabilities. The product choice is still open;
  neither a signed cache nor obfuscation changes this boundary.
- A payment checkout callback or a locally modified entitlement cache never
  activates a plan. Verified Razorpay lifecycle webhooks are the source of
  truth. A signed local entitlement cache is UX-only for at most 72 hours
  offline; it cannot authorize Atlas-managed inference or extend an expired
  cloud plan. Local/BYOK inference remains available during an outage.

## 21. Cloud API and data boundary

HTTP method is not authorization. The desktop is an untrusted client, including
when its binary has been modified.

| Caller operation | Cloud behavior |
| --- | --- |
| Read current entitlement, usage, catalog, provider status | Authenticated read of account-scoped, redacted data. |
| Request managed inference | Authenticated `POST`; perform all authorization and quota reservation atomically, then stream a transient provider response. This cannot be a `GET` because the prompt is request data. |
| Start checkout | Authenticated `POST`; create a server-owned Razorpay subscription checkout for a server-configured plan. |
| Change plan, price, entitlement, credits, usage settlement, or payment state | Never accepted from the desktop. Only cloud-internal workers and verified Razorpay webhook processing may mutate these records. |

The gateway persists only the minimum operational metadata needed to authorize
and settle usage: account ID, request ID, route/model ID, plan decision, token
or unit quantities, cost, timestamps, and redacted error codes. It excludes
prompt-derived fields. Retention duration must be approved with legal and
accounting advice before launch; do not reuse the ledger for prompt analytics.

The cloud service needs a transactional PostgreSQL database for users,
refresh-session hashes, device state, entitlements, catalog versions, quota
reservations, usage settlements, Razorpay events, and the immutable payment and
usage ledger. Desktop SQLite, in-memory state, and client clocks are never
billing authorities.

## 22. Razorpay subscription integration

Atlas Plus and Pro are recurring Razorpay Subscriptions in INR for the initial
India launch. One-off Razorpay Orders and prepaid top-ups are intentionally
out of scope until a separate wallet/credit specification exists. Prices,
billing periods, trials, GST treatment, invoices, refunds, and consumer terms
are server-side versioned product configuration and remain deployment blockers
until approved values are supplied.

### 22.1 Checkout and fulfillment flow

1. The signed-in desktop requests `POST /billing/checkout-session` with a
   server-known plan identifier. It does not supply an amount, currency,
   entitlement, Razorpay customer ID, or price ID.
2. The cloud validates account eligibility and resolves the current server-side
   product configuration. It creates the Razorpay Subscription/Checkout and
   records a pending local checkout record keyed to the Atlas account and
   provider identifiers.
3. The desktop opens an Atlas-hosted HTTPS page using Razorpay Standard Checkout
   in the system browser, not an embedded webview. A short-lived, account-bound
   checkout nonce protects the browser handoff; the desktop polls its read-only
   entitlement endpoint rather than trusting redirect parameters.
4. Razorpay calls a public HTTPS webhook endpoint. The webhook handler verifies
   the signature over the **exact raw request body** using the webhook secret
   before parsing business fields. This is required by the Razorpay SDK
   contract; never verify reserialized JSON. During webhook-secret rotation,
   validate legitimate Razorpay retries with the applicable previous secret.
5. The handler durably records the verified event under a unique
   `x-razorpay-event-id` header. The worker maps its Razorpay subscription ID
   to a server-created account-bound checkout record and verifies product,
   amount, and currency; client-supplied notes/customer IDs are not authority.
   A transaction applies the subscription transition and immutable ledger entry.
6. Only that transaction updates the current entitlement. The checkout return,
   desktop state, and client-provided payment signature may improve user
   feedback but never grant access.

The implementation must use Razorpay's official current webhook event IDs,
lifecycle names, and subscription contract when it is built. Do not guess them
from this design. Payment verification APIs must validate the expected order or
subscription identifier, payment identifier, and signature on the server.

### 22.2 Lifecycle rules

- Cancellation takes effect at the paid period end unless a lawful refund or
  chargeback requires earlier revocation.
- Failed renewal, refund, chargeback, and subscription cancellation are applied
  only from verified provider lifecycle events; late or duplicate events are
  harmless.
- Each event is signature-verified, retained for reconciliation without prompt
  content, deduplicated, and processed with bounded retry. Limit access to
  payment payloads and their personal data. The webhook endpoint returns a
  retryable failure until durable storage succeeds. A periodic server-to-server
  reconciliation checks provider state for missing/out-of-order webhooks.
- Entitlement transitions are idempotent. On ambiguous or out-of-order events,
  reconcile the current subscription through Razorpay's authenticated API or
  quarantine for review rather than assuming event delivery order or a
  provider-supplied version field.
- Razorpay secrets, provider API secrets, and database credentials exist only
  in the VPS secret store/environment with least privilege; none ship in
  Electron or the local Python backend.

## 23. Managed inference enforcement

A reversed desktop app can alter UI state, cached plan data, local databases,
or its system clock. It cannot obtain an Atlas-managed model response unless
the cloud gateway accepts an authenticated request and calls the upstream
provider with cloud-held credentials.

For every `POST /inference/chat`, in one server-side transaction or equivalent
serializable reservation boundary, the gateway must:

1. authenticate the account and reject revoked/expired sessions;
2. resolve the requested Atlas model ID from the server registry, never from
   client-provided provider/model/base URL data;
3. verify plan entitlement, account billing state, source/privacy policy, and
   model availability;
4. enforce per-account device, request-rate, concurrency, session, agent, and
   monetary limits;
5. reserve estimated usage against the correct account and parent task budget;
6. invoke only an eligible cloud-held route; and
7. settle actual usage exactly once or release the reservation on failure,
   cancellation, or timeout.

Requests carry a server-validated idempotency key so reconnects do not create
duplicate billable inference. Since Atlas stores no completions, a replay of a
completed/unknown stream cannot return the same response: report an explicit
`completion_unavailable` state and reconcile provider usage; do not silently
run a second billable inference. Child-agent calls share the parent task budget.
Free routes may fail over only to another approved free route. Paid routes may
fail over only within the selected account's entitlement, data-routing policy,
and remaining budget.

## 24. Abuse and failure review

| Risk or loophole | Required control |
| --- | --- |
| Patched desktop claims Pro or edits its SQLite data | Treat all client claims as untrusted; re-authorize every managed request in the cloud. |
| Patched desktop enables a paid-only local agent feature offline | Not preventable by cloud authorization; make the local capability available to all or move the enforceable paid capability behind a cloud service. |
| Client clock rollback or stale offline cache | Use cloud time and cloud entitlement state for every managed request. |
| Direct use of leaked shared provider key | Never distribute shared keys; rotate/revoke in the cloud secret store. |
| Checkout callback grants access before payment settlement | Webhook-only entitlement mutation and read-only desktop polling. |
| Valid webhook is applied to the wrong Atlas account or cheaper plan | Match server-created subscription ID to the account and approved product configuration; never trust notes or browser account IDs. |
| Forged, replayed, duplicate, or reordered webhooks | Raw-body signature verification, unique provider event persistence, idempotent state transitions, and reconciliation queue. |
| Double charging from retries/concurrent prompts | Idempotency keys plus atomic quota reservation and settlement. |
| Quota race or multi-agent overspend | Database transaction/row-level locking, parent-budget reservation, and bounded concurrency. |
| User changes model ID, price, amount, or plan in a modified client | Resolve all catalog and product values server-side; reject unknown identifiers. |
| Prompt retention through logging or monitoring | Redact/disable request-body logs and tracing; test log sinks; persist metadata only. |
| Provider route violates privacy/data policy | Approved-route registry; fail closed when no compliant route exists; disclose destination before use. |
| Account takeover or token replay | Argon2id passwords, short-lived JWTs with fixed algorithm/issuer/audience, rotated/revocable refresh tokens, verified recovery, device limits, and rate limits. |
| VPS compromise or exposed webhook endpoint | TLS reverse proxy, firewall, patched host, least-privilege secrets, encrypted backups, database access isolation, and audit logs without prompts. |
| Custom/BYOK endpoint receives an Atlas secret | Scope credentials to their owner/provider; never send Atlas-owned credentials to custom endpoints. |

Client-side obfuscation, Electron code signing, and tamper detection can raise
reverse-engineering cost but are not entitlement controls and must not be used
as billing enforcement.

## 25. Delivery gates and verification

Before implementation or production enablement:

1. Select and document the Contabo VPS city/region, domain, TLS termination,
   backup/recovery procedure, operations owner, whether a first-run offline
   user may create a local-only profile, and whether paid agent capabilities
   are cloud-executed or local features available to all.
2. Approve Plus/Pro prices, billing cadence, trials, GST/invoicing, cancellation,
   refund, chargeback, and metadata-retention policies.
3. Provision PostgreSQL, a secret-management boundary, and the cloud API before
   adding Razorpay or managed-provider keys. The current local FastAPI service
   is not this cloud authority.
4. Verify current Razorpay Subscription, Checkout, signature, and webhook
   documentation against the chosen official SDK immediately before coding.
5. Test with deterministic fixtures: bad/missing signatures, replayed and
   reordered webhooks, cancelled/refunded/failed renewals, quota races,
   idempotent retries, revoked refresh tokens, altered model/plan requests,
   and a request-body/log-sink scan proving prompts are not persisted.
6. Test that every denial returns a typed reason such as
   `model_not_entitled`, `billing_inactive`, `quota_exhausted`, or
   `route_unavailable`, without revealing secrets or internal provider details.

Current official references checked for this addendum:

- Razorpay webhook signature, unique event ID, duplicates, out-of-order delivery,
  and secret rotation: https://razorpay.com/docs/webhooks/validate-test/
- Razorpay Subscription checkout and mandatory server-side checkout-signature
  verification: https://razorpay.com/docs/payments/subscriptions/integration-guide/
- Razorpay Python SDK: https://github.com/razorpay/razorpay-python

No payment, entitlement, or quota integration is implemented by this document.
