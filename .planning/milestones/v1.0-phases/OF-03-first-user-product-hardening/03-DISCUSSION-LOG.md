# Phase 3: First-User Product Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20T09:40:24+08:00
**Phase:** 3-First-User Product Hardening
**Areas discussed:** Dependency and runtime failure states, Provider and Copilot recovery, Copilot state ordering, Partial failure visibility, Trial feedback and evidence routing, Web E2E signal
**Mode:** Auto-selected recommended options because the user explicitly instructed future steps to proceed without waiting for replies.

---

## Dependency And Runtime Failure States

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing runtime/dependency contracts | Use `dependency-check.ts`, `terminalRuntime.mode`, and adapter discovery as source of truth. | ✓ |
| Add frontend-only inference | Infer runtime readiness from UI labels and local component state. | |
| Defer dependency UX | Leave dependency issues to docs and trial checklist only. | |

**User's choice:** Auto-selected recommended option.
**Notes:** This keeps Gateway as the authority and avoids false-green launch readiness.

---

## Provider And Copilot Recovery

| Option | Description | Selected |
|--------|-------------|----------|
| Classify exact missing layer | Show no compatible provider, missing credential, missing model, auth failure, network failure, rate limit, timeout, or invalid selected model. | ✓ |
| Generic provider error | Collapse failures into a single "provider not configured" banner. | |
| Provider redesign | Rework provider architecture during Phase 3. | |

**User's choice:** Auto-selected recommended option.
**Notes:** Provider SSOT and Codex subscription boundary stay locked.

---

## Copilot State Ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Monotonic helper-level guard | Guard by run `updatedAt`, event sequence, pending-action freshness, terminal-state precedence, and request ordering. | ✓ |
| Component-local patches | Add ad hoc stale checks at each async call site. | |
| Backend-only assumption | Assume backend ordering prevents stale Web state. | |

**User's choice:** Auto-selected recommended option.
**Notes:** Existing `shouldKeepCopilotActiveRunState` is the right seam, but planning should verify all poll, gateway-event, approval, and send paths.

---

## Partial Failure Visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Degraded panels with actions | Keep unaffected data visible while showing explicit retry/recovery guidance for failed panels. | ✓ |
| Empty fallback | Render empty lists or omit cards on query failure. | |
| Modal errors | Block the whole page for individual query failures. | |

**User's choice:** Auto-selected recommended option.
**Notes:** This matches first-user recovery needs and avoids hiding actionable failure evidence.

---

## Trial Feedback And Evidence Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Reproducible task template | Require environment, commands, console/network errors, steps, expected/actual behavior, category, severity, and mapped requirement. | ✓ |
| Freeform notes | Accept vague observations and triage manually later. | |
| Treat missing manual evidence as pass | Remove caveats once automated tests are green. | |

**User's choice:** Auto-selected recommended option.
**Notes:** External evidence caveats remain explicit until real provider or physical host proof exists.

---

## Web E2E Signal

| Option | Description | Selected |
|--------|-------------|----------|
| Strict mocks and stable selectors | Harden unhandled `/api/v1/*` fallback behavior and key selectors in touched specs. | ✓ |
| Wholesale rewrite | Split and rewrite all long E2E files before product fixes. | |
| Leave permissive mocks | Keep fallback success behavior to reduce fixture maintenance. | |

**User's choice:** Auto-selected recommended option.
**Notes:** Copilot spec already demonstrates strict fallback; Models spec still needs tightening.

---

## the agent's Discretion

- Exact UI copy, component extraction, and test grouping can be decided during planning/implementation.
- Plans may consolidate related UX requirements if traceability to `UX-01` through `UX-07` remains explicit.

## Deferred Ideas

- Feishu project-manager ledger.
- SSH/remote execution.
- Hosted collaboration/cloud/billing/telemetry.
- Codex app-server Web prompt/turn input.
- Natural-language Feishu approvals or terminal control.
