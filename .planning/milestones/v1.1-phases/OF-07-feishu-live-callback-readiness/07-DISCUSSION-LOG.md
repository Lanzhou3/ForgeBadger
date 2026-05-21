# Phase 7: Feishu Live Callback Readiness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21T15:19:06+08:00
**Phase:** 7-Feishu Live Callback Readiness
**Areas discussed:** Real callback evidence, Deployment topology, Encrypted payload boundary, Authority regression, Evidence redaction

---

## Real Callback Evidence

### Callback path

| Option | Description | Selected |
|--------|-------------|----------|
| Real console HTTP callback | Feishu developer-console callback to OpenForge public webhook is required for FEI-01 pass. | ✓ |
| CLI event consume only | Treat `lark-cli event consume` long connection as sufficient. | |
| Simulated signed request only | Use local signed Gateway request as the whole evidence path. | |

**User's choice:** Real console HTTP callback.
**Notes:** User clarified that Feishu CLI is already configured on the server. Correction recorded: CLI availability is not the blocker; missing public HTTPS URL or developer-console callback setup is the potential live blocker.

### CLI role

| Option | Description | Selected |
|--------|-------------|----------|
| Auxiliary preflight | Use CLI auth/doctor/event checks as supporting evidence only. | ✓ |
| Primary evidence | Let CLI long connection satisfy callback readiness. | |
| Ignore CLI | Do not use CLI in Phase 7. | |

**User's choice:** Auxiliary preflight.
**Notes:** `lark-cli auth status --verify` and `lark-cli doctor` passed. `event consume` bypasses OpenForge Gateway public route and therefore cannot prove URL verification, raw-body signature verification, replay/rate store, or tenant lookup.

### No public URL or console access

| Option | Description | Selected |
|--------|-------------|----------|
| Caveat/Blocked with exact blocker | Record missing URL/access and rerun path; do not call CLI unavailable. | ✓ |
| Treat as pass if CLI works | CLI event path substitutes for console callback. | |
| Stop milestone entirely | Phase cannot create any evidence without live callback. | |

**User's choice:** Caveat/Blocked with exact blocker.
**Notes:** FEI-01 pass still requires a real console callback attempt.

---

## Deployment Topology

### Supported topology

| Option | Description | Selected |
|--------|-------------|----------|
| Single Gateway only | Current public webhook safety claim is limited to one Gateway instance with SQLite replay/rate storage. | ✓ |
| Multi-instance supported | Claim horizontal support with current stores. | |
| Implement shared store now | Expand Phase 7 into infrastructure work. | |

**User's choice:** Single Gateway only.
**Notes:** Multi-instance public exposure requires shared replay and shared rate-limit storage.

### Multi-instance behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Disabled or fail closed | Public webhook remains disabled or fails closed without shared stores. | ✓ |
| Best-effort warning | Allow but document caveat. | |
| In-memory fallback | Use per-process maps for distributed replay/rate protection. | |

**User's choice:** Disabled or fail closed.
**Notes:** Do not describe SQLite-backed replay/rate protection as horizontally safe.

---

## Encrypted Payload Boundary

### Encrypted event support

| Option | Description | Selected |
|--------|-------------|----------|
| Unsupported fail-closed | Keep top-level `encrypt` payloads rejected in Phase 7. | ✓ |
| Implement decrypt support now | Add decrypt path, tests, and security review in this phase. | |
| Accept encrypted payloads without decrypt | Acknowledge encrypted events without action. | |

**User's choice:** Unsupported fail-closed.
**Notes:** Decrypt support is deferred unless a real app requires a dedicated security-reviewed implementation phase.

### User-facing caveat

| Option | Description | Selected |
|--------|-------------|----------|
| Public webhook off for encrypted app mode | Tenants requiring encrypted mode must not enable public webhook yet. | ✓ |
| Silent internal caveat | Keep detail only in developer docs. | |
| Claim supported after local tests | Treat current rejection as support. | |

**User's choice:** Public webhook off for encrypted app mode.
**Notes:** Caveat should be visible in evidence/release docs.

---

## Authority Regression

### Required negative controls

| Option | Description | Selected |
|--------|-------------|----------|
| Approval, terminal, tenant/audit boundaries | Verify free-form text cannot approve, write terminal, or bypass policy. | ✓ |
| Approval only | Only test free-form approval rejection. | |
| Live happy path only | Only prove callback can trigger a run. | |

**User's choice:** Approval, terminal, tenant/audit boundaries.
**Notes:** Existing tests cover several negative controls; planner should confirm coverage and add focused tests only for concrete gaps.

### Evidence composition

| Option | Description | Selected |
|--------|-------------|----------|
| Live plus automated regression | Label which checks are live and which are regression tests. | ✓ |
| Live-only | Require every negative case through a real Feishu event. | |
| Automated-only | No real callback evidence required. | |

**User's choice:** Live plus automated regression.
**Notes:** This avoids overstating live coverage while still proving authority boundaries.

---

## Evidence Redaction

### Evidence content

| Option | Description | Selected |
|--------|-------------|----------|
| Public metadata and redacted summaries only | No raw tokens, keys, signatures, request bodies, JWTs, or private message text. | ✓ |
| Include redacted raw callback body | Store selected callback body snippets. | |
| Operator discretion | Decide case by case. | |

**User's choice:** Public metadata and redacted summaries only.
**Notes:** Applies to CLI output, Gateway logs, audit rows, and callback setup evidence.

### Pre-commit checks

| Option | Description | Selected |
|--------|-------------|----------|
| Diff check plus targeted secret scan | Run both before committing evidence docs. | ✓ |
| Diff check only | No explicit secret scan. | |
| No extra check | Trust manual redaction. | |

**User's choice:** Diff check plus targeted secret scan.
**Notes:** Suspicious matches must be fixed or classified as placeholders/test fixtures.

---

## Deferred Ideas

- Encrypted Feishu event payload decryption is future work.
- Shared replay/rate storage for multi-instance exposure is future work.
- Feishu terminal control, free-form approvals, approval links, batch authorization, and unattended Feishu-driven development loops remain out of scope.
- First-user readiness packaging and support diagnostics are Phase 8 scope.
