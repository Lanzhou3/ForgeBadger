# Phase 29 Trial Materials Consistency Guard

> Scope: v1.5 first-user trial intake material integrity.
> This prevents checklist drift; it does not clear external gates.

## Summary

Phase 29 extends the trial intake validator to cover the checklist:

```bash
pnpm trial:intake-validate
```

The validator now checks the GitHub feedback issue form, Markdown feedback
template, trial runbook, and trial checklist as one local intake contract.

## Implementation

| Area | Change |
|------|--------|
| Validator | `scripts/validate-trial-feedback-intake.mjs` now reads `docs/TRIAL-CHECKLIST.md` by default. |
| Tests | Added checklist drift coverage to `scripts/validate-trial-feedback-intake.test.mjs`. |
| Package script | Added `pnpm trial:intake-validate`. |
| CI | Added root validator command coverage for `pnpm trial:intake-validate` and `pnpm evidence:gates-validate`. |
| Docs | Trial runbook, checklist, feedback template, and CI plan name the validator as a materials-consistency guard. |

## Safety Boundary

`pnpm trial:intake-validate` is a local structural check. It does not:

- collect first-user feedback;
- export diagnostics;
- upload files;
- submit GitHub issues;
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
node scripts/validate-trial-feedback-intake.test.mjs
pnpm trial:intake-validate
pnpm evidence:gates-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'trial:intake-validate|REQUIRED_CHECKLIST_PHRASES|pnpm trial:feedback-audit|pnpm evidence:gates-validate|FIRST-USER-FEEDBACK' package.json docs scripts .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

## Next Work

Run a real first-user trial, complete and audit a feedback packet, then link it
through the validated feedback path for maintainer triage. Do not change the
external gate registry to `Pass` until the required artifact exists.
