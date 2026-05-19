# OpenForge CI/CD Plan

> Status: local-first beta release gates | Date: 2026-05-10

This plan defines the minimum checks for a local/self-hosted OpenForge release.
It is written so the same commands can run in CI or in a release engineer's
terminal.

## 1. Required Jobs

### Static And Unit Checks

```bash
pnpm install --frozen-lockfile
node --test scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
pnpm -r typecheck
pnpm -r test
RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts
pnpm --dir packages/gateway test test/model-provider-routes.test.ts test/model-provider-repository.test.ts test/model-config-apply.test.ts test/codex-provider-env.test.ts test/session-adapter-decoupling.test.ts
git diff --check
```

Acceptance:

- Script-level smoke harness tests pass.
- TypeScript emits no type errors.
- CLI, Gateway `node:test`, and Web Vitest suites pass.
- Real tmux integration tests pass when tmux is installed.
- Provider SSOT and Codex subscription-boundary regressions pass.
- `git diff --check` reports no whitespace errors.

### Build Checks

```bash
pnpm -r build
```

Acceptance:

- CLI, Gateway, and Web builds complete.
- Gateway compiles and copies database migrations into `dist`.
- Web Next.js build completes in an unrestricted runtime.

Known skip:

- In restricted execution sandboxes, Next/Turbopack may fail while creating a
  local worker socket or binding a loopback port with `EPERM`. Record the skip
  once with the exact error and keep Gateway build, typecheck, and unit tests
  as required evidence.

### NPM Package Checks

```bash
pnpm build:npm
pnpm pack:npm
node scripts/verify-npm-package.mjs
pnpm smoke:npm
```

Acceptance:

- `pnpm build:npm` creates the publishable CLI package artifacts from the
  current source tree.
- `pnpm pack:npm` completes the package dry-run and reports the files that
  would ship in the `openforge` npm package. Inspect this dry-run output before
  publishing and confirm it excludes local config, databases, logs, API keys,
  and internal development artifacts.
- `node scripts/verify-npm-package.mjs` confirms required Gateway, Web
  standalone, migration, runtime config, README, license, and localized README
  artifacts are present and no forbidden local state files are included.
- `pnpm smoke:npm` builds the npm package, packs a tarball into a temporary
  directory, installs that tarball with `npm --prefix` into a temporary prefix,
  sets `OPENFORGE_STATE_DIR` to temporary state, and runs `openforge doctor`
  from the installed package.

Known skip:

- `pnpm pack:npm` and `node scripts/verify-npm-package.mjs` are required even
  when smoke is skipped; they should not need registry access.
- In restricted CI, `npm install` of the tarball may fail if registry access is
  blocked while resolving package dependencies or native package downloads. If
  this happens, record the exact npm stdout/stderr and keep `pnpm build:npm`,
  `pnpm pack:npm`, and `node scripts/verify-npm-package.mjs` as required
  evidence.
- `openforge doctor` must fail when required dependencies such as `tmux` are not
  installed. Treat that as an environment failure, not a passing smoke.

### Codex Background Task Gates

The safe beta surface for Codex app-server is observable control plane only.

```bash
pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line
pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium --reporter=line
pnpm smoke:codex-app-server
```

Acceptance:

- The Playwright smoke proves the Web page renders safe status/activity
  metadata, hides prompt/turn/send controls, and does not request `/turn`.
- Core `mvp1-smoke` Playwright stays required in CI for the product
  control-plane happy path. Browser terminal `gate-d-smoke` remains
  environment-gated until the CI image supplies a real AI CLI.
- `pnpm smoke:codex-app-server` starts a real Codex app-server process, sends
  only initialize/initialized messages, reports `promptOrTurnSent: false`, and
  uses isolated temporary `HOME` and `CODEX_HOME`.
- Host Codex config/auth fingerprints should be checked for final acceptance
  when the real smoke is run manually.

Known skip:

- CI may not have Codex CLI installed. In that case, skip only the real
  `pnpm smoke:codex-app-server` process check, record the skip reason, and keep
  the Web zero-quota smoke required.
- Do not replace the real process check with mocked Playwright evidence; they
  prove different boundaries.

### E2E Smoke

E2E requires a real Gateway plus Web console on the configured ports:

```bash
export OPENFORGE_HOST=127.0.0.1
export OPENFORGE_PORT=48731
export OPENFORGE_WEB_PORT=48732
export OPENFORGE_GATEWAY_URL=http://127.0.0.1:48731
export NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
export OPENFORGE_DB_PATH=/tmp/openforge-ci.db
export OPENFORGE_MASTER_KEY=<64-hex-characters>
export OPENFORGE_JWT_SECRET=<32+-character-secret>

pnpm --filter @openforge/gateway dev > /tmp/openforge-gateway.log 2>&1 &
pnpm --filter @openforge/web exec playwright test e2e/gate-d-smoke.spec.ts e2e/mvp1-smoke.spec.ts
```

Acceptance:

- Registration and login work.
- Project create/import and config write work.
- Template, Agent, Skill, model, and API key management flows work.
- Terminal route can be opened with session credentials.

Known skip:

- Skip E2E only when CI cannot provide loopback listeners, tmux, or Claude Code
  CLI. Record which dependency is missing.

## 2. Security Gates

Block a release if any of these are true:

- `OPENFORGE_JWT_SECRET` or `OPENFORGE_MASTER_KEY` is hardcoded in source.
- API keys are logged or written to config files.
- Gateway accepts unauthenticated REST or WebSocket access for tenant data.
- Project path operations bypass `safeResolve` or accepted realpath checks.
- SQL is built by concatenating user input.
- Terminal WebSocket heartbeat, rate limiting, message-size checks, or
  ownership checks are removed.

Suggested review focus:

```bash
rg -n "OPENFORGE_JWT_SECRET=|OPENFORGE_MASTER_KEY=|sk-[A-Za-z0-9_-]+" --glob '!*.md' --glob '!.env*'
rg -n "innerHTML|dangerouslySetInnerHTML|exec\\(|spawn\\(|db\\.prepare\\(" packages
```

Review the matches manually. Some hits are expected in tests and command
construction, but secret values and unsanitized user input are not acceptable.

## 3. Release Gates

Gate 1 - Candidate readiness:

- Release branch is rebased or merged onto `master`.
- `docs/RELEASE-PLAN.md`, `docs/SMOKE-TEST.md`, and this plan are current.
- Migration impact is understood and database backup instructions are present.

Gate 2 - Automated verification:

- Static and unit checks pass.
- Gateway build passes.
- Web build passes or has a documented sandbox-only skip.
- CLI build passes.
- Script harness tests pass.
- Provider/Codex boundary regression passes.
- Codex app-server Web smoke passes.
- Real Codex app-server process smoke passes on a Codex-enabled host, or the
  candidate keeps the explicit environment caveat.
- NPM package checks pass or have a documented npm registry/native dependency
  skip with exact stdout/stderr.
- E2E smoke passes or has a documented environment skip.

Gate 3 - Manual acceptance:

- Manual smoke passes on the same ports and hostnames the user will access.
- A real Claude Code session receives terminal input and preserves state across
  refresh.
- Claude Code permission notification hook produces an OpenForge notification.
- Physical Windows/WSL trial evidence is recorded before removing the native
  Windows terminal caveat.
- Rollback steps have been rehearsed on a disposable database or are explicitly
  accepted as manual fallback.

## 4. Automation Matrix

| Gate | CI default | Manual release acceptance |
| --- | --- | --- |
| Workspace typecheck/test/build | Required | Re-run when cutting a candidate |
| Provider/Codex boundary regression | Required | Re-run if model/provider code changed |
| NPM build/verify/smoke | Required on Ubuntu CI with tmux | Re-run before publish or tag |
| Codex app-server Web smoke | Required with mocked Gateway APIs | Re-run if Web control-plane UI changed |
| Real Codex app-server initialize smoke | Conditional on `codex` CLI availability | Required before removing Codex process caveat |
| Browser terminal end-to-end smoke | Environment-gated | Required on release host |
| Real Claude Code permission prompt smoke | Environment-gated | Required when Claude behavior is in scope |
| Physical Windows/WSL terminal smoke | Not covered by Ubuntu CI | Required before removing Windows caveat |

## 5. Deployment Policy

Current MVP deployment is local process based. Do not add cloud deployment,
auto-update, hosted telemetry, or marketplace publishing without a separate
architecture review.
