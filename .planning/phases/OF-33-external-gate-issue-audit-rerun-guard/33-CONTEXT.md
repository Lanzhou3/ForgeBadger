# Phase 33 Context: External Gate Issue Audit Rerun Guard

## Purpose

Phase 33 closes a consistency gap left after Phase 32. The GitHub issue-form
feedback audit exists, but the canonical external evidence gate registry still
named only the Markdown packet audit in the `FIRST-USER-FEEDBACK` rerun path.

The goal is to make `pnpm evidence:gates-validate` preserve both first-user
feedback audit routes: Markdown packets and GitHub issue-form feedback.

## Boundaries

- Update only the external gate registry and its drift guard.
- Keep `FIRST-USER-FEEDBACK` as `Caveat`.
- Do not collect, submit, attach, or mutate first-user feedback.
- Do not treat a passing issue audit as automatic gate clearance.
- Keep the change covered by local tests and validators.

## Expected Outputs

- `docs/EXTERNAL-EVIDENCE-GATES.md` names the issue audit command in the
  `FIRST-USER-FEEDBACK` rerun path.
- `scripts/validate-external-evidence-gates.mjs` requires
  `pnpm trial:feedback-issue-audit`.
- `scripts/validate-external-evidence-gates.test.mjs` fails if that command is
  removed from the protected rerun path.
- Phase 33 planning/report updates.
