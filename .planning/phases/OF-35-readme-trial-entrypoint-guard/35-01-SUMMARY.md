# README Trial Entrypoint Guard Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Updated `README.md` so the First User Trial section links the GitHub feedback
  issue form alongside the runbook, checklist, troubleshooting, and Markdown
  feedback template.
- Extended `scripts/validate-trial-feedback-intake.mjs` so
  `pnpm trial:intake-validate` guards the root README and localized README
  trial entrypoints.
- Added a regression test that rejects a README trial entrypoint missing the
  GitHub feedback issue form.

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
pnpm trial:readiness-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'README|GitHub feedback issue form|openforge-trial-feedback|ROOT_README|LOCALIZED_README|trial:intake-validate|FIRST-USER-FEEDBACK' README.md docs/README.zh-CN.md docs/README.zh-TW.md scripts/validate-trial-feedback-intake.mjs scripts/validate-trial-feedback-intake.test.mjs .planning MEMORY.md docs/reports/phase-35-readme-trial-entrypoint-guard-2026-05-29.md
git diff --check
```

## Next Work

Collect a real first-user feedback packet or issue-form feedback artifact. Run
the relevant audit command before maintainer triage. Keep
`FIRST-USER-FEEDBACK` as `Caveat` until a reviewed artifact satisfies the
external gate clearing condition.
