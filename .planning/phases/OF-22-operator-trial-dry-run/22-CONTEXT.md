# Phase 22 Context: Operator Trial Dry Run

## Purpose

Phase 22 validates the v1.5 first-user trial operations loop from the
maintainer/operator side before asking a real first user to file feedback. It
uses the current host to dry-run dependency collection, startup health checks,
provider gate handling, redaction boundaries, and feedback packet wording.

This is not first-user evidence. It cannot clear `FIRST-USER-FEEDBACK`,
`WINDOWS-WSL`, `LIVE-PROVIDER`, or `FEISHU-CALLBACK` unless the clearing
conditions in `docs/EXTERNAL-EVIDENCE-GATES.md` are independently satisfied.

## Inputs

- `docs/TRIAL-CHECKLIST.md`
- `docs/TRIAL-FEEDBACK.md`
- `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`
- `docs/EXTERNAL-EVIDENCE-GATES.md`
- `.planning/phases/OF-21-first-user-trial-operations/21-01-SUMMARY.md`
- package scripts in root, `packages/gateway`, `packages/web`, and
  `packages/cli`

## Boundaries

- Do not paste or persist raw provider keys, JWTs, Feishu secrets, local
  databases, `.env` contents, raw terminal transcripts, provider payloads, or
  callback bodies.
- Record only bounded environment metadata, command names, statuses, and
  sanitized findings.
- Preserve all external gate states unless a real required artifact exists.
- Keep runtime scope unchanged: no hosted collaboration, no remote execution,
  no Feishu execution authority, and no Codex Web turn workflow.

## Dry-Run Finding To Carry Forward

The source dev scripts load the repository root `.env` inside the npm script.
When an operator prefixes `pnpm --dir packages/gateway dev` with
`OPENFORGE_DB_PATH=...`, the script still sources `.env` afterwards and can
override the prefix value. Operators who need an isolated source dry-run state
should either adjust `.env` deliberately or use a direct command path that does
not source `.env` after the override.

## Expected Outputs

- `.planning/phases/OF-22-operator-trial-dry-run/22-01-PLAN.md`
- `.planning/phases/OF-22-operator-trial-dry-run/22-01-SUMMARY.md`
- `docs/reports/phase-22-operator-trial-dry-run-2026-05-29.md`
- updated active planning docs showing Phase 22 completed as an operator
  dry-run, with first-user collection still pending.
