# Tokenless Trial Diagnostics Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Extended the trial feedback intake validator to cover
  `docs/TRIAL-RUNBOOK.md`.
- Added a regression test that rejects browser developer tools, Local Storage,
  `openforge.token`, and `authorization: Bearer <token>` guidance in the
  first-user runbook.
- Replaced the runbook's first-user curl/token diagnostics path with Web
  Settings diagnostics export steps and maintainer-only fallback wording.

## Gate State

No external gate moved to `Pass`.

| Gate | State |
|------|-------|
| `LIVE-PROVIDER` | Caveat |
| `WINDOWS-WSL` | Caveat |
| `FEISHU-CALLBACK` | Blocked |
| `FIRST-USER-FEEDBACK` | Caveat |

## Verification

Commands run:

```bash
node scripts/validate-trial-feedback-intake.mjs
node --test scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'Open browser developer tools|Read Local Storage|openforge\\.token|authorization: Bearer <token>' docs/TRIAL-RUNBOOK.md
rg -n 'Open Settings|Export diagnostics JSON|Do not ask first users to retrieve browser auth tokens|Maintainer-only fallback' docs/TRIAL-RUNBOOK.md
rg --hidden --no-ignore -n 'RUNBOOKSAFE-|PLAN-25|Phase 25|tokenless-trial-diagnostics|Tokenless Trial Diagnostics' .planning docs MEMORY.md scripts
git diff --check
```

Results:

- Red test failed before implementation because the validator ignored runbook
  browser-token guidance.
- Validator CLI returned `{"ok":true,"errors":[]}` after the runbook fix.
- Script harness tests passed: 4 files, 4 pass, 0 fail.
- Token fallback scan found no matches in `docs/TRIAL-RUNBOOK.md`.
- Required runbook diagnostics guidance was present: Open Settings, Export
  diagnostics JSON, maintainer-only fallback, and no first-user browser-token
  retrieval.
- External gate registry still shows `LIVE-PROVIDER` `Caveat`,
  `WINDOWS-WSL` `Caveat`, `FEISHU-CALLBACK` `Blocked`, and
  `FIRST-USER-FEEDBACK` `Caveat`.
- Phase 25 references and requirement IDs were found in active planning, docs,
  memory, and scripts.
- `git diff --check` exited 0.

## Next Work

Collect a real first-user packet through the validated issue form, Markdown
template, and tokenless runbook. Phase 25 improves trial safety; it does not
satisfy `FIRST-USER-FEEDBACK`.
