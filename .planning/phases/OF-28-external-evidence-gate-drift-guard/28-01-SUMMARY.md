# External Evidence Gate Drift Guard Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Added `scripts/validate-external-evidence-gates.mjs`.
- Added `scripts/validate-external-evidence-gates.test.mjs`.
- Added root command `pnpm evidence:gates-validate`.
- Added CI script harness coverage.
- Updated the external evidence registry rerun paths to name the exact live
  provider smoke command and first-user packet audit command.

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
node --test scripts/validate-external-evidence-gates.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'evidence:gates-validate|validate-external-evidence-gates|pnpm trial:feedback-audit|pnpm smoke:copilot-provider|FIRST-USER-FEEDBACK' package.json docs scripts .github .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

## Next Work

Collect a real first-user packet and run both `pnpm trial:feedback-audit` and
`pnpm evidence:gates-validate` before changing any external evidence gate.
