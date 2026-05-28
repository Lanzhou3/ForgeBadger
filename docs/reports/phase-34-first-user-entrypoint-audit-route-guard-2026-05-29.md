# Phase 34 First-User Entrypoint Audit Route Guard

> Scope: v1.5 first-user/support entrypoint consistency.
> This keeps audit routes visible; it does not collect first-user evidence.

## Summary

Phase 34 extends the trial intake validator beyond the runbook, checklist,
feedback template, and issue form. The validator now also guards
`docs/OPEN-SOURCE-READINESS.md` and `docs/SUPPORT-DIAGNOSTICS.md` so public and
support-facing entrypoints preserve both first-user feedback audit routes.

Protected audit routes:

```bash
pnpm trial:feedback-audit -- <packet.md>
pnpm trial:feedback-issue-audit -- --issue=<number>
```

## Implementation

| Area | Change |
|------|--------|
| Validator | `scripts/validate-trial-feedback-intake.mjs` reads the open-source readiness and support diagnostics docs. |
| Tests | `scripts/validate-trial-feedback-intake.test.mjs` rejects missing entrypoint audit-route language. |
| Docs | `docs/OPEN-SOURCE-READINESS.md` and `docs/SUPPORT-DIAGNOSTICS.md` name both audit commands before triage. |
| Planning | Phase 34 context, plan, summary, roadmap, requirements, state, and memory updates. |

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
node --test scripts/validate-trial-feedback-intake.test.mjs
pnpm trial:intake-validate
pnpm trial:readiness-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'trial:feedback-audit|trial:feedback-issue-audit|OPEN-SOURCE-READINESS|SUPPORT-DIAGNOSTICS|ENTRYPOINT' docs/OPEN-SOURCE-READINESS.md docs/SUPPORT-DIAGNOSTICS.md scripts/validate-trial-feedback-intake.mjs scripts/validate-trial-feedback-intake.test.mjs .planning MEMORY.md docs/reports/phase-34-first-user-entrypoint-audit-route-guard-2026-05-29.md
git diff --check
```

## Next Work

Collect a real first-user feedback packet or filed issue-form feedback artifact.
Run the relevant audit command before maintainer triage. Keep
`FIRST-USER-FEEDBACK` as `Caveat` until a reviewed artifact satisfies the
external gate clearing condition.
