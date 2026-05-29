# External Gate Issue Audit Rerun Guard Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Updated `docs/EXTERNAL-EVIDENCE-GATES.md` so the
  `FIRST-USER-FEEDBACK` rerun path names both audit commands:
  `pnpm trial:feedback-audit` and `pnpm trial:feedback-issue-audit`.
- Updated `scripts/validate-external-evidence-gates.mjs` to require the issue
  audit command in the protected rerun path.
- Added a regression test that rejects registry drift if the issue audit command
  is removed.
- Synced planning, decision, memory, and report docs for Phase 33.

## Gate State

No external gate moved to `Pass`.

| Gate | State |
|------|-------|
| `LIVE-PROVIDER` | Caveat |
| `WINDOWS-WSL` | Caveat |
| `FEISHU-CALLBACK` | Blocked |
| `FIRST-USER-FEEDBACK` | Caveat |

## Verification

Completed commands:

```bash
node --test scripts/validate-external-evidence-gates.test.mjs
pnpm evidence:gates-validate
pnpm trial:readiness-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'trial:feedback-issue-audit|FIRST-USER-FEEDBACK|gateClearingEvidence' docs/EXTERNAL-EVIDENCE-GATES.md scripts/validate-external-evidence-gates.mjs scripts/validate-external-evidence-gates.test.mjs .planning MEMORY.md docs/reports/phase-33-external-gate-issue-audit-rerun-guard-2026-05-29.md
git diff --check
```

## Next Work

Collect a real first-user feedback packet or issue-form feedback artifact. Run
the relevant audit command before maintainer triage, then update the external
gate registry only if the reviewed artifact satisfies the clearing condition.
