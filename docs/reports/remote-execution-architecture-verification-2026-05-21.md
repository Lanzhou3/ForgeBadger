---
phase: OF-05-remote-execution-architecture
verified: 2026-05-20T18:18:55Z
status: caveated-pass
requirements_verified:
  - REM-01
  - REM-02
  - COD-01
automated_checks:
  - command: "git diff --check"
    result: "PASS"
  - command: "runtime scope scan"
    result: "PASS: no runtime addition"
  - command: "hosted/cloud scope scan"
    result: "PASS: matches classified as deferred/boundary text or expected current code"
  - command: "Codex boundary scan"
    result: "PASS: existing /turn surface remains default-disabled; Web smoke confirms no prompt/turn controls"
  - command: "pnpm --dir packages/gateway test test/diagnostics.test.ts test/safe-resolve.test.ts"
    result: "PASS: 2 tests passed"
  - command: "pnpm --dir packages/gateway test test/codex-app-server-routes.test.ts test/terminal-ws.test.ts"
    result: "CAVEAT: Node/runtime assertion under Node v24.14.1"
  - command: "pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line"
    result: "PASS after rerun with approved loopback/server binding"
gaps: []
notes:
  - "Phase 5 intentionally produced docs/spec/report artifacts only."
  - "Node/runtime caveat is recorded honestly and not converted into a pass."
  - "sandbox loopback caveat was resolved by rerunning Playwright with approved local server binding."
---

# Remote Execution Architecture Verification

## Goal Achievement

Phase 5 produced the remote-execution architecture package required before
runtime implementation. The existing SSH design seed remains the primary source
and now links to the threat model, rollback plan, and this verification report.

Outcome: `PASS` with explicit runtime/environment caveats.

No runtime code changes were introduced by this docs-only phase.

## Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| REM-01 | PASS | `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` now contains `## Phase 5 Architecture Package`; `docs/superpowers/specs/2026-05-21-remote-execution-threat-model.md` contains REM-T01 through REM-T10, stable failure codes, trust boundaries, required controls, verification map, and release blockers; `docs/superpowers/specs/2026-05-21-remote-execution-rollback-plan.md` defines local-safe disablement and rollback. |
| REM-02 | PASS | Hosted collaboration, cloud deployment, billing, telemetry, marketplace, and cloud worker matches are classified as deferred/boundary text or expected current code, not new local-first runtime commitments. |
| COD-01 | PASS with CAVEAT | Codex boundary scan shows the existing `/turn` route remains feature-flag/default-disabled; Web Playwright smoke passed after approved loopback rerun and asserted no prompt/turn/send controls and no `/turn` request. Backend Codex route/terminal WS focused command hit the Node/runtime caveat below. |

## Artifact Verification

| Artifact | Status | Evidence |
|----------|--------|----------|
| `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` | PASS | Contains `## Phase 5 Architecture Package` and links `2026-05-21-remote-execution-threat-model.md`, `2026-05-21-remote-execution-rollback-plan.md`, and `remote-execution-architecture-verification-2026-05-21.md`. |
| `docs/superpowers/specs/2026-05-21-remote-execution-threat-model.md` | PASS | Contains `Context`, `System Model`, `Trust Boundaries`, `Assets`, `STRIDE Threat Register`, `Required Controls`, `Verification Map`, `Release Blockers`, and `Out Of Scope`; includes REM-T01 through REM-T10. |
| `docs/superpowers/specs/2026-05-21-remote-execution-rollback-plan.md` | PASS | Contains all required rollback sections, `OPENFORGE_REMOTE_EXECUTION_ENABLED=false`, `nullable`, `default-local`, `remote target records can be ignored`, and `Codex /turn remains disabled`. |
| `docs/reports/remote-execution-architecture-verification-2026-05-21.md` | PASS | This report records command evidence, caveats, static-scan interpretation, and no-runtime-code evidence. |

## Static Scope Checks

### Command Results Matrix

| Command | Result | Runtime Context | Classification | Next Verification Action |
|---------|--------|-----------------|----------------|--------------------------|
| `git diff --check` | PASS | Repo root, after Task 1/2 commits | whitespace clean | Re-run after report/SUMMARY commits. |
| `rg -n "/api/v1/execution-targets|executionTargetId|SshAgentTerminalTransport|remote_agent|StrictHostKeyChecking=no|UserKnownHostsFile=/dev/null" packages/gateway/src packages/web/src` | PASS: no matches, `rg` exit 1 due zero results | Runtime source only | runtime scope scan, no runtime addition | Keep as release guard for later remote implementation phase. |
| `rg -n "cloud deployment|hosted telemetry|billing|marketplace|cloud worker" docs packages -g '!node_modules'` | PASS: matches found and classified | Docs plus package source/tests | hosted/cloud scope scan; deferred/boundary text or expected current code; no scope leak | Re-run after future roadmap/docs edits. |
| `rg -n "OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1|/turn|promptInputExposed: true|send prompt|turn input" docs packages -g '!node_modules'` | PASS: matches found and classified | Docs plus existing Codex app-server route/client/test surfaces | Codex boundary scan; existing guarded prototype and disabled Web controls; no new scope leak | Re-run before any Web prompt/turn feature is proposed. |
| `pnpm --dir packages/gateway test test/diagnostics.test.ts test/safe-resolve.test.ts` | PASS: 2 tests, 2 pass, 0 fail | Node v24.14.1 local runtime | focused diagnostics/path safety evidence | Keep in CI/release evidence. |
| `pnpm --dir packages/gateway test test/codex-app-server-routes.test.ts test/terminal-ws.test.ts` | CAVEAT: both file-level tests failed from Node native assertion; no product assertion was reached | Node v24.14.1 local runtime | Node/runtime caveat | Rerun under project-supported CI Node/runtime before treating as product failure. |
| `pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line` | CAVEAT then PASS: sandbox run failed to start webServer; approved loopback/server rerun passed 1 Chromium test | Restricted sandbox first, approved local server binding second | sandbox loopback caveat resolved by rerun | Keep local server binding available for future Playwright smoke. |

Hosted/cloud scan interpretation:

- New Phase 5 docs mention cloud deployment, billing, telemetry, marketplace,
  and cloud workers only as out-of-scope or deferred/boundary text.
- Existing package matches are expected current code: usage UI labels estimated
  local cost as not provider billing, and template/skill strings mention plugin
  marketplaces without enabling hosted marketplace operations.
- No `scope leak` was found in runtime source.

Codex boundary scan interpretation:

- Existing Gateway `/turn` route is a guarded prototype and returns disabled by
  default unless `OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1` is set.
- Existing Web API client code contains a `/turn` helper, but the Web smoke
  confirms the page exposes no prompt/turn/send controls and sends no `/turn`
  request.
- New Phase 5 docs only describe the boundary and do not enable Web prompt/turn
  UI or remote Codex app-server control-plane support.

## Focused Test Evidence

| Command | Result | Notes |
|---------|--------|-------|
| `pnpm --dir packages/gateway test test/diagnostics.test.ts test/safe-resolve.test.ts` | PASS | Output: `tests 2`, `pass 2`, `fail 0`; diagnostics redaction and safe path tests passed. |
| `pnpm --dir packages/gateway test test/codex-app-server-routes.test.ts test/terminal-ws.test.ts` | CAVEAT | Output included `Assertion failed: (env_->execution_async_id()) == (0)` from Node v24.14.1 and reported both file-level tests failed before business assertions. This is the Node/runtime caveat. |
| `pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line` | CAVEAT then PASS | Initial sandbox run failed with `Error: Process from config.webServer was not able to start. Exit code: 1`. Rerun with approved loopback/server binding passed: `1 passed (8.6s)`. This is the sandbox loopback caveat. |

## Manual Interpretation

The static scans intentionally classify matches instead of requiring zero
matches because existing docs and code already describe deferred cloud scope,
local cost estimates, template marketplaces, and the default-disabled Codex
`/turn` prototype. None of the matches introduced a runtime remote route,
terminal transport, Web prompt/turn control, cloud deployment path, hosted
telemetry path, billing implementation, hosted marketplace, or cloud worker.

`FAIL` status is not used for final Phase 5 acceptance. The only failing command
is recorded as a `CAVEAT` because the observed failure is the known local
Node/runtime native assertion rather than a failed product assertion.

## No Runtime Code Evidence

No runtime code changes were introduced by this docs-only phase.

The scope guard passed:

```bash
sh -lc 'bad=$(git status --porcelain --untracked-files=all -- packages/gateway/src packages/web/src packages/gateway/src/db packages/web/src/app package.json package-lock.json pnpm-lock.yaml npm-shrinkwrap.json yarn.lock packages/gateway/package.json packages/web/package.json); test -z "$bad" || { printf "%s\n" "$bad"; exit 1; }'
```

Confirmed unchanged for Phase 5 execution:

- runtime code under `packages/gateway/src`
- runtime code under `packages/web/src`
- database migrations under `packages/gateway/src/db`
- Gateway routes
- Web UI/app routes
- terminal transports
- Codex app-server runtime behavior
- package manifests
- lockfiles

The only persistent unrelated untracked workspace item is `upload_img/`; it was
not touched by Phase 5.

## Caveats

### Node/runtime caveat

`pnpm --dir packages/gateway test test/codex-app-server-routes.test.ts test/terminal-ws.test.ts`
failed under the local Node v24.14.1 runtime with a native assertion:

```text
Assertion failed: (env_->execution_async_id()) == (0)
```

This report does not count that command as pass. Next verification action:
rerun the command under the supported CI/runtime before treating it as a
product regression or removing the caveat.

### sandbox loopback caveat

The first Playwright run could not start `config.webServer` inside the
restricted sandbox. Rerunning the same command with approved local
loopback/server binding passed one Chromium test. The final Codex Web smoke
evidence is therefore passing, while the initial environment limitation remains
recorded.

## Gaps Summary

No blocking Phase 5 gaps remain.

Remote execution implementation remains intentionally deferred to a later phase.
Before runtime work begins, the next phase must keep these release blockers:
host-key fail-closed behavior, ssh-agent/key-path credential boundary, no raw
SSH tmux wrappers, typed remote-agent operations, remote allowed-root realpath
checks, tenant-scoped target/session ownership, bounded diagnostics, local-safe
rollback, and Codex `/turn` disabled-by-default behavior.
