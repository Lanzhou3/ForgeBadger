# Operator Trial Dry Run Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Added Phase 22 as an operator dry-run under v1.5 First-User Trial Operations.
- Created the dry-run report:
  `docs/reports/phase-22-operator-trial-dry-run-2026-05-29.md`.
- Recorded current-host dependency evidence: Linux `not_wsl`, Node `v24.14.1`,
  pnpm `10.33.2`, tmux `3.4`, Claude Code `2.1.152`, OpenCode `1.15.4`, Codex
  CLI `0.134.0`, and `openforge doctor` terminal mode `native_tmux`.
- Temporarily started Gateway/Web and verified Gateway health plus `/login`.
- Reran `pnpm smoke:copilot-provider` outside the sandbox after the sandbox
  blocked `tsx` IPC; the smoke returned skipped with
  `missing_provider_credential`.
- Updated `docs/TRIAL-CHECKLIST.md` so caveat/blocker feedback capture uses the
  full v1.5 packet fields.
- Recorded the source-startup `.env` override finding: package dev scripts
  source the root `.env` after prefix environment values, so isolated dry-run
  state must be configured deliberately.

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
rg --hidden --no-ignore -n "Phase 22|Operator Trial Dry Run|DRYRUN|DRYSAFE|PLAN-22|phase-22-operator-trial-dry-run" .planning docs MEMORY.md .gitignore
rg -n '^\\| `LIVE-PROVIDER` \\| `Caveat` \\|' docs/EXTERNAL-EVIDENCE-GATES.md
rg -n '^\\| `WINDOWS-WSL` \\| `Caveat` \\|' docs/EXTERNAL-EVIDENCE-GATES.md
rg -n '^\\| `FEISHU-CALLBACK` \\| `Blocked` \\|' docs/EXTERNAL-EVIDENCE-GATES.md
rg -n '^\\| `FIRST-USER-FEEDBACK` \\| `Caveat` \\|' docs/EXTERNAL-EVIDENCE-GATES.md
rg --hidden --no-ignore --glob '!22-01-PLAN.md' --glob '!22-01-SUMMARY.md' -n "sk-[A-Za-z0-9_-]{8,}|Bearer [A-Za-z0-9._-]+|OPENFORGE_MASTER_KEY=|OPENFORGE_JWT_SECRET=|x-lark-signature|BEGIN (RSA|OPENSSH|PRIVATE) KEY|api[_-]?key[:=][A-Za-z0-9_-]{8,}" docs/reports/phase-22-operator-trial-dry-run-2026-05-29.md docs/TRIAL-CHECKLIST.md .planning/phases/OF-22-operator-trial-dry-run MEMORY.md || true
rg --hidden --no-ignore --glob '!22-01-PLAN.md' --glob '!22-01-SUMMARY.md' -n "Please .*raw|Attach raw|Upload raw|Submit raw|Paste raw|Copy raw|get .*token|developer tools.*token|paste the .*token|paste your .*key" docs/reports/phase-22-operator-trial-dry-run-2026-05-29.md docs/TRIAL-CHECKLIST.md .planning/phases/OF-22-operator-trial-dry-run MEMORY.md || true
git diff --check
```

Results:

- Phase 22 references, requirement IDs, and report allowlist were found in the
  active planning docs, `MEMORY.md`, `docs`, and `.gitignore`.
- Canonical gate states remain unchanged in
  `docs/EXTERNAL-EVIDENCE-GATES.md`.
- The Phase 22 report records `LIVE-PROVIDER` as `Caveat`, `WINDOWS-WSL` as
  `Caveat`, `FEISHU-CALLBACK` as `Blocked`, and `FIRST-USER-FEEDBACK` as
  `Caveat`.
- Secret-like value scan returned no matches.
- Unsafe raw-evidence request scan returned no matches.
- `git diff --check` exited 0.

## Next Work

Collect a real first-user packet through the updated template or GitHub issue
form. Phase 22 proves the operator collection loop and records a support gap,
but it does not satisfy `FIRST-USER-FEEDBACK`.
