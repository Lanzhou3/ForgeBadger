# Phase 30 Context: Trial Issue Route Preflight

## Purpose

Phase 30 closes a route-integrity gap in the v1.5 trial loop. Trial docs route
live provider evidence, physical Windows/WSL evidence, and first-user feedback
to GitHub issues #3, #4, and #5, but before this phase there was no repeatable
maintainer preflight for checking that those issues still exist, remain open,
and keep expected titles and labels.

The goal is to make the external follow-up issue routes auditable before a real
trial collection round starts, without creating or mutating GitHub issues and
without clearing any external evidence gate.

## Boundaries

- Validate issue route metadata only: issue number, title, state, labels, URL.
- Use GitHub CLI only for the live preflight command.
- Keep CI coverage local by testing the validator contract with mocked issue
  data.
- Do not create, update, close, label, or comment on GitHub issues.
- Do not collect first-user feedback, attach artifacts, or move external gates
  to `Pass`.

## Expected Outputs

- `scripts/validate-trial-issue-routes.mjs`
- `scripts/validate-trial-issue-routes.test.mjs`
- root `pnpm trial:issue-routes-validate` command
- CI script harness coverage for the mocked validator contract
- trial docs reference the maintainer preflight
- Phase 30 planning/report updates
