# Phase 2: Public Feishu Webhook Safety - Context

**Gathered:** 2026-05-20T00:38:00+08:00
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase moves Feishu inbound from the current authenticated OpenForge test adapter toward a public Feishu webhook boundary. It specifies and implements the minimum public-ingress controls needed before exposure: explicit enablement, Feishu URL verification, request signature validation, timestamp and replay protection, deployment-safe rate limiting, fail-closed tenant policy, redaction, and audit behavior.

This phase does not make Feishu an approval authority, terminal input channel, project-manager ledger, or autonomous development entry point.

</domain>

<decisions>
## Implementation Decisions

### Public Webhook Boundary

- **D-01:** Add a separate public webhook route instead of reusing `POST /api/v1/integrations/feishu/inbound`. The existing `/inbound` route remains the OpenForge JWT-protected local/test adapter.
- **D-02:** The public route should be addressable by a per-integration public id, for example `POST /api/v1/integrations/feishu/webhook/:publicId`. The public id helps resolve the tenant configuration before signature verification but is not treated as a secret or an auth factor.
- **D-03:** Public webhook handling is disabled by default at both product/config level and route behavior level. A tenant must explicitly enable the webhook and complete required webhook verification settings before ordinary events can create Copilot work.
- **D-04:** Do not mix JWT and Feishu webhook auth modes in one handler. Public webhook responses follow Feishu webhook protocol needs, not the OpenForge authenticated REST envelope.

### Feishu Verification And Challenge Handling

- **D-05:** Ordinary public webhook events must require Feishu request headers `X-Lark-Request-Timestamp`, `X-Lark-Request-Nonce`, and `X-Lark-Signature`, and verify the signature against the raw request body using the configured Feishu event encrypt key.
- **D-06:** Timestamp freshness is part of the boundary. The default acceptance window should be narrow, recommended 5 minutes. Missing, malformed, old, or far-future timestamps fail before event normalization and before Copilot execution.
- **D-07:** URL verification challenge handling is allowed before ordinary event dispatch, but it must not trigger Copilot, audit side effects beyond bounded setup telemetry, or policy-changing behavior. Challenge responses return only the challenge JSON expected by Feishu.
- **D-08:** If encrypted event payloads are supported in this phase, decrypt before event normalization and then validate the Feishu verification token or header token fields against tenant config. If encrypted events are not implemented in the first plan, public route enablement must stay blocked until the unsupported mode is explicit in docs/tests.

### Replay And Rate-Limit Store

- **D-09:** Public webhook replay protection must use a dedicated persistent store, not audit-log search and not an in-memory `Map`. The replay key should include tenant/integration identity plus Feishu event id or message id; nonce/signature replay should also be rejected within the timestamp window.
- **D-10:** The first implementation may use SQLite because OpenForge's current product deployment is local-first single Gateway. This is acceptable only when docs state the single-instance boundary and tests prove restart-safe replay behavior.
- **D-11:** Multi-instance public webhook deployment is out of scope until a shared replay/rate-limit store exists. If a future deployment mode declares multiple Gateway instances without a shared store, public webhook enablement must fail closed or refuse startup for that route.
- **D-12:** Public webhook rate limiting must be at least per tenant/integration and per Feishu chat; when a mapped user can be resolved, also apply per mapped OpenForge user. Rate-limit state for the public route should be repository-backed so process restarts do not silently remove protection.

### Tenant Policy And Command Semantics

- **D-13:** After signature/replay checks, public events normalize into the same bounded inbound command shape already used by the guarded `/inbound` adapter, then reuse the same fail-closed policy: integration enabled, not emergency disabled, identity mode configured, explicit chat allowlist, user mapping, optional project ownership, active-run blocking, redaction, and audit.
- **D-14:** Public webhook support should initially accept only the minimum Feishu message event type needed for the command bridge, such as direct messages or allowed chat messages addressed to the bot. Unknown event types are acknowledged without side effects after verification.
- **D-15:** Free-form Feishu approval text remains non-authoritative. Public webhook text such as `approve`, `批准`, or `/approve <id>` must not approve pending actions or send terminal input. Approval stays with OpenForge pending-action routes until a later signed, one-time approval-token design exists.
- **D-16:** Feishu is still a Copilot collaboration ingress, not a shell, terminal, or project-manager ledger. Public webhook events may create a Copilot conversation/run with `source: "feishu"` only after all boundary checks pass.

### Failure Responses, Redaction, And Audit

- **D-17:** Signature, timestamp, decrypt, and token failures return a minimal non-2xx response and create no Copilot run. If the tenant cannot be resolved safely, logs must not include raw body, signature, token, encrypt key, or message text.
- **D-18:** Policy rejections after tenant resolution should write redacted audit rows with reason codes. For Feishu-delivered events, prefer a minimal 2xx acknowledgement for non-actionable or unauthorized-but-authentic events when retrying would amplify load or leak policy state.
- **D-19:** Accepted public webhook events must write audit rows with bounded metadata: integration id or public id, event id/message id, chat id, mapped OpenForge user id, optional project id, run id, conversation id, pending action count, and redacted text summary.
- **D-20:** API responses, audit details, provider request context, Copilot messages, and diagnostics must never include raw Feishu message text if it contains secret-like values, raw CLI stderr, tokens, signatures, encrypt keys, or Feishu credentials.

### the agent's Discretion

The user explicitly approved using recommended options for the remaining GSD interaction points. Planner and implementer may choose exact table/field names, helper boundaries, and status codes as long as they preserve the decisions above and existing repository/API conventions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### GSD Roadmap And Requirements

- `.planning/PROJECT.md` — product boundary: local-first control plane; Feishu is a controlled collaboration entry point, not execution authority.
- `.planning/REQUIREMENTS.md` — FSH-01 through FSH-04 are the Phase 2 requirements.
- `.planning/ROADMAP.md` — Phase 2 goal, dependencies, canonical refs, success criteria, and plan split.
- `.planning/DECISIONS-INDEX.md` — locked product and architecture decisions, especially Gateway/Web split and Feishu boundary.

### Feishu/Copilot Design

- `docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md` — upstream Feishu collaboration model, approval model, error handling, security requirements, and open questions.
- `docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md` — original Feishu project-manager implementation plan and inbound bridge task context.
- `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md` — completed guarded inbound adapter, acceptance gates, and explicit public-webhook follow-up backlog.
- `docs/API.md` — current Feishu integration route contract, inbound test-adapter contract, Copilot approval semantics, and Feishu outbound allowlist behavior.

### Code And Tests

- `packages/gateway/src/routes/integrations-feishu.ts` — current Feishu config/user-mapping routes and JWT-protected inbound adapter.
- `packages/gateway/src/db/repositories/feishu-integration-repository.ts` — current tenant-scoped Feishu config and user mapping repository.
- `packages/gateway/src/routes/copilot.ts` — Copilot run lifecycle, approval handlers, and Feishu outbound approval policy.
- `packages/gateway/src/db/repositories/copilot-repository.ts` — Copilot conversation/run/source persistence and live-run constraints.
- `packages/gateway/src/services/copilot/orchestrator.ts` — `source: "feishu"` prompt/context handling for Copilot runs.
- `packages/gateway/src/services/copilot/redaction.ts` — redaction helper used before persistence/provider/audit surfaces.
- `packages/gateway/test/feishu-integration.test.ts` — current route-level Feishu config, mapping, inbound, replay, rate-limit, redaction, and no-free-form-approval coverage.
- `packages/gateway/test/copilot-routes.test.ts` — Copilot pending-action and approved Feishu outbound behavior.

### External Primary Reference

- `https://pkg.go.dev/gitee.com/larksuite/oapi-sdk-go/v3/event` — Lark/Feishu event SDK constants and event model, including `X-Lark-Request-Nonce`, `X-Lark-Request-Timestamp`, `X-Lark-Signature`, challenge response shape, encrypted message shape, and request types.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `createFeishuIntegrationRoutes()` already centralizes Feishu status, config, user mapping, and guarded inbound behavior. The public webhook can live beside it but must not inherit the JWT-auth-only assumptions of `/inbound`.
- `inboundFeishuCommandSchema`, `sendInboundReject()`, `recordInboundAccept()`, `inboundMessagePayload()`, and `inboundTextSummary()` are close analogs for public event normalization and redacted audit payloads.
- `FeishuIntegrationRepository` already provides tenant-scoped config and user mappings. Phase 2 likely needs additive webhook fields and repository methods for public id lookup and encrypted webhook verification settings.
- `CopilotRepository.findActiveRun()`, `CopilotOrchestrator.runText()`, and existing `source: "feishu"` support can be reused after all public webhook boundary checks pass.
- `redactCopilotText()` and `AuditLogRepository` are existing safety primitives for bounded persistence and audit rows.

### Established Patterns

- Gateway owns integration enforcement and all `/api/v1` route behavior; Web must not implement webhook API behavior in Next.js routes.
- Business data is tenant-scoped by `user_id`; public webhook tenant resolution must happen before any tenant-scoped repository is trusted.
- Existing `/inbound` currently uses an in-memory `Map` for rate limiting and audit-log search for replay. That is acceptable only for the guarded local adapter and should not be copied as-is to the public route.
- `packages/gateway/src/server.ts` currently calls `express.json()` globally before route mounting. Public webhook signature verification needs raw request bytes, so planning must account for raw-body capture or route-specific parser ordering.
- API docs use OpenForge envelopes for authenticated REST routes, but Feishu webhook challenge/event responses need protocol-specific minimal JSON.

### Integration Points

- Route mount: `packages/gateway/src/routes/index.ts` currently mounts Feishu under `/api/v1/integrations/feishu`.
- Environment/config: `packages/gateway/src/config/env.ts` currently has no public Feishu webhook env toggles; route enablement will need explicit config design.
- Database: `packages/gateway/src/db/schema.ts` and migrations currently have Feishu config/user-mapping tables but no webhook secret/public-id/replay/rate-limit tables.
- Tests: extend `packages/gateway/test/feishu-integration.test.ts` before implementation for signature, challenge, stale timestamp, replay persistence, rate limiting, fail-closed config, policy rejection, and no-free-form-approval cases.

</code_context>

<specifics>
## Specific Ideas

- The public webhook route should be a safety boundary, not just a public alias for the current `/inbound` test adapter.
- The first implementation should be honest about deployment topology: local single-Gateway plus SQLite is acceptable; multi-instance must wait for a shared replay/rate-limit store.
- Feishu URL verification is setup-only behavior. It should return the expected challenge and stop there.

</specifics>

<deferred>
## Deferred Ideas

- Signed Feishu approval links or approval codes remain deferred until a later explicit one-time approval-token design.
- Project-manager work item and ledger tables remain deferred until public webhook safety evidence is accepted.
- Multi-instance public webhook operation with Redis/Postgres/shared replay and rate-limit store is deferred to a later deployment topology phase.
- Batch authorization, terminal input budgets, and unattended loops remain out of scope.

</deferred>

---

*Phase: 2-Public Feishu Webhook Safety*
*Context gathered: 2026-05-20T00:38:00+08:00*
