# Phase 35 Context: README Trial Entrypoint Guard

## Purpose

Phase 35 closes the outermost trial-entrypoint gap found after Phase 34. The
root `README.md` listed the trial runbook, checklist, troubleshooting, and
Markdown feedback template, but it did not expose the GitHub feedback issue
form that is now part of the first-user feedback collection path.

The goal is to make `pnpm trial:intake-validate` guard the repository README
and localized README trial sections so first users and maintainers can always
find both feedback collection paths from the public entrypoint.

## Boundaries

- Update README trial-entrypoint documentation only.
- Extend the existing trial intake validator rather than adding a new command.
- Keep `FIRST-USER-FEEDBACK` as `Caveat`.
- Do not collect, submit, attach, or mutate first-user feedback.
- Do not clear any external evidence gate.

## Expected Outputs

- `README.md` links the GitHub first-user feedback issue form.
- `scripts/validate-trial-feedback-intake.mjs` reads and validates the root and
  localized README trial entrypoints.
- `scripts/validate-trial-feedback-intake.test.mjs` rejects a README trial
  entrypoint missing the GitHub issue form.
- Phase 35 planning/report updates.
