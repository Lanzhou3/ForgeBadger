# Phase 37 Context: Trial Feedback Candidate Issue Audit

## Purpose

Phase 37 closes the operator gap after the single GitHub issue-form audit was
added. Maintainers could audit a known issue number, but a real collection
round still required manually discovering which `trial-feedback` issues were
actual completed feedback and which were routing trackers.

The goal is to add a read-only batch candidate audit that lists GitHub
`trial-feedback` issues, skips known route trackers, audits non-tracker
candidates through the existing single-issue audit path, and reports ready
versus blocked candidate issues before maintainer triage.

## Boundaries

- Do not create, update, comment on, close, label, or submit GitHub issues.
- Do not collect first-user feedback.
- Do not mark `FIRST-USER-FEEDBACK` or any other external gate as `Pass`.
- Keep the command as maintainer triage support only.

## Expected Outputs

- `pnpm trial:feedback-issues-audit` lists `trial-feedback` issues through
  GitHub CLI.
- The command skips known route tracker issues #4 and #5.
- Non-tracker candidates are audited with
  `pnpm trial:feedback-issue-audit` semantics.
- Trial docs and gate registry mention the bulk candidate audit path.
- Intake and external-gate validators protect the new command reference.
