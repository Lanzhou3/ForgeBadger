---
phase: 01
slug: beta-evidence-closure
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-19T20:15:17+08:00
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | GSD checks, shell commands, node:test, Playwright |
| **Config file** | `.planning/config.json`, `.github/workflows/ci.yml` |
| **Quick run command** | `git diff --check && gsd-sdk query init.phase-op 1` |
| **Full suite command** | `git diff --check && gsd-sdk query init.phase-op 1 && gsd-sdk query roadmap.get-phase 1` |
| **Estimated runtime** | ~10 seconds without manual smoke commands |

---

## Sampling Rate

- **After every task commit:** Run `git diff --check && gsd-sdk query init.phase-op 1`.
- **After every plan wave:** Run `git diff --check && gsd-sdk query init.phase-op 1 && gsd-sdk query roadmap.get-phase 1`.
- **Before `$gsd-verify-work`:** Full suite plus any available evidence commands must be recorded.
- **Max feedback latency:** 60 seconds for automated GSD/doc checks.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | REL-04 | T-01-01 | No stale source-of-truth state or secret text is introduced | doc/static | `git diff --check && gsd-sdk query init.phase-op 1` | ✅ | ⬜ pending |
| 01-02-01 | 02 | 2 | REL-01 | T-01-02 | Provider smoke evidence omits plaintext credentials and full raw model output | manual + script | `pnpm smoke:copilot-provider` when disposable credentials exist | ✅ | ⬜ pending |
| 01-03-01 | 03 | 2 | REL-02, REL-03 | T-01-03 | Feedback and platform evidence exclude secrets and preserve Windows caveat without physical proof | manual/doc | `git diff --check && gsd-sdk query roadmap.get-phase 1` | ✅ | ⬜ pending |
| 01-04-01 | 04 | 3 | REL-05, REL-06 | T-01-04 | CI/release evidence cannot look green when terminal gates are skipped | shell/e2e/manual | `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts` when tmux exists | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements:

- `scripts/smoke-copilot-provider.ts`
- `scripts/smoke-copilot-provider.test.ts`
- `packages/gateway/test/integration/tmux.test.ts`
- `packages/web/e2e/gate-d-smoke.spec.ts`
- `docs/TRIAL-CHECKLIST.md`
- `docs/TRIAL-FEEDBACK.md`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Disposable live provider smoke | REL-01 | Requires a real disposable provider credential unavailable to CI | Run `OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1 ... pnpm smoke:copilot-provider`; record redacted JSON only |
| Physical Windows/WSL terminal smoke | REL-02 | Ubuntu CI cannot prove native Windows or WSL terminal behavior | Complete the Windows section of `docs/TRIAL-CHECKLIST.md`; keep caveat if no host exists |
| First-user feedback triage | REL-03 | Requires real user trial observations | Convert completed feedback into a ledger row with reproduction, category, severity, requirement, and follow-up phase |
| Browser terminal `gate-d-smoke` release evidence | REL-05 | Requires Gateway/Web/CLI host setup beyond stable CI `mvp1-smoke` | Run `packages/web/e2e/gate-d-smoke.spec.ts` when host dependencies are available; otherwise record caveat |

---

## Validation Sign-Off

- [x] All tasks have automated verify or explicit manual-only verification.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency < 60 seconds for automated doc/GSD checks.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
