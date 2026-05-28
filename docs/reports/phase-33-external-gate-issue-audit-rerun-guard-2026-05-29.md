# Phase 33 External Gate Issue Audit Rerun Guard

> Scope: v1.5 external gate registry consistency.
> This guards the issue-form audit route; it does not collect first-user feedback.

## Summary

Phase 33 makes the external evidence gate registry preserve the GitHub
issue-form feedback audit command alongside the Markdown packet audit command.

The protected first-user feedback rerun path now includes:

```bash
pnpm trial:feedback-audit -- <packet.md>
pnpm trial:feedback-issue-audit -- --issue=<number>
```

## Implementation

| Area | Change |
|------|--------|
| Registry | `docs/EXTERNAL-EVIDENCE-GATES.md` names both audit commands for `FIRST-USER-FEEDBACK`. |
| Validator | `scripts/validate-external-evidence-gates.mjs` requires `pnpm trial:feedback-issue-audit`. |
| Tests | `scripts/validate-external-evidence-gates.test.mjs` rejects removing the issue audit command. |
| Planning | Phase 33 context, plan, summary, roadmap, requirements, state, and memory updates. |

## Safety Boundary

The change is read-only and guard-only. It does not:

- submit or mutate GitHub issues;
- attach artifacts;
- collect diagnostics;
- mark first-user feedback complete;
- clear `FIRST-USER-FEEDBACK` or any other external evidence gate.

External gate states remain:

- `LIVE-PROVIDER`: `Caveat`
- `WINDOWS-WSL`: `Caveat`
- `FEISHU-CALLBACK`: `Blocked`
- `FIRST-USER-FEEDBACK`: `Caveat`

## Verification

Verification completed:

```bash
node --test scripts/validate-external-evidence-gates.test.mjs
pnpm evidence:gates-validate
pnpm trial:readiness-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'trial:feedback-issue-audit|FIRST-USER-FEEDBACK|gateClearingEvidence' docs/EXTERNAL-EVIDENCE-GATES.md scripts/validate-external-evidence-gates.mjs scripts/validate-external-evidence-gates.test.mjs .planning MEMORY.md docs/reports/phase-33-external-gate-issue-audit-rerun-guard-2026-05-29.md
git diff --check
```

## Next Work

Collect a real first-user feedback packet or filed issue-form feedback artifact.
Run the relevant audit command before maintainer triage. Keep
`FIRST-USER-FEEDBACK` as `Caveat` until a reviewed artifact satisfies the
external gate clearing condition.
