# Phase 23 Source Env Runner

> Scope: v1.5 source fallback startup support fix.
> This closes the Phase 22 `.env` override support gap, but it is not first-user
> feedback and does not clear external gates.

## Summary

Phase 23 fixes source fallback startup so repository root `.env` is still
loaded, but command-prefix environment variables win for a single run. This
lets operators isolate trial state with commands such as
`OPENFORGE_DB_PATH=/tmp/openforge-trial/openforge.db pnpm --dir packages/gateway dev`
without editing `.env`.

## Root Cause

Gateway/Web package scripts previously sourced root `.env` inside the shell:

```bash
set -a; [ -f ../../.env ] && . ../../.env; set +a; ...
```

Sourcing assigns variables directly in the current shell. If `OPENFORGE_DB_PATH`
or `OPENFORGE_WEB_PORT` was already set by a command prefix, the sourced `.env`
assignment replaced it.

## Implementation

| Area | Change |
|------|--------|
| Env runner | Added `scripts/run-with-root-env.mjs`, using `node:util.parseEnv` and merging `.env` behind inherited env. |
| Gateway scripts | `dev` and `start` now run through `run-with-root-env`. |
| Web scripts | `build`, `dev`, and `start` now run through `run-with-root-env`; Web dev/start use `--shell` so port defaults still expand after env loading. |
| CI | Script harness tests now include `scripts/run-with-root-env.test.mjs`. |
| Smoke plan | `scripts/smoke-local-release.mjs` now points Web startup at `pnpm --dir packages/web dev`. |
| Docs | Source fallback runbook, smoke docs, troubleshooting, and CI/CD plan now describe the env-preserving behavior. |

## Verification

### Red Test

Command:

```bash
node --test scripts/run-with-root-env.test.mjs
```

Initial result before implementation:

- failed with `ERR_MODULE_NOT_FOUND` for `scripts/run-with-root-env.mjs`.

### Script Harness

Command:

```bash
node --test scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
```

Result:

- 3 files passed;
- 3 tests passed;
- 0 failures.

### Gateway Prefix Smoke

Command shape:

```bash
OPENFORGE_DB_PATH=/tmp/openforge-env-preserve.sqlite pnpm --dir packages/gateway dev
```

Evidence:

- Gateway started on `127.0.0.1:48731`.
- `GET /api/v1/health` returned
  `{"code":0,"data":{"status":"ok"},"message":""}`.
- `/tmp/openforge-env-preserve.sqlite` was created.
- Gateway was stopped and the temporary database files were removed.

### Web Prefix Smoke

Command shape:

```bash
OPENFORGE_WEB_PORT=48733 NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731 pnpm --dir packages/web dev
```

Evidence:

- Next.js reported `http://127.0.0.1:48733`.
- `HEAD /login` returned HTTP 200 with `text/html; charset=utf-8`.
- Web dev process was stopped and port `48733` stopped responding.

### Final Checks

Commands:

```bash
pnpm --dir packages/gateway run typecheck
pnpm --dir packages/web run typecheck
pnpm --dir packages/gateway run build
pnpm --dir packages/web run build
rg -n "set -a; \\[ -f ../../\\.env \\] && \\. ../../\\.env" packages
rg --hidden --no-ignore -n "run-with-root-env|ENVRUN|ENVSAFE|PLAN-23|Phase 23|source-env-runner|phase-23-source-env-runner" .planning docs MEMORY.md .github packages scripts
git diff --check
```

Results:

- Gateway typecheck exited 0.
- Web typecheck exited 0.
- Gateway build exited 0.
- Web build failed in the sandbox with the known Turbopack
  `binding to a port` `EPERM` limitation, then passed outside the sandbox.
- Old shell `.env` sourcing snippet scan returned no matches.
- Phase 23 references and requirement IDs were present in active planning,
  docs, package scripts, CI, and helper scripts.
- `git diff --check` exited 0.

## Gate State

No external evidence gate moved to `Pass`.

| Gate | State After Phase 23 | Reason |
|------|----------------------|--------|
| `LIVE-PROVIDER` | Caveat | No disposable live provider credential/model pass was collected. |
| `WINDOWS-WSL` | Caveat | Current host is Linux `not_wsl`; no physical Windows/WSL terminal run occurred. |
| `FEISHU-CALLBACK` | Blocked | No public HTTPS Gateway route or Feishu developer-console URL verification occurred. |
| `FIRST-USER-FEEDBACK` | Caveat | This is an operator support fix, not a completed first-user packet. |

## Secret Safety

The evidence records command shapes, paths to disposable temporary files, status
codes, and bounded health results only. It does not include `.env` contents,
provider keys, JWTs, attach tokens, private keys, local database contents, raw
terminal transcripts, provider payloads, Feishu bodies, callback signatures, or
browser auth token values.

## Next Work

Collect a real first-user trial packet through `docs/TRIAL-FEEDBACK.md` or the
`OpenForge first-user trial feedback` GitHub issue form. Keep all external
gates caveated or blocked until the required real artifacts in
`docs/EXTERNAL-EVIDENCE-GATES.md` exist.
