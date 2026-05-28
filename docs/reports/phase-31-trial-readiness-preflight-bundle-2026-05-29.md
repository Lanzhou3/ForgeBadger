# Phase 31 Trial Readiness Preflight Bundle

> Scope: v1.5 first-user trial preflight aggregation.
> This verifies readiness; it does not clear external gates.

## Summary

Phase 31 adds a maintainer-run readiness command:

```bash
pnpm trial:readiness-validate
```

The command runs the existing trial intake, issue-route, and external evidence
gate validators together so a maintainer can verify the local trial collection
loop before inviting or guiding a real first user.

## Implementation

| Area | Change |
|------|--------|
| Validator | Added `scripts/validate-trial-readiness.mjs`. |
| Tests | Added `scripts/validate-trial-readiness.test.mjs`. |
| Package script | Added `pnpm trial:readiness-validate`. |
| CI | Added mocked readiness-contract test to script harness coverage. |
| Docs | Trial runbook, checklist, feedback template, and CI plan name the readiness preflight. |
| Intake guard | `pnpm trial:intake-validate` now preserves the readiness preflight command in the checklist. |

## Live Readiness Result

The live command verified:

| Check | Result |
|-------|--------|
| Trial intake materials | Pass |
| GitHub issue routes | Pass |
| External evidence gate registry | Pass |

The command returned `gateClearingEvidence: false`.

## Safety Boundary

`pnpm trial:readiness-validate` is read-only. It does not:

- create, update, close, label, or comment on GitHub issues;
- collect or submit first-user feedback;
- export diagnostics;
- attach artifacts;
- clear `FIRST-USER-FEEDBACK` or any other external evidence gate.

External gate states remain:

- `LIVE-PROVIDER`: `Caveat`
- `WINDOWS-WSL`: `Caveat`
- `FEISHU-CALLBACK`: `Blocked`
- `FIRST-USER-FEEDBACK`: `Caveat`

## Verification

Verification completed:

```bash
node --test scripts/validate-trial-readiness.test.mjs scripts/validate-trial-feedback-intake.test.mjs
pnpm trial:readiness-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
pnpm trial:intake-validate
pnpm evidence:gates-validate
rg -n 'trial:readiness-validate|validate-trial-readiness|gateClearingEvidence|trial readiness' package.json docs scripts .github .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

## Next Work

Run a real first-user trial, complete and audit a feedback packet, then link it
through the validated feedback path for maintainer triage. Do not change the
external gate registry to `Pass` until the required artifact exists.
