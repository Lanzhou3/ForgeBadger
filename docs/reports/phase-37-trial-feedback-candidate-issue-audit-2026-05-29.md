# Phase 37 Trial Feedback Candidate Issue Audit

> Scope: v1.5 first-user feedback issue discovery and maintainer triage support.
> This is a read-only candidate audit; it does not collect feedback or clear
> external gates.

## Summary

Phase 37 adds a batch GitHub issue candidate audit for real first-user
collection rounds. Maintainers can now run:

```bash
pnpm trial:feedback-issues-audit
```

The command lists GitHub issues labeled `trial-feedback`, skips known route
tracker issues, audits non-tracker candidates through the existing
`pnpm trial:feedback-issue-audit -- --issue=<number>` path, and reports:

- tracker issue numbers;
- candidate issue numbers;
- ready issue numbers;
- blocked issue numbers;
- per-candidate audit errors.

## Safety Boundary

The command is read-only. It does not:

- create or edit GitHub issues;
- comment on issues;
- attach artifacts;
- collect first-user feedback;
- change labels or issue states;
- clear `FIRST-USER-FEEDBACK` or any other external evidence gate.

## Current Live Result

Current GitHub `trial-feedback` issue scan found only known route trackers:

- issue #5: `Collect first-user Copilot hardening feedback`
- issue #4: `Run physical Windows and WSL OpenForge smoke`

No completed non-tracker feedback candidate issue exists yet. The next required
artifact remains a real completed first-user feedback packet or issue-form
feedback item.

## Gate State

External gate states remain:

- `LIVE-PROVIDER`: `Caveat`
- `WINDOWS-WSL`: `Caveat`
- `FEISHU-CALLBACK`: `Blocked`
- `FIRST-USER-FEEDBACK`: `Caveat`

## Verification

Verification completed:

```bash
node --test scripts/audit-trial-feedback-issues.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/validate-external-evidence-gates.test.mjs
pnpm trial:intake-validate
pnpm evidence:gates-validate
pnpm trial:feedback-issues-audit
pnpm trial:readiness-validate
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/audit-trial-feedback-issues.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'trial:feedback-issues-audit|candidate issue|FIRST-USER-FEEDBACK|phase-37' package.json scripts docs .planning MEMORY.md
git diff --check
```

## Next Work

Run the real first-user trial loop and collect a completed, redacted feedback
artifact. Use the batch candidate audit or targeted issue audit before
maintainer triage. Keep `FIRST-USER-FEEDBACK` as `Caveat` until a reviewed
artifact satisfies the external gate clearing condition.
