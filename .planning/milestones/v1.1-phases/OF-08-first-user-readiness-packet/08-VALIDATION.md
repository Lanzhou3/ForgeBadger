---
phase: 08
slug: first-user-readiness-packet
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-21
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Markdown/source checks, GSD evidence checks, targeted repository scans |
| **Config file** | `.planning/config.json`, `package.json` |
| **Quick run command** | `git diff --check` |
| **Full suite command** | `git diff --check && gsd-sdk query check.decision-coverage-plan .planning/phases/OF-08-first-user-readiness-packet .planning/phases/OF-08-first-user-readiness-packet/08-CONTEXT.md` |
| **Estimated runtime** | ~5-15 seconds for static checks; manual feedback collection varies |

---

## Sampling Rate

- **After every task commit:** Run `git diff --check` plus a focused `rg` check for the headings or caveat rows touched by that task.
- **After every plan wave:** Run the full suite command and the plan's targeted secret scan over modified Phase 8 documents.
- **Before `$gsd-verify-work`:** Full suite, post-planning/decision coverage, closeout source checks, and targeted secret scan must pass or classify any placeholder matches.
- **Max feedback latency:** 15 seconds for static checks; real first-user feedback remains manual and may stay `Caveat`.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | READY-01 | T-08-01 / T-08-04 | Trial checklist separates first-user quick path from maintainer evidence without deleting caveat rules | static | `rg -n "Quick Smoke|Evidence Appendix|docs/TRIAL-FEEDBACK.md|OpenForge first-user trial feedback" docs/TRIAL-CHECKLIST.md` | W1 | pending |
| 08-01-02 | 01 | 1 | READY-02 | T-08-02 / T-08-04 | Support diagnostics packet states provider, runtime/terminal, and Feishu collection plus redaction boundaries | static | `rg -n "provider|runtime|terminal|Feishu|diagnostics/export|openforge doctor|pnpm smoke:copilot-provider|pnpm smoke:feishu-public-webhook|lark-cli auth status --verify|lark-cli doctor" docs/SUPPORT-DIAGNOSTICS.md` | W1 | pending |
| 08-01-03 | 01 | 1 | BETA-03 | T-08-03 / T-08-04 | First-user feedback is caveated unless a real feedback artifact is attached | static | `rg -n "First-user feedback|Caveat|maintainer/operator|docs/TRIAL-FEEDBACK.md|OpenForge first-user trial feedback|clearing condition" docs/reports/v1.1-readiness-closeout-2026-05-21.md docs/TRIAL-CHECKLIST.md docs/SUPPORT-DIAGNOSTICS.md` | W1/W2 | pending |
| 08-02-01 | 02 | 2 | READY-03 | T-08-03 / T-08-04 | Closeout exposes user-visible caveats with owner, clearing condition, and route | static | `rg -n "live provider|Windows/WSL|Feishu developer-console callback|first-user feedback|owner|clearing condition|backlog|issue|Caveat|Blocked|Pass" docs/reports/v1.1-readiness-closeout-2026-05-21.md` | W2 | pending |
| 08-02-02 | 02 | 2 | BETA-03, READY-01, READY-02, READY-03 | T-08-04 | Phase 8 docs contain no unclassified raw secrets or sensitive terminal/provider output | static | `git diff --check` plus targeted `rg` scan from the plan | W2 | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Attach real first-user feedback | BETA-03 | Requires an actual first user or operator-provided feedback packet | File a GitHub `OpenForge first-user trial feedback` issue or attach a redacted Markdown packet following `docs/TRIAL-FEEDBACK.md`; update closeout with link, severity, owner, and disposition |
| Live provider pass | READY-03 | Requires disposable provider credential and explicit model id | Run required `pnpm smoke:copilot-provider` outside the repository with disposable credentials and record only redacted/public output |
| Physical Windows/WSL pass | READY-03 | Requires a real Windows/WSL host | Run the WSL terminal checklist and update the evidence matrix/closeout without pasting sensitive terminal output |
| Real Feishu console callback pass | READY-03 | Requires public HTTPS route and Feishu developer console action | Run URL verification against `POST /api/v1/integrations/feishu/webhook/:publicId` and record sanitized result only |

---

## Validation Sign-Off

- [x] All tasks have automated verify or manual-only justification.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-21
