# Phase 7: Feishu Live Callback Readiness - Context

**Gathered:** 2026-05-21T15:19:06+08:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 7 decides whether the existing public Feishu webhook can be exposed to a real Feishu developer-console callback. It does not add new Feishu command scope, terminal authority, free-form approvals, encrypted payload decryption, or multi-instance infrastructure. The output should turn the Feishu live-callback unknown into a `Pass`, `Caveat`, or `Blocked` record with exact environment, rerun steps, public-exposure caveats, and regression evidence for approval and terminal authority boundaries.

`lark-cli event consume` is a CLI-side long-running event-bus consumer and may be used as auxiliary preflight evidence. It is not a substitute for a Feishu developer-console HTTP callback to OpenForge Gateway, because it bypasses OpenForge's public route, raw-body signature checks, URL verification response, replay/rate store, tenant integration lookup, and audit path.

</domain>

<decisions>
## Implementation Decisions

### Real Callback Evidence

- **D-01:** Phase 7 must distinguish the CLI event-consumer path from the product public webhook path. `lark-cli event consume` can prove local CLI/app/event-bus readiness only; it cannot satisfy FEI-01 by itself.
- **D-02:** FEI-01 `Pass` requires a real Feishu developer-console HTTP callback attempt against `POST /api/v1/integrations/feishu/webhook/:publicId`, including URL verification or a real signed event attempt. If no public HTTPS URL or developer-console access is available, record a precise `Caveat` or `Blocked` state, not a CLI configuration failure.
- **D-03:** The real callback evidence should record the public URL shape, Gateway environment, route/public id used, Feishu app callback action attempted, result, sanitized logs or audit evidence, owner, and rerun steps. It must not record raw verification tokens, event encrypt keys, signatures, raw request bodies, credentials, JWTs, or private message text.
- **D-04:** URL verification is setup-only evidence. A successful challenge response proves Feishu can reach the Gateway route and that the verification token matches, but it does not prove message-event policy, tenant mapping, replay, rate, or approval-boundary behavior.
- **D-05:** If available, a real `im.message.receive_v1` style signed message-event attempt should be captured after URL verification. If unavailable, the phase may use existing signed-route tests for regression evidence while preserving the live-event caveat.

### Deployment Topology

- **D-06:** The current supported public-webhook topology is a local or single-Gateway deployment backed by the existing SQLite replay/rate store.
- **D-07:** Multi-instance public-webhook deployment is not supported in v1.1. It requires a shared replay store and shared rate-limit store before public webhook enablement can be claimed safe.
- **D-08:** In a multi-instance deployment without shared replay/rate storage, documentation must say the public webhook route remains disabled or fails closed. Do not describe current SQLite replay/rate protection as horizontally safe.

### Encrypted Payload Boundary

- **D-09:** Encrypted Feishu event payloads with a top-level `encrypt` field remain unsupported in Phase 7 and must fail closed with `feishu_webhook_encrypted_payload_unsupported`.
- **D-10:** Do not add decrypt support in Phase 7 unless a real Feishu app requires it and the work is split into a dedicated security-reviewed implementation phase.
- **D-11:** User-facing caveat text must state that tenants requiring encrypted Feishu app mode should keep public webhook enablement off until decrypt support is implemented and tested.

### Authority and Tenant Regression

- **D-12:** Live or simulated live evidence must confirm Feishu free-form text such as `approve`, `批准`, or `/approve <id>` cannot approve pending actions.
- **D-13:** Feishu public webhook events must not send direct terminal input, run shell commands, create unattended loops, or execute model-generated Feishu command strings.
- **D-14:** Public webhook handling must preserve tenant policy: integration enabled state, emergency-disabled state, explicit chat allowlist, identity mode, user mapping, project visibility, active-run concurrency including `waiting_for_approval`, replay protection, rate limiting, and bounded audit metadata.
- **D-15:** The regression proof may combine live callback evidence with focused backend tests when the real Feishu app cannot trigger every negative case. The evidence report must clearly label which checks are live and which are automated regression coverage.

### Evidence and Redaction

- **D-16:** Evidence reports use explicit `Pass`, `Caveat`, and `Blocked` states. Do not remove a caveat without a corresponding real callback artifact.
- **D-17:** Record exact commands and environment checks for `lark-cli auth status --verify`, `lark-cli doctor`, Gateway startup, callback URL setup, and any signed-event test reruns. CLI version drift may be recorded as advisory, not as a blocker when auth and doctor pass.
- **D-18:** Before committing Phase 7 evidence docs, run `git diff --check` and a targeted secret scan over modified Feishu evidence/config/docs. Suspicious matches must be fixed or classified as safe placeholders/test fixtures.

### Agent Discretion

- The planner may decide whether Phase 7 creates a dedicated Feishu callback evidence report or appends Feishu rows to the v1.1 evidence matrix, as long as the callback evidence is directly discoverable from the Phase 7 summary.
- The planner may use a local signed-event request to exercise the Gateway public route when real developer-console access is blocked, but it must label that evidence as simulated and keep FEI-01 non-pass unless a real console callback also occurred.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone and Phase Scope

- `.planning/ROADMAP.md` — Active v1.1 roadmap and Phase 7 scope.
- `.planning/REQUIREMENTS.md` — FEI-01, FEI-02, and FEI-03 requirements.
- `.planning/PROJECT.md` — Product boundary: local-first control plane, evidence-first readiness, no runtime expansion in v1.1.
- `.planning/milestones/v1.0-phases/OF-02-public-feishu-webhook-safety/02-VERIFICATION.md` — Baseline public webhook safety verification.
- `.planning/phases/OF-06-live-provider-and-platform-smoke-evidence/06-CONTEXT.md` — Evidence state and redaction pattern from Phase 6.

### Feishu Product and API Contract

- `docs/API.md` — Public Feishu webhook contract, URL verification behavior, signature/replay/rate policy, encrypted payload caveat, and authority boundaries.
- `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md` — Feishu inbound command bridge next-stage planning source.
- `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` — v1.1 evidence matrix entry point created in Phase 6.

### Gateway Code and Tests

- `packages/gateway/src/routes/integrations-feishu.ts` — Public webhook route implementation.
- `packages/gateway/src/services/integrations/feishu-cli.ts` — CLI discovery/auth/status integration path.
- `packages/gateway/src/db/repositories/feishu-integration-repository.ts` — Feishu tenant config and public webhook lookup.
- `packages/gateway/test/feishu-integration.test.ts` — Authenticated inbound and public webhook regression tests.
- `packages/gateway/test/copilot-routes.test.ts` — Pending-action, approval, and Copilot run regression tests.

</canonical_refs>

<code_context>
## Existing Code Insights

### Public Webhook Route

- `POST /api/v1/integrations/feishu/webhook/:publicId` is implemented in `packages/gateway/src/routes/integrations-feishu.ts`.
- The route resolves tenant integration by `publicId`, rejects missing/disabled/invalid config, handles URL verification challenge, verifies ordinary event signatures against raw body, rejects encrypted payloads, applies replay/rate protection, and normalizes accepted events into bounded inbound Copilot policy.
- The route deliberately does not use the normal OpenForge REST envelope because Feishu expects callback-compatible responses.

### Existing Regression Coverage

- `packages/gateway/test/feishu-integration.test.ts` covers URL verification without Copilot side effects, public webhook replay rejection, public webhook rate limiting, public free-form approval rejection, authenticated inbound replay/rate limits, and `waiting_for_approval` concurrency blocking.
- `docs/API.md` already documents that SQLite-backed replay/rate storage is single-Gateway only and that multi-instance exposure requires shared replay/rate storage.
- `docs/API.md` already documents encrypted payloads as unsupported and fail-closed.

### CLI Preflight

- The host has `lark-cli` available. `lark-cli auth status --verify` and `lark-cli doctor` passed in elevated execution on 2026-05-21.
- `lark-cli event consume` is a long-running event-bus consumer. It can be used to verify Feishu-side event availability, but it does not exercise OpenForge's public HTTP callback route.
- `lark-cli doctor` reported the installed CLI as `1.0.32` with latest `1.0.36`; update is advisory unless a callback validation command requires a newer CLI.

</code_context>

<specifics>
## Specific Ideas

- Phase 7 plan should first prepare a callback evidence checklist: Gateway environment, public HTTPS URL, Feishu developer-console event subscription, URL verification, optional message-event trigger, sanitized log/audit capture, and rerun instructions.
- If no public URL exists, a tunnel or deployed endpoint may be used only if the resulting URL routes to the same Gateway route and no secrets are printed in logs or evidence.
- The evidence report should separate `Real Console Callback`, `Local Signed Route Regression`, `CLI Preflight`, and `Authority Regression` rows so pass/caveat states are not conflated.
- For FEI-03, use existing automated tests for negative controls and add missing tests only if the planned evidence review finds a real authority gap.

</specifics>

<deferred>
## Deferred Ideas

- Implementing encrypted Feishu event payload decryption is deferred to `FEI-FUTURE-01`.
- Implementing shared replay/rate storage for multi-instance public webhook exposure is deferred to `FEI-FUTURE-02`.
- Feishu terminal control, free-form approvals, approval links, batch authorization, and unattended Feishu-driven development loops remain out of scope.
- First-user readiness packaging and support diagnostics are Phase 8 scope.

</deferred>

---

*Phase: 7-Feishu Live Callback Readiness*
*Context gathered: 2026-05-21T15:19:06+08:00*
