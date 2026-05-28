# Phase 29 Context: Trial Materials Consistency Guard

## Purpose

Phase 29 closes a local v1.5 operations gap: `docs/TRIAL-CHECKLIST.md` is the
first-user trial entry point, but before this phase the machine-verified intake
contract covered only the GitHub issue form, Markdown feedback template, and
trial runbook.

The goal is to make the trial checklist part of the same validated intake
contract so audit commands, gate-routing commands, redaction language, and
browser-token red lines cannot drift before real first-user packet collection.

## Boundaries

- Extend the existing trial intake validator instead of adding a separate
  overlapping validator.
- Keep the validator structural and local-only.
- Do not collect feedback, export diagnostics, upload artifacts, or mutate
  `docs/EXTERNAL-EVIDENCE-GATES.md`.
- Do not move any external evidence gate to `Pass`.

## Expected Outputs

- `scripts/validate-trial-feedback-intake.mjs` checks `docs/TRIAL-CHECKLIST.md`
  by default.
- `scripts/validate-trial-feedback-intake.test.mjs` includes red/green coverage
  for checklist drift.
- root `pnpm trial:intake-validate` command
- CI runs the root intake validator and external gate validator commands
- trial docs reference the local validator as a materials-consistency guard
- Phase 29 planning/report updates
