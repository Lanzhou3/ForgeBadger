# Phase 36 Copilot Evidence Packet Audit Guard

> Scope: v1.5 completed-feedback evidence quality.
> This strengthens packet triage readiness; it does not collect first-user
> evidence or clear external gates.

## Summary

Phase 36 tightens the first-user feedback audit path so a completed-looking
Markdown packet or GitHub issue-form body cannot enter maintainer triage while
omitting required Copilot evidence.

Required Copilot evidence now includes:

- provider smoke result;
- active provider/model state;
- prompt used;
- read-tool evidence observed;
- pending-action approve/reject result;
- memory-write proposal result;
- confirmation that Copilot did not send terminal, shell, or Codex turn input.

## Implementation

| Area | Change |
|------|--------|
| Packet audit | `scripts/audit-trial-feedback-packet.mjs` requires the Copilot evidence field set. |
| Issue audit | `scripts/audit-trial-feedback-issue.mjs` maps additional issue-form Copilot fields into packet audit input. |
| Parser correctness | Blank field values no longer capture the next line as their value. |
| Intake validation | `scripts/validate-trial-feedback-intake.mjs` guards Copilot evidence prompts in Markdown and GitHub issue-form intake paths. |
| Draft helper | `scripts/create-trial-feedback-draft.mjs` includes the Copilot memory-write prompt required by audit. |
| Tests | Focused tests reject missing Copilot evidence in Markdown packets, issue bodies, intake prompts, and drafts. |

## Safety Boundary

The change is validation only. It does not:

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
node --test scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs
pnpm trial:intake-validate
pnpm trial:readiness-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'Copilot prompt used|Copilot read-tool evidence observed|Copilot memory write proposal tested|Confirmed no terminal/shell/Codex turn input in Copilot|FIRST-USER-FEEDBACK|phase-36' scripts docs .github .planning MEMORY.md
git diff --check
```

## Next Work

Collect a real first-user feedback packet or filed issue-form feedback artifact.
Run the relevant audit command before maintainer triage. Keep
`FIRST-USER-FEEDBACK` as `Caveat` until a reviewed artifact satisfies the
external gate clearing condition.
