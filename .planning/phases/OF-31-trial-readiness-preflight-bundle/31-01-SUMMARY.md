# Trial Readiness Preflight Bundle Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Added `scripts/validate-trial-readiness.mjs`.
- Added `scripts/validate-trial-readiness.test.mjs`.
- Added root command `pnpm trial:readiness-validate`.
- Added CI script harness coverage for the mocked readiness contract.
- Updated trial docs to name the readiness preflight before a real collection
  round.
- Updated the trial intake validator so the checklist preserves the readiness
  command.

## Readiness Scope

`pnpm trial:readiness-validate` runs:

- trial intake material validation;
- GitHub issue route validation for #3, #4, and #5;
- external evidence gate registry validation.

The command returns `gateClearingEvidence: false`.

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
node --test scripts/validate-trial-readiness.test.mjs scripts/validate-trial-feedback-intake.test.mjs
pnpm trial:readiness-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
pnpm trial:intake-validate
pnpm evidence:gates-validate
rg -n 'trial:readiness-validate|validate-trial-readiness|gateClearingEvidence|trial readiness' package.json docs scripts .github .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

## Next Work

Run a real first-user trial and complete a redacted feedback packet. Use the
readiness preflight before collection and the feedback audit before maintainer
triage.
