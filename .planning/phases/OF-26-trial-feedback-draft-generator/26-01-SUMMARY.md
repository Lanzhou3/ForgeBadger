# Trial Feedback Draft Generator Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Added `scripts/create-trial-feedback-draft.mjs`.
- Added `scripts/create-trial-feedback-draft.test.mjs`.
- Added root command `pnpm trial:feedback-draft`.
- Added CI script harness coverage.
- Linked the helper from trial runbook, checklist, and feedback template.

## Gate State

No external gate moved to `Pass`.

| Gate | State |
|------|-------|
| `LIVE-PROVIDER` | Caveat |
| `WINDOWS-WSL` | Caveat |
| `FEISHU-CALLBACK` | Blocked |
| `FIRST-USER-FEEDBACK` | Caveat |

## Verification

Commands to record after final verification:

```bash
node --test scripts/create-trial-feedback-draft.test.mjs
node scripts/create-trial-feedback-draft.mjs --startup-path 'source fallback' --web-url http://127.0.0.1:48732 --gateway-url http://127.0.0.1:48731
pnpm trial:feedback-draft -- --output /tmp/openforge-trial-feedback-draft-smoke.md
node --test scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'trial:feedback-draft|create-trial-feedback-draft|not gate-clearing evidence|FIRST-USER-FEEDBACK' package.json docs scripts .github .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

Results:

- Red test failed before implementation with `ERR_MODULE_NOT_FOUND` for
  `scripts/create-trial-feedback-draft.mjs`.
- Focused generator test passed.
- CLI stdout smoke generated a draft headed `OpenForge Trial Feedback Draft`
  and included the `not submitted, not reviewed, not gate-clearing evidence`
  status.
- Package-script smoke wrote `/tmp/openforge-trial-feedback-draft-smoke.md`
  with bounded environment metadata and tokenless diagnostics guidance.
- Script harness tests passed: 5 files, 5 pass, 0 fail.
- Trial docs, CI, planning, memory, package script, and scripts contain the
  draft helper references and `FIRST-USER-FEEDBACK` caveat language.
- External gate registry still shows `LIVE-PROVIDER` `Caveat`,
  `WINDOWS-WSL` `Caveat`, `FEISHU-CALLBACK` `Blocked`, and
  `FIRST-USER-FEEDBACK` `Caveat`.
- `git diff --check` exited 0.

## Next Work

Use the draft helper during the next real first-user run, then complete and
redact the packet before linking it. The draft alone does not satisfy
`FIRST-USER-FEEDBACK`.
