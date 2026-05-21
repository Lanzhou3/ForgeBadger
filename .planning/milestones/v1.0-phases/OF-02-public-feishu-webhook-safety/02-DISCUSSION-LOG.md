# Phase 2: Public Feishu Webhook Safety - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20T00:38:00+08:00
**Phase:** 2-Public Feishu Webhook Safety
**Areas discussed:** Public webhook route boundary, Feishu verification and challenge handling, replay and rate-limit topology, tenant policy and command semantics, failure responses and audit

---

## Public Webhook Route Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Separate public webhook route | Add a public Feishu webhook route distinct from the JWT-protected `/inbound` test adapter; default closed and explicitly enabled. | ✓ |
| Reuse `/inbound` for both modes | Combine OpenForge JWT test adapter and Feishu signature mode in one handler. | |
| Design only | Specify public webhook behavior but do not implement the route in Phase 2. | |

**User's choice:** The user explicitly approved recommended options for subsequent GSD interaction points.
**Notes:** Selected the separate route to preserve a clean boundary and prevent the local/test adapter from becoming a public ingress path by accident.

---

## Feishu Verification And Challenge Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Strict signature for ordinary events, special setup-only challenge path | Verify ordinary events with timestamp, nonce, signature, raw body, and configured encrypt key; handle URL verification challenge only as setup behavior. | ✓ |
| Token-only verification | Rely primarily on body/header verification token. | |
| Accept unsigned setup and event payloads while disabled | Lower onboarding friction but weakens public-ingress boundary. | |

**User's choice:** Recommended strict verification path.
**Notes:** Feishu challenge response is allowed before event dispatch but must not execute Copilot or create side effects.

---

## Replay And Rate-Limit Topology

| Option | Description | Selected |
|--------|-------------|----------|
| SQLite-backed single-instance store with explicit multi-instance block | Use persistent local DB tables for current local-first Gateway and document/fail closed before multi-instance use. | ✓ |
| Keep in-memory `Map` limiter | Minimal implementation but loses protection on restart and fails in multi-instance deployments. | |
| Require shared Redis/Postgres now | Stronger distributed story but larger than current local-first Phase 2 scope. | |

**User's choice:** Recommended SQLite-backed single-instance store.
**Notes:** The current `/inbound` audit-log replay check and in-memory rate limiter should not be copied into the public route.

---

## Tenant Policy And Command Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse guarded inbound policy after public boundary checks | After signature/replay validation, normalize to the existing bounded inbound command shape and apply enabled/emergency/identity/allowlist/mapping/project/active-run/redaction/audit checks. | ✓ |
| Create a broader event-to-Copilot surface | Accept more Feishu event types and let Copilot decide. | |
| Notifications only | Acknowledge public events but do not create Copilot runs. | |

**User's choice:** Recommended reuse of guarded inbound policy.
**Notes:** Free-form approval text and terminal input stay out of scope.

---

## Failure Responses And Audit

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal Feishu-compatible responses plus redacted audit | Non-authentic requests fail non-2xx; authentic-but-unauthorized/policy-rejected events are redacted and usually acked to avoid retry amplification. | ✓ |
| Always use OpenForge REST envelope | Consistent with authenticated APIs but not ideal for Feishu webhook protocol. | |
| Always return explicit policy failures | Easier debugging but leaks policy state and can amplify retries. | |

**User's choice:** Recommended minimal protocol responses and redacted audit.
**Notes:** Public webhook responses must not leak raw message text, signatures, tokens, encrypt keys, or policy internals.

---

## the agent's Discretion

- The user instructed that later GSD interaction points should use the agent's recommended方案 without waiting for additional replies.
- Exact field names, table names, helper boundaries, and status-code details are left to planner/executor as long as the locked context decisions remain true.

## Deferred Ideas

- Signed Feishu approval links or code approval.
- Project-manager work item and ledger tables.
- Multi-instance webhook operation with a shared replay/rate-limit store.
- Batch authorization, terminal input budgets, and unattended loops.
