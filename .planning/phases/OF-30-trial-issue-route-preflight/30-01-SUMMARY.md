# Trial Issue Route Preflight Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Added `scripts/validate-trial-issue-routes.mjs`.
- Added `scripts/validate-trial-issue-routes.test.mjs`.
- Added root command `pnpm trial:issue-routes-validate`.
- Added CI script harness coverage for the mocked issue-route contract.
- Updated trial docs to name the route preflight before using existing GitHub
  follow-up issues.
- Updated the trial intake validator so the checklist preserves the route
  preflight command.

## Live Preflight Result

`pnpm trial:issue-routes-validate` checked:

| Issue | Gate | State |
|-------|------|-------|
| #3 | `LIVE-PROVIDER` | OPEN |
| #4 | `WINDOWS-WSL` | OPEN |
| #5 | `FIRST-USER-FEEDBACK` | OPEN |

The command returned `gateClearingEvidence: false`.

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
node --test scripts/validate-trial-issue-routes.test.mjs
node --test scripts/validate-trial-feedback-intake.test.mjs
pnpm trial:issue-routes-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
pnpm trial:intake-validate
pnpm evidence:gates-validate
rg -n 'trial:issue-routes-validate|validate-trial-issue-routes|gateClearingEvidence|issue #3|issue #4|issue #5' package.json docs scripts .github .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

## Next Work

Collect a real first-user packet and run `pnpm trial:feedback-audit` before
maintainer triage. Run `pnpm evidence:gates-validate` before changing any
external evidence gate.
