# OpenForge CI/CD Plan

> Status: MVP-6 release readiness | Date: 2026-05-02

This plan defines the minimum checks for a local/self-hosted OpenForge release.
It is written so the same commands can run in CI or in a release engineer's
terminal.

## 1. Required Jobs

### Static And Unit Checks

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm --filter @openforge/gateway test
pnpm --filter @openforge/web test
git diff --check
```

Acceptance:

- TypeScript emits no type errors.
- Gateway `node:test` suites pass.
- Web Vitest suites pass.
- `git diff --check` reports no whitespace errors.

### Build Checks

```bash
pnpm --filter @openforge/gateway build
pnpm --filter @openforge/web build
```

Acceptance:

- Gateway compiles and copies database migrations into `dist`.
- Web Next.js build completes in an unrestricted runtime.

Known skip:

- In restricted execution sandboxes, Next/Turbopack may fail while creating a
  local worker socket or binding a loopback port with `EPERM`. Record the skip
  once with the exact error and keep Gateway build, typecheck, and unit tests
  as required evidence.

### NPM Package Checks

```bash
pnpm pack:npm
pnpm verify:npm
pnpm smoke:npm
```

Acceptance:

- `pnpm pack:npm` completes the package dry-run and reports the files that
  would ship in the `openforge` npm package.
- `pnpm verify:npm` confirms required Gateway, Web standalone, migration,
  runtime config, README, license, and localized README artifacts are present
  and no forbidden local state files are included.
- `pnpm smoke:npm` builds the npm package, packs a tarball into a temporary
  directory, installs that tarball with `npm --prefix` into a temporary prefix,
  sets `OPENFORGE_STATE_DIR` to temporary state, and runs `openforge doctor`
  from the installed package.

Known skip:

- In restricted CI, `npm install` of the tarball may fail if registry access is
  blocked while resolving package dependencies or native package downloads. If
  this happens, record the exact npm stdout/stderr and keep `pnpm pack:npm` plus
  `pnpm verify:npm` as required evidence.
- `openforge doctor` must fail when required dependencies such as `tmux` are not
  installed. Treat that as an environment failure, not a passing smoke.

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
- NPM package checks pass or have a documented npm registry/native dependency
  skip with exact stdout/stderr.
- E2E smoke passes or has a documented environment skip.

Gate 3 - Manual acceptance:

- Manual smoke passes on the same ports and hostnames the user will access.
- A real Claude Code session receives terminal input and preserves state across
  refresh.
- Claude Code permission notification hook produces an OpenForge notification.
- Rollback steps have been rehearsed on a disposable database or are explicitly
  accepted as manual fallback.

## 4. Deployment Policy

Current MVP deployment is local process based. Do not add cloud deployment,
auto-update, hosted telemetry, or marketplace publishing without a separate
architecture review.
