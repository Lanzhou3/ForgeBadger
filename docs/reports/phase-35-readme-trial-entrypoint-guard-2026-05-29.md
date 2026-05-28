# Phase 35 README Trial Entrypoint Guard

> Scope: v1.5 README trial-entrypoint consistency.
> This keeps both feedback collection paths visible; it does not collect
> first-user evidence.

## Summary

Phase 35 extends the trial intake validator to the repository README layer.
The root `README.md` now links both first-user feedback collection paths:

- Markdown packet template: `docs/TRIAL-FEEDBACK.md`
- GitHub issue form: `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`

The validator also reads the localized README files so translated trial
entrypoints remain aligned with the same collection paths.

## Implementation

| Area | Change |
|------|--------|
| README | `README.md` adds the GitHub feedback issue-form link under First User Trial. |
| Validator | `scripts/validate-trial-feedback-intake.mjs` reads root and localized README files. |
| Tests | `scripts/validate-trial-feedback-intake.test.mjs` rejects README trial entrypoints missing the issue-form link. |
| Planning | Phase 35 context, plan, summary, roadmap, requirements, state, and memory updates. |

## Safety Boundary

The change is documentation and validation only. It does not:

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
node scripts/validate-trial-feedback-intake.test.mjs
pnpm trial:intake-validate
pnpm trial:readiness-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'README|GitHub feedback issue form|openforge-trial-feedback|ROOT_README|LOCALIZED_README|trial:intake-validate|FIRST-USER-FEEDBACK' README.md docs/README.zh-CN.md docs/README.zh-TW.md scripts/validate-trial-feedback-intake.mjs scripts/validate-trial-feedback-intake.test.mjs .planning MEMORY.md docs/reports/phase-35-readme-trial-entrypoint-guard-2026-05-29.md
git diff --check
```

## Next Work

Collect a real first-user feedback packet or filed issue-form feedback artifact.
Run the relevant audit command before maintainer triage. Keep
`FIRST-USER-FEEDBACK` as `Caveat` until a reviewed artifact satisfies the
external gate clearing condition.
