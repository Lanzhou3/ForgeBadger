---
phase: 02
slug: public-feishu-webhook-safety
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-20
---

# Phase 02 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js `node:test` with `tsx`, TypeScript typecheck |
| **Config file** | `packages/gateway/package.json`, `packages/gateway/tsconfig.json` |
| **Quick run command** | `pnpm --dir packages/gateway test test/feishu-integration.test.ts` |
| **Full suite command** | `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts && pnpm --dir packages/gateway typecheck` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --dir packages/gateway test test/feishu-integration.test.ts` when code/tests changed; docs-only tasks run `git diff --check` plus targeted `rg`.
- **After every plan wave:** Run `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts && pnpm --dir packages/gateway typecheck`.
- **Before `$gsd-verify-work`:** Full suite above plus `git diff --check` must be green.
- **Max feedback latency:** 90 seconds for focused backend tests.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | FSH-01 | T-02-01 | Public webhook contract is specified before implementation. | docs | `rg -n "webhook/:publicId|X-Lark-Request-Timestamp|X-Lark-Signature|url_verification|single Gateway" docs/API.md` | yes | pending |
| 02-01-02 | 01 | 1 | FSH-01, FSH-02, FSH-03, FSH-04 | T-02-02 | Test matrix names all boundary controls and non-goals. | docs | `rg -n "signature|timestamp|replay|rate limit|free-form approval|terminal input" docs/API.md` | yes | pending |
| 02-02-01 | 02 | 2 | FSH-01 | T-02-03 | Public route rejects unauthentic events and handles challenge without side effects. | integration | `pnpm --dir packages/gateway test test/feishu-integration.test.ts` | yes | pending |
| 02-02-02 | 02 | 2 | FSH-02 | T-02-04 | Replay/rate-limit state is repository-backed and restart-safe for single Gateway. | integration | `pnpm --dir packages/gateway test test/feishu-integration.test.ts` | yes | pending |
| 02-02-03 | 02 | 2 | FSH-03, FSH-04 | T-02-05 | Existing fail-closed policy, redaction, audit, and no-approval semantics hold for public webhook events. | integration | `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts` | yes | pending |

*Status: pending until execution.*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Feishu developer-console URL verification | FSH-01 | Requires a live Feishu app and public callback URL. | Optional evidence only: configure a disposable Feishu app with the generated webhook URL, record Pass/Caveat/Blocked without storing real tokens. |
| Multi-instance public webhook safety | FSH-02 | Multi-instance deployment is out of scope until shared store exists. | Confirm docs and route enablement state that multi-instance is unsupported without shared replay/rate store. |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or explicit manual-only caveats.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target is under 90 seconds for focused backend tests.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-20
