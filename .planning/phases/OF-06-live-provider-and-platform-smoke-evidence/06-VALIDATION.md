---
phase: 06
slug: live-provider-and-platform-smoke-evidence
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-21T10:37:00+08:00
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | GSD checks, shell commands, node:test, Playwright, manual smoke checklist |
| **Config file** | `.planning/config.json`, `.github/workflows/ci.yml`, `package.json` |
| **Quick run command** | `git diff --check && gsd-sdk query init.phase-op 6` |
| **Full suite command** | `git diff --check && gsd-sdk query init.phase-op 6 && gsd-sdk query check.decision-coverage-plan .planning/phases/OF-06-live-provider-and-platform-smoke-evidence .planning/phases/OF-06-live-provider-and-platform-smoke-evidence/06-CONTEXT.md` |
| **Estimated runtime** | ~15 seconds without manual smoke commands |

---

## Sampling Rate

- **After every task commit:** Run `git diff --check && gsd-sdk query init.phase-op 6`.
- **After every plan wave:** Run the full suite command above plus any available smoke command for that wave.
- **Before `$gsd-verify-work`:** Full suite plus available provider, tmux, browser, and WSL evidence commands must be recorded.
- **Max feedback latency:** 60 seconds for automated GSD/doc checks; manual smoke latency is bounded by host/provider availability.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | BETA-01, BETA-04 | T-06-01 | Master matrix exists and live provider evidence omits raw credentials and full payloads | doc/static | `git diff --check && gsd-sdk query init.phase-op 6` | ✅ | ✅ green |
| 06-01-02 | 01 | 1 | BETA-01 | T-06-01 | Live provider smoke records `Pass`, `Caveat`, or `Blocked` without leaking the API key | smoke/script | `pnpm smoke:copilot-provider` or required-live variant when a disposable credential exists | ✅ | ✅ green |
| 06-01-03 | 01 | 1 | BETA-04 | T-06-02 | Smoke/trial docs link to the matrix without becoming a conflicting source of truth | doc/static | `rg -n "v1.1-beta-evidence-burn-down-2026-05-21|Pass|Caveat|Blocked" docs/SMOKE-TEST.md docs/TRIAL-CHECKLIST.md` | ✅ | ✅ green |
| 06-02-01 | 02 | 2 | BETA-02, BETA-05 | T-06-03 | WSL evidence cannot be marked `Pass` without real WSL host output | manual/doc | `git diff --check && gsd-sdk query init.phase-op 6` | ✅ | ✅ green |
| 06-02-02 | 02 | 2 | BETA-05 | T-06-04 | CI, `gate-d`, and focused tmux rows are separate and do not claim `pnpm -r test` is sufficient | e2e/shell/doc | `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts` when tmux exists | ✅ | ✅ green |
| 06-02-03 | 02 | 2 | BETA-04, BETA-05 | T-06-05 | Evidence docs contain no raw API keys, JWTs, Feishu secrets, full provider payloads, or full model output | static/security | `git diff --check` plus targeted secret scan over modified evidence docs | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements:

- `scripts/smoke-copilot-provider.ts`
- `scripts/smoke-copilot-provider.test.ts`
- `packages/gateway/test/integration/tmux.test.ts`
- `packages/web/e2e/mvp1-smoke.spec.ts`
- `packages/web/e2e/gate-d-smoke.spec.ts`
- `docs/SMOKE-TEST.md`
- `docs/TRIAL-CHECKLIST.md`
- `docs/CI-CD-PLAN.md`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Disposable live provider pass evidence | BETA-01 | Requires a real disposable OpenAI or Anthropic credential supplied outside the repository | Run the required-live provider smoke with provider, model id, and disposable key; record only redacted JSON/public metadata |
| Physical Windows/WSL terminal evidence | BETA-02 | Ubuntu/Linux CI cannot prove native Windows or WSL terminal behavior | On a real WSL host, run `openforge doctor`, launch a project, attach browser terminal, verify tmux session, disconnect/reconnect WebSocket, restart Gateway, and verify no orphan smoke session |
| Release-manager redaction review | BETA-04, BETA-05 | Static scans cannot understand every context-sensitive leak | Review modified evidence docs and classify any secret-like scan hits as fixed, fixture, or placeholder without pasting raw sensitive values |

---

## Validation Sign-Off

- [x] All tasks have automated verify or explicit manual-only verification.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency < 60 seconds for automated doc/GSD checks.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** verified 2026-05-21T04:46:49Z
