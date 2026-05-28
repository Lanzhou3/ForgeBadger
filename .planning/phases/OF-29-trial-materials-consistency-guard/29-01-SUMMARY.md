# Trial Materials Consistency Guard Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Extended `scripts/validate-trial-feedback-intake.mjs` to read and validate
  `docs/TRIAL-CHECKLIST.md`.
- Added checklist drift regression coverage to
  `scripts/validate-trial-feedback-intake.test.mjs`.
- Added root command `pnpm trial:intake-validate`.
- Updated trial docs and CI plan to name the intake validator as a local
  materials-consistency guard.
- Added CI command coverage for `pnpm trial:intake-validate` and
  `pnpm evidence:gates-validate`.

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
node scripts/validate-trial-feedback-intake.test.mjs
pnpm trial:intake-validate
pnpm evidence:gates-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'trial:intake-validate|REQUIRED_CHECKLIST_PHRASES|pnpm trial:feedback-audit|pnpm evidence:gates-validate|FIRST-USER-FEEDBACK' package.json docs scripts .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

## Next Work

Collect a real first-user packet and run both `pnpm trial:feedback-audit` and
`pnpm evidence:gates-validate` before changing any external evidence gate.
