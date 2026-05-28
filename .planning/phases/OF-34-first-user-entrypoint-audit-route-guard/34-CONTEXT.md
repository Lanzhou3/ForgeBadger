# Phase 34 Context: First-User Entrypoint Audit Route Guard

## Purpose

Phase 34 closes a documentation-entrypoint gap after the feedback audit tooling
was added. The trial runbook, checklist, and canonical gate registry named both
feedback audit commands, but the broader first-user/support entrypoints could
still point maintainers to feedback collection without reminding them to run
the packet or issue audit before triage.

The goal is to make the intake validator preserve the audit-route language in
`docs/OPEN-SOURCE-READINESS.md` and `docs/SUPPORT-DIAGNOSTICS.md`.

## Boundaries

- Update first-user/support entrypoint documentation only.
- Extend the existing trial intake validator rather than adding a new command.
- Keep `FIRST-USER-FEEDBACK` as `Caveat`.
- Do not collect, submit, attach, or mutate first-user feedback.
- Do not clear any external evidence gate.

## Expected Outputs

- `scripts/validate-trial-feedback-intake.mjs` reads and validates the two
  entrypoint docs.
- `scripts/validate-trial-feedback-intake.test.mjs` rejects missing audit-route
  language in those docs.
- `docs/OPEN-SOURCE-READINESS.md` and `docs/SUPPORT-DIAGNOSTICS.md` name both
  feedback audit commands.
- Phase 34 planning/report updates.
