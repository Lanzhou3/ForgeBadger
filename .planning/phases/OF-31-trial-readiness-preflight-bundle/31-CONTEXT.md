# Phase 31 Context: Trial Readiness Preflight Bundle

## Purpose

Phase 31 reduces operator error before a real first-user trial collection
round. By Phase 30, OpenForge had separate validators for trial intake
materials, GitHub issue routes, and the external evidence gate registry. A
maintainer still had to remember which commands to run and how to interpret the
combined result.

The goal is to provide one read-only readiness command that runs the existing
preflights together, reports a single result, and keeps all external gates
unchanged until real artifacts exist.

## Boundaries

- Aggregate existing validators only.
- Preserve the live GitHub issue route check as read-only.
- Keep CI coverage mocked; CI must not depend on GitHub network/auth state.
- Do not generate or submit first-user feedback.
- Do not create, update, close, label, or comment on GitHub issues.
- Do not move external evidence gates to `Pass`.

## Expected Outputs

- `scripts/validate-trial-readiness.mjs`
- `scripts/validate-trial-readiness.test.mjs`
- root `pnpm trial:readiness-validate` command
- CI script harness coverage for mocked readiness behavior
- trial docs reference the maintainer readiness preflight
- Phase 31 planning/report updates
