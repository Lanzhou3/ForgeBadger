# Copilot Evidence Packet Audit Guard Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Extended the Markdown feedback packet audit to require Copilot smoke/provider,
  prompt, read-tool, pending-action, memory-write, and terminal-boundary
  evidence fields.
- Updated the GitHub issue-form audit adapter to map the additional Copilot
  issue fields into the Markdown packet shape.
- Fixed feedback field parsing so blank field values do not accidentally
  capture the next line.
- Extended the trial intake validator so the Markdown template and GitHub issue
  form cannot drop required Copilot evidence prompts.
- Added the Copilot memory-write prompt to generated feedback drafts.

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
node --test scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs
pnpm trial:intake-validate
pnpm trial:readiness-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'Copilot prompt used|Copilot read-tool evidence observed|Copilot memory write proposal tested|Confirmed no terminal/shell/Codex turn input in Copilot|FIRST-USER-FEEDBACK|phase-36' scripts docs .github .planning MEMORY.md
git diff --check
```

## Next Work

Collect a real first-user feedback packet or issue-form feedback artifact. Run
the relevant audit command before maintainer triage. Keep
`FIRST-USER-FEEDBACK` as `Caveat` until a reviewed artifact satisfies the
external gate clearing condition.
