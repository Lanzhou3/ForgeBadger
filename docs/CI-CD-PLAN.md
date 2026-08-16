# OpenForge CI/CD Plan

> Status: local-first beta release gates | Date: 2026-05-10

This plan defines the minimum checks for a local/self-hosted OpenForge release.
It is written so the same commands can run in CI or in a release engineer's
terminal.

## 1. Required Jobs

### Static And Unit Checks

```bash
pnpm install --frozen-lockfile
node --test scripts/validate-external-evidence-gates.test.mjs scripts/validate-trial-issue-routes.test.mjs scripts/validate-trial-readiness.test.mjs scripts/audit-trial-feedback-packet.test.mjs scripts/audit-trial-feedback-issue.test.mjs scripts/audit-trial-feedback-issues.test.mjs scripts/audit-feishu-bot-live-report.test.mjs scripts/create-feishu-bot-live-evidence-report.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-feishu-bot-websocket.test.mjs scripts/smoke-feishu-bot-live.test.mjs scripts/smoke-local-release.test.mjs scripts/smoke-npm-package-runner.test.mjs scripts/verify-npm-package.test.mjs
pnpm trial:intake-validate
pnpm evidence:gates-validate
pnpm -r typecheck
pnpm -r test
RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts
pnpm --dir packages/gateway test test/model-provider-routes.test.ts test/model-provider-repository.test.ts test/model-config-apply.test.ts test/codex-provider-env.test.ts test/session-adapter-decoupling.test.ts
git diff --check
```

Acceptance:

- Script-level smoke harness tests pass, including the external evidence gate
  validator, trial issue-route preflight contract, trial readiness bundle,
  trial feedback packet audit, GitHub issue feedback audit, Feishu live report
  audit and Markdown report generator, draft generator, intake contract
  validator, tokenless runbook diagnostics contract validator, Feishu bot
  WebSocket Gateway fixture smoke helper, npm package smoke runner guard,
  npm package artifact verifier, and trial checklist consistency guard.
- `pnpm trial:intake-validate` and `pnpm evidence:gates-validate` pass before
  trial material or external gate registry changes are accepted.
- TypeScript emits no type errors.
- CLI, Gateway `node:test`, and Web Vitest suites pass.
- Real tmux integration tests pass when tmux is installed.
- Provider SSOT and Codex subscription-boundary regressions pass.
- `git diff --check` reports no whitespace errors.

Maintainer-only live preflight:

```bash
pnpm trial:readiness-validate
```

This command requires GitHub CLI access for the live issue-route check. It is
not a CI gate and does not clear external evidence gates.

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
  from the installed package. The smoke runner bounds child commands with
  `OPENFORGE_NPM_SMOKE_COMMAND_TIMEOUT_MS` and bounds the tarball install with
  `OPENFORGE_NPM_SMOKE_INSTALL_TIMEOUT_MS`. The smoke install uses
  `--omit=peer --legacy-peer-deps` because OpenForge does not require optional
  peer packages from dependencies such as Drizzle ORM to validate package
  install/startup behavior. It also sets explicit npm fetch retry and timeout
  options so transient registry resets fail less often and still produce a
  bounded diagnostic when the network remains unavailable.
- The `openforge` package ships the Next standalone Web runtime under `dist/`;
  do not add `next`, `react`, or `react-dom` as top-level runtime dependencies
  of the CLI package unless the standalone packaging strategy changes.

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

The Codex app-server control-plane prototype (routes, manager, Web console,
Playwright smoke, and `pnpm smoke:codex-app-server`) was removed on 2026-08-14.
Codex sessions run exclusively as tmux-backed terminal sessions; the former
dedicated gates no longer apply.

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

### Phase 1 Terminal Gate Boundary

CI requires `e2e/mvp1-smoke.spec.ts` as the stable control-plane happy path.
`e2e/gate-d-smoke.spec.ts` remains release/manual evidence unless the host
supplies Gateway/Web loopback listeners, tmux, and the real CLI prerequisites
needed for terminal behavior.

Focused tmux evidence is the explicit command:

```bash
RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts
```

Do not claim `pnpm -r test` alone satisfies REL-06. If `gate-d-smoke` or the
focused tmux command is skipped, record `Status: Caveat`, skip reason, owner,
and next action. The default owner is the release maintainer for the target
host, and the next action is to rerun the skipped command on a host with the
missing dependency installed.

### v1.1 Phase 6 Evidence Matrix

The current v1.1 source of truth for live provider, physical Windows/WSL,
CI core smoke, `gate-d`, focused tmux, Feishu live-exposure readiness, release
docs consistency, and redaction status is
`docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md`.

The Phase 8 first-user readiness handoff is
`docs/reports/v1.1-readiness-closeout-2026-05-21.md`, with
`docs/TRIAL-CHECKLIST.md` as the runnable trial path and
`docs/SUPPORT-DIAGNOSTICS.md` as the support triage packet. CI and local
automation remain evidence inputs; they do not replace manual/live evidence for
live provider, physical Windows/WSL, or Feishu bot long-connection status.

Treat these as separate gates:

- CI core smoke: `pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium --reporter=line`.
- Release/manual browser terminal smoke: `pnpm --dir packages/web exec playwright test e2e/gate-d-smoke.spec.ts --project=chromium --reporter=line`.
- Focused tmux integration: `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts`.
- Physical Windows/WSL terminal smoke: manual real-host checklist, not covered
  by Ubuntu CI or current-host Linux evidence.
- Feishu automated route and authority regression:
  `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts`.
- Feishu manual/live bot long connection: configure a self-built Feishu bot for
  persistent connection/WebSocket event delivery, subscribe to
  `im.message.receive_v1`, run
  `pnpm smoke:feishu-bot-live -- --require-gate-evidence --output
  <report.json>`, audit the saved report with
  `pnpm evidence:feishu-bot-live-audit -- <report.json>`, generate the
  maintainer report with
  `pnpm evidence:feishu-bot-live-report -- --report <report.json> --output
  <report.md>`, and record sanitized receive/reply/reconnect evidence. CI
  cannot replace this gate. Public webhook URL verification is an optional
  compatibility path for deployments that deliberately expose Gateway.

Do not mark the physical Windows/WSL row `Pass` unless the real WSL checklist
is completed. Do not mark the live provider row `Pass` unless a disposable live
provider credential and explicit model id produce a successful redacted smoke
result. Do not mark the Feishu bot row `Pass` unless a real persistent
connection/WebSocket run received `im.message.receive_v1`, routed through
OpenForge policy, produced a bounded reply or pending action, and recorded
reconnect behavior. The real SDK smoke command also requires a terminal-input
rejection observation before it emits `gateClearingEvidence=true`; the report
audit only makes that report ready for human review and does not clear the gate
by itself. Current public webhook compatibility support is single Gateway with
SQLite replay/rate storage; multi-instance public exposure requires shared
replay and shared rate-limit stores first. Top-level encrypted Feishu payloads must fail closed with
`feishu_webhook_encrypted_payload_unsupported`.

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
| Browser terminal end-to-end smoke | Environment-gated | Required on release host |
| Real Claude Code permission prompt smoke | Environment-gated | Required when Claude behavior is in scope |
| Physical Windows/WSL terminal smoke | Not covered by Ubuntu CI | Required before removing Windows caveat |

## 5. Deployment Policy

Current MVP deployment is local process based. Do not add cloud deployment,
auto-update, hosted telemetry, or marketplace publishing without a separate
architecture review.