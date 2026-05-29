# Source Env Override Preservation Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Added `scripts/run-with-root-env.mjs`, a root `.env` loader that preserves
  inherited command-prefix environment variables.
- Added `scripts/run-with-root-env.test.mjs` and wired it into CI script
  harness tests.
- Updated Gateway/Web source package scripts to load root `.env` through the
  preserving runner.
- Updated smoke harness command planning so Web source startup uses
  `pnpm --dir packages/web dev`.
- Updated source fallback runbook, smoke test docs, troubleshooting, and CI/CD
  plan.
- Verified Gateway and Web command-prefix overrides with real temporary dev
  servers.

## Gate State

No external gate moved to `Pass`.

| Gate | State |
|------|-------|
| `LIVE-PROVIDER` | Caveat |
| `WINDOWS-WSL` | Caveat |
| `FEISHU-CALLBACK` | Blocked |
| `FIRST-USER-FEEDBACK` | Caveat |

## Verification

Commands run:

```bash
node --test scripts/run-with-root-env.test.mjs
node --test scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
OPENFORGE_DB_PATH=/tmp/openforge-env-preserve.sqlite pnpm --dir packages/gateway dev
curl --noproxy '*' -fsS http://127.0.0.1:48731/api/v1/health
ls -l /tmp/openforge-env-preserve.sqlite
OPENFORGE_WEB_PORT=48733 NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731 pnpm --dir packages/web dev
curl --noproxy '*' -I http://127.0.0.1:48733/login
pnpm --dir packages/gateway run typecheck
pnpm --dir packages/web run typecheck
pnpm --dir packages/gateway run build
pnpm --dir packages/web run build
rg -n "set -a; \\[ -f ../../\\.env \\] && \\. ../../\\.env" packages
rg --hidden --no-ignore -n "run-with-root-env|ENVRUN|ENVSAFE|PLAN-23|Phase 23|source-env-runner|phase-23-source-env-runner" .planning docs MEMORY.md .github packages scripts
git diff --check
```

Results:

- Red test failed before implementation with `ERR_MODULE_NOT_FOUND` for
  `scripts/run-with-root-env.mjs`.
- Script harness tests passed: 3 files, 3 pass.
- Gateway prefix smoke returned `{"code":0,"data":{"status":"ok"},"message":""}`
  and created `/tmp/openforge-env-preserve.sqlite`.
- Web prefix smoke started on `http://127.0.0.1:48733` and `/login` returned
  HTTP 200.
- Temporary Gateway/Web processes were stopped and the temporary Gateway DB was
  removed.
- Gateway and Web typechecks exited 0.
- Gateway build exited 0.
- Web build failed in the sandbox with the known Turbopack
  `binding to a port` `EPERM` limitation, then passed when rerun outside the
  sandbox.
- Old shell `.env` sourcing snippet scan returned no matches.
- Phase 23 references, requirement IDs, and report allowlist were found in the
  active planning docs, `MEMORY.md`, `docs`, `.github`, package scripts, and
  scripts.
- `git diff --check` exited 0.

## Next Work

Collect a real first-user packet through the updated trial feedback template or
GitHub issue form. Phase 23 closes the source fallback env-override support
gap; it does not satisfy `FIRST-USER-FEEDBACK`.
