# Trial Feedback Intake Contract Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Added a bounded validator for the first-user feedback GitHub issue form and
  Markdown template.
- Added tests for required fields, field types, required dropdown options,
  required flags, Markdown sections, safety language, and unsafe raw-evidence
  wording.
- Wired the validator test into CI script harness coverage.
- Added Phase 24 planning and report artifacts.

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
node --test scripts/validate-trial-feedback-intake.test.mjs
node scripts/validate-trial-feedback-intake.mjs
node --test scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n '\\| `LIVE-PROVIDER` \\| `Caveat`|\\| `WINDOWS-WSL` \\| `Caveat`|\\| `FEISHU-CALLBACK` \\| `Blocked`|\\| `FIRST-USER-FEEDBACK` \\| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
rg -n 'Paste raw|Upload raw|Submit raw|Attach raw|paste your .*key|retrieve browser auth tokens from developer tools' .github/ISSUE_TEMPLATE/openforge-trial-feedback.yml docs/TRIAL-FEEDBACK.md
rg --hidden --no-ignore -n "INTAKE-|PLAN-24|Phase 24|trial-feedback-intake|validate-trial-feedback-intake" .planning docs MEMORY.md .github scripts
git diff --check
```

Results:

- Red test failed before implementation with `ERR_MODULE_NOT_FOUND` for
  `scripts/validate-trial-feedback-intake.mjs`.
- Validator CLI returned `{"ok":true,"errors":[]}`.
- Script harness tests passed: 4 files, 4 pass, 0 fail.
- External gate registry still shows `LIVE-PROVIDER` `Caveat`,
  `WINDOWS-WSL` `Caveat`, `FEISHU-CALLBACK` `Blocked`, and
  `FIRST-USER-FEEDBACK` `Caveat`.
- Unsafe-term scan found only the negated safety line
  `Do not ask first users to retrieve browser auth tokens from developer tools`.
- Phase 24 references and requirement IDs were found in active planning, docs,
  CI, memory, and scripts.

## Next Work

Collect a real first-user packet through the now-validated issue form or
Markdown template. Phase 24 improves intake quality; it does not satisfy
`FIRST-USER-FEEDBACK`.
