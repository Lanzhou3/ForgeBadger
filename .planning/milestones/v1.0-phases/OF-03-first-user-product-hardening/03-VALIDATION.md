---
phase: 03
slug: first-user-product-hardening
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-20
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest, Playwright, node:test if backend contracts change |
| **Config file** | `packages/web/vitest.config.ts`, `packages/web/playwright.config.ts`, `packages/gateway/package.json` |
| **Quick run command** | `pnpm --dir packages/web vitest run src/lib/copilot.test.ts src/lib/session-connect-state.test.ts` |
| **Full suite command** | `pnpm --dir packages/web typecheck && pnpm --dir packages/web exec playwright test e2e/copilot.spec.ts e2e/models.spec.ts --project=chromium` |
| **Estimated runtime** | ~180 seconds when local Web/E2E runtime is available |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --dir packages/web vitest run src/lib/copilot.test.ts src/lib/session-connect-state.test.ts` when Web helper behavior changes; run the focused package test matching the files touched.
- **After every plan wave:** Run `pnpm --dir packages/web typecheck` plus the focused Vitest or Playwright spec for that wave.
- **Before `$gsd-verify-work`:** Focused Web typecheck, focused unit tests, focused E2E tests where loopback/browser runtime is available, and `git diff --check` must be green or have an explicit environment-gated caveat.
- **Max feedback latency:** 180 seconds for unit/typecheck feedback; E2E may exceed this and should be run at wave boundaries.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 03-01 | 1 | UX-01, UX-06 | T-03-01 | No secrets in dependency/runtime guidance; terminal support does not false-green unsupported runtimes | unit/typecheck | `pnpm --dir packages/web typecheck` | ✅ W0 | ⬜ pending |
| 03-01-02 | 03-01 | 1 | UX-01 | T-03-01 | UI uses Gateway dependency/adapter source of truth | unit | `pnpm --dir packages/web vitest run src/lib/session-connect-state.test.ts` | ✅ W0 | ⬜ pending |
| 03-02-01 | 03-02 | 2 | UX-02, UX-03, UX-05, UX-06 | T-03-02 | Stale Copilot responses cannot overwrite newer terminal/cancel/approval state | unit | `pnpm --dir packages/web vitest run src/lib/copilot.test.ts` | ✅ W0 | ⬜ pending |
| 03-02-02 | 03-02 | 2 | UX-02, UX-03 | T-03-02 | Provider recovery messages remain redacted and route users to Models | e2e | `pnpm --dir packages/web exec playwright test e2e/copilot.spec.ts --project=chromium` | ✅ W0 | ⬜ pending |
| 03-03-01 | 03-03 | 1 | UX-04 | — | Feedback template forbids secrets and maps reports to UX requirements | docs/static | `rg -n "UX-0[1-7]|API keys|JWT|attach tokens|Caveat" docs/TRIAL-CHECKLIST.md docs/TRIAL-FEEDBACK.md` | ✅ W0 | ⬜ pending |
| 03-04-01 | 03-04 | 2 | UX-07 | T-03-03 | Unhandled E2E API routes fail closed instead of returning success | e2e/static | `pnpm --dir packages/web exec playwright test e2e/models.spec.ts --project=chromium` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Physical Windows/WSL terminal support | UX-01 | Ubuntu CI and local sandbox cannot prove native Windows or WSL browser terminal behavior | Keep `Caveat` until a real Windows/WSL host runs the trial checklist and attaches evidence |
| Live provider Copilot smoke | UX-02 | Requires a disposable real provider credential and explicit model id | Keep `Caveat` unless `pnpm smoke:copilot-provider` output is recorded without secrets |
| Multi-tab Copilot observation | UX-03 | Automated E2E can simulate stale responses; real browser multi-tab behavior is still useful beta evidence | Record manual notes if first-user feedback reports multi-tab confusion |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s for unit/typecheck sampling
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-20
