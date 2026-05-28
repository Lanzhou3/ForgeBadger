# Phase 23 Context: Source Env Override Preservation

## Purpose

Phase 23 closes the support gap found in Phase 22: source fallback dev scripts
loaded repository root `.env` by sourcing it inside npm scripts, which meant a
command-prefix environment variable such as `OPENFORGE_DB_PATH=/tmp/...` could
be overwritten by `.env`.

The goal is to keep source fallback easy for operators while preserving the
normal root `.env` workflow.

## Root Cause

`packages/gateway/package.json` and `packages/web/package.json` used shell
snippets like:

```bash
set -a; [ -f ../../.env ] && . ../../.env; set +a; ...
```

POSIX shell sourcing assigns variables directly into the current shell. When
the same variable is already present in the inherited environment, the sourced
`.env` assignment replaces it. That violates the operator expectation that a
command-prefix override wins for one run.

## Boundaries

- Preserve root `.env` loading for source fallback.
- Preserve command-prefix environment variables over `.env`.
- Do not expose `.env` contents, database contents, secrets, JWTs, provider
  payloads, or raw terminal output.
- Do not change npm/CLI package runtime state semantics.
- Do not reclassify any external evidence gate.

## Expected Outputs

- `scripts/run-with-root-env.mjs`
- `scripts/run-with-root-env.test.mjs`
- Gateway/Web package script updates.
- CI script harness coverage for the new runner.
- Source fallback docs updated to use package scripts consistently.
- `docs/reports/phase-23-source-env-runner-2026-05-29.md`
