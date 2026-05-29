# Trial Feedback Issue Audit Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Added `scripts/audit-trial-feedback-issue.mjs`.
- Added `scripts/audit-trial-feedback-issue.test.mjs`.
- Added root command `pnpm trial:feedback-issue-audit`.
- Added CI script harness coverage for the mocked issue audit contract.
- Updated trial docs to name the GitHub issue-form audit path.
- Updated the trial intake validator so the checklist preserves the issue audit
  command.

## Audit Scope

`pnpm trial:feedback-issue-audit -- --issue=<number>`:

- reads GitHub issue metadata and body through `gh issue view`;
- requires the `trial-feedback` label;
- maps issue-form sections into the existing Markdown packet audit shape;
- rejects incomplete packet fields and secret-like raw issue body content;
- returns `gateClearingEvidence: false`.

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
node --test scripts/audit-trial-feedback-issue.test.mjs scripts/validate-trial-feedback-intake.test.mjs
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
pnpm trial:intake-validate
pnpm trial:readiness-validate
pnpm evidence:gates-validate
pnpm trial:feedback-issue-audit -- --issue=5
rg -n 'trial:feedback-issue-audit|audit-trial-feedback-issue|readyForHumanTriage|gateClearingEvidence' package.json docs scripts .github .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

The live issue audit against issue #5 is expected to fail because #5 is a
follow-up tracker, not a completed feedback packet. That negative result keeps
the first-user gate caveated.

## Next Work

When a real first-user feedback issue is filed, run
`pnpm trial:feedback-issue-audit -- --issue=<number>` before maintainer triage.
