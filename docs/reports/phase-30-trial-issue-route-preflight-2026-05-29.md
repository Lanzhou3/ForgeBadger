# Phase 30 Trial Issue Route Preflight

> Scope: v1.5 first-user trial follow-up route integrity.
> This verifies issue routes; it does not clear external gates.

## Summary

Phase 30 adds a maintainer-run GitHub issue route preflight:

```bash
pnpm trial:issue-routes-validate
```

The command checks that the existing follow-up issues used by the trial loop
remain readable, open, and matched to their expected titles and labels.

## Implementation

| Area | Change |
|------|--------|
| Validator | Added `scripts/validate-trial-issue-routes.mjs`. |
| Tests | Added `scripts/validate-trial-issue-routes.test.mjs`. |
| Package script | Added `pnpm trial:issue-routes-validate`. |
| CI | Added mocked route-contract test to script harness coverage. |
| Docs | Trial runbook, checklist, feedback template, and CI plan name the issue route preflight. |
| Intake guard | `pnpm trial:intake-validate` now preserves the route preflight command in the checklist. |

## Live Preflight Result

The live command verified:

| Issue | Gate | State | URL |
|-------|------|-------|-----|
| #3 | `LIVE-PROVIDER` | OPEN | `https://github.com/Lanzhou3/OpenForge/issues/3` |
| #4 | `WINDOWS-WSL` | OPEN | `https://github.com/Lanzhou3/OpenForge/issues/4` |
| #5 | `FIRST-USER-FEEDBACK` | OPEN | `https://github.com/Lanzhou3/OpenForge/issues/5` |

The command returned `gateClearingEvidence: false`.

## Safety Boundary

`pnpm trial:issue-routes-validate` is read-only. It does not:

- create, update, close, label, or comment on GitHub issues;
- collect first-user feedback;
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
node --test scripts/validate-trial-issue-routes.test.mjs
node --test scripts/validate-trial-feedback-intake.test.mjs
pnpm trial:issue-routes-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
pnpm trial:intake-validate
pnpm evidence:gates-validate
rg -n 'trial:issue-routes-validate|validate-trial-issue-routes|gateClearingEvidence|issue #3|issue #4|issue #5' package.json docs scripts .github .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

## Next Work

Run a real first-user trial, complete and audit a feedback packet, then link it
through the validated feedback path for maintainer triage. Do not change the
external gate registry to `Pass` until the required artifact exists.
