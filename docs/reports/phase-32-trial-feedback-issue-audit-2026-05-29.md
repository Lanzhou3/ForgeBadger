# Phase 32 Trial Feedback Issue Audit

> Scope: v1.5 first-user GitHub issue-form feedback triage.
> This audits issue-form feedback; it does not clear external gates.

## Summary

Phase 32 adds a maintainer-run GitHub issue audit command:

```bash
pnpm trial:feedback-issue-audit -- --issue=<number>
```

The command reads a GitHub issue body, converts the issue-form sections into
the existing trial feedback packet shape, and runs the same packet audit used
for local Markdown feedback.

## Implementation

| Area | Change |
|------|--------|
| Validator | Added `scripts/audit-trial-feedback-issue.mjs`. |
| Tests | Added `scripts/audit-trial-feedback-issue.test.mjs`. |
| Package script | Added `pnpm trial:feedback-issue-audit`. |
| CI | Added mocked issue audit test to script harness coverage. |
| Docs | Trial runbook, checklist, feedback template, and CI plan name the issue audit path. |
| Intake guard | `pnpm trial:intake-validate` now preserves the issue audit command in the checklist. |

## Safety Boundary

`pnpm trial:feedback-issue-audit` is read-only. It does not:

- create, update, close, label, or comment on GitHub issues;
- submit first-user feedback;
- export diagnostics;
- attach artifacts;
- clear `FIRST-USER-FEEDBACK` or any other external evidence gate.

External gate states remain:

- `LIVE-PROVIDER`: `Caveat`
- `WINDOWS-WSL`: `Caveat`
- `FEISHU-CALLBACK`: `Blocked`
- `FIRST-USER-FEEDBACK`: `Caveat`

## Live Negative Classification

The command was run against issue #5, which is the first-user follow-up tracker,
not a completed first-user feedback issue. The command correctly rejected it
and returned `gateClearingEvidence: false`.

## Verification

Verification completed:

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

## Next Work

When a real first-user feedback issue is filed, audit it with
`pnpm trial:feedback-issue-audit -- --issue=<number>` before maintainer triage.
Do not change the external gate registry to `Pass` until the required artifact
exists and is reviewed.
