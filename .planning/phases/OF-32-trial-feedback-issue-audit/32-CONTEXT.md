# Phase 32 Context: Trial Feedback Issue Audit

## Purpose

Phase 32 closes the gap between the preferred GitHub issue form and the local
Markdown packet audit. Before this phase, maintainers could audit a completed
Markdown packet with `pnpm trial:feedback-audit`, but feedback filed through the
GitHub issue form required manual copy/paste into a Markdown shape before the
same completeness and redaction checks could run.

The goal is to add a read-only GitHub issue audit command that fetches a filed
trial feedback issue, converts the issue-form body into the existing packet
shape, and reuses the same packet audit rules.

## Boundaries

- Read GitHub issue metadata and body only.
- Require the `trial-feedback` label for issue-form audit.
- Reuse `auditTrialFeedbackPacket` for completeness and secret-like content.
- Keep CI coverage mocked; CI must not depend on GitHub network/auth state.
- Do not comment on issues, mutate labels, attach artifacts, or close issues.
- Do not clear `FIRST-USER-FEEDBACK` or any other external evidence gate.

## Expected Outputs

- `scripts/audit-trial-feedback-issue.mjs`
- `scripts/audit-trial-feedback-issue.test.mjs`
- root `pnpm trial:feedback-issue-audit`
- CI script harness coverage for mocked issue audit behavior
- trial docs reference the GitHub issue audit path
- Phase 32 planning/report updates
