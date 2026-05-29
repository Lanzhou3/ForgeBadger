# Phase 28 External Evidence Gate Drift Guard

> Scope: v1.5 external evidence registry integrity.
> This prevents accidental gate-state drift; it does not clear external gates.

## Summary

Phase 28 adds a local registry validator:

```bash
pnpm evidence:gates-validate
```

The validator checks that the external gate registry still contains the four
required gates, their current truthful states, and the rerun/target anchors
needed to collect real evidence.

## Implementation

| Area | Change |
|------|--------|
| Validator | Added `scripts/validate-external-evidence-gates.mjs`. |
| Tests | Added `scripts/validate-external-evidence-gates.test.mjs`. |
| Package script | Added `pnpm evidence:gates-validate`. |
| CI | Added the validator test to script harness tests. |
| Registry | Updated rerun paths to name `pnpm smoke:copilot-provider` and `pnpm trial:feedback-audit`. |

## Safety Boundary

The validator intentionally preserves the current external gate states:

- `LIVE-PROVIDER`: `Caveat`
- `WINDOWS-WSL`: `Caveat`
- `FEISHU-CALLBACK`: `Blocked`
- `FIRST-USER-FEEDBACK`: `Caveat`

If a maintainer later collects a required artifact and wants to move a gate to
`Pass`, they must update both the registry and this validator in the same
reviewable change, with the artifact linked.

## Verification

Verification completed:

```bash
node --test scripts/validate-external-evidence-gates.test.mjs
pnpm evidence:gates-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'evidence:gates-validate|validate-external-evidence-gates|pnpm trial:feedback-audit|pnpm smoke:copilot-provider|FIRST-USER-FEEDBACK' package.json docs scripts .github .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

## Next Work

Run a real first-user trial, complete and audit a feedback packet, then link it
through the validated feedback path for maintainer triage. Do not change the
external gate registry to `Pass` until the required artifact exists.
