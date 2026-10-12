# ForgeBadger Release Plan

> Status: local-first beta release process | Updated: 2026-10-11

This plan covers the current local/self-hosted release shape: one Gateway
process and one Web console process. It does not cover cloud multi-tenant
hosting, billing, external worker pools, or hosted plugin marketplaces.

Release evidence belongs to the exact source commit and npm tarball being
published. Historical acceptance must be rechecked; it does not make a new
candidate ready. Codex uses Session Server terminal sessions. The retired
app-server/turn-input control plane is outside release scope.

## 1. Release Scope

Release artifacts:

- npm package tarball for the publishable `forgebadger` CLI.
- CLI build output: `packages/cli/dist`.
- Gateway build output: `packages/gateway/dist`.
- Web build output: `packages/web/.next`.
- README, LICENSE, localized docs, and database migrations needed by the
  package.

Operational runtime state:

- SQLite data file at `FORGEBADGER_DB_PATH`.
- Project-generated config files under user-approved project directories.
- Session Server sessions named with `FORGEBADGER_SESSION_PREFIX`, default `fb-`.
- User agent configuration directories such as `.claude`, `.codex`, and
  `.opencode`.
- Local API keys, credentials, and user configuration files.

Operational runtime state is never part of the npm package or release artifact.

When multiple ForgeBadger instances share one operating-system account, use
separate `FORGEBADGER_STATE_DIR` and `FORGEBADGER_DB_PATH` values. Session Server
IPC, authentication and lifecycle ownership belong to that state domain. Do not
share a daemon/state directory between unrelated database instances.

The Gateway owns all API and WebSocket behavior. The Web console is a pure
Next.js client that talks to the Gateway through `NEXT_PUBLIC_GATEWAY_URL`.

## 2. Required Environment

Minimum runtime dependencies:

- Node.js 20.12 through 24.
- pnpm from root `packageManager` (currently `pnpm@12.6.0`).
- A loadable node-pty native module on the supported host.
- Claude Code CLI on `PATH` for Claude sessions.
- OpenCode and/or Codex CLI on `PATH` only when those adapters are in scope.
- SQLite-compatible filesystem for `FORGEBADGER_DB_PATH`.

Native Windows uses node-pty/ConPTY in Session Server. Physical Windows and
WSL browser + real CLI acceptance remain separate external evidence gates.

Required secrets:

| Variable | Requirement |
|----------|-------------|
| `FORGEBADGER_MASTER_KEY` | Preferred: 64 hex characters from `openssl rand -hex 32`. Legacy 32-byte strings are still accepted for existing local installs. |
| `FORGEBADGER_JWT_SECRET` | 32 or more high-entropy characters. |

Typical local `.env` shape:

```bash
FORGEBADGER_HOST=127.0.0.1
FORGEBADGER_PORT=18332
FORGEBADGER_WEB_HOST=127.0.0.1
FORGEBADGER_WEB_PORT=18333
FORGEBADGER_GATEWAY_URL=http://127.0.0.1:18332
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:18332
FORGEBADGER_DB_PATH=/absolute/path/to/forgebadger.db
FORGEBADGER_MASTER_KEY=<64-hex-characters>
FORGEBADGER_JWT_SECRET=<32+-character-secret>
FORGEBADGER_LOG_LEVEL=info
FORGEBADGER_SESSION_PREFIX=fb-
```

Do not commit `.env`, database files, API keys, JWTs, or generated user
credentials.

Native dependency notes:

- The npm package still declares runtime dependencies on native modules
  `better-sqlite3` and `node-pty`.
- Session Server is bundled; tmux/psmux are not runtime dependencies.
- If prebuilt native binaries are unavailable for the operator's platform,
  dependency installation requires a working C/C++ build toolchain compatible
  with a supported Node.js release.

## 3. Preflight Checklist

Run before building a release candidate:

```bash
node --version
pnpm --version
forgebadger doctor
claude --version
git status --short
```

Expected:

- Node and pnpm satisfy `package.json` engines.
- Terminal backend reports session-server readiness and the target AI CLI is installed.
- `git status --short` contains only intentional release changes.

## 4. Build And Migration

Install dependencies from the lockfile:

```bash
pnpm install --frozen-lockfile
```

Run release candidate checks:

```bash
node --test scripts/smoke-local-release.test.mjs
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm --dir packages/gateway test test/model-provider-routes.test.ts test/model-provider-repository.test.ts test/cli-config-apply.test.ts test/codex-provider-env.test.ts test/session-adapter-decoupling.test.ts
git diff --check
```

Database migrations are embedded in the Gateway build and run when Gateway
opens `FORGEBADGER_DB_PATH`. Before restarting an existing install, back up the
database file and keep the previous release commit available for rollback.

## 5. Start Or Restart

Build first, then start each process with the same `.env`:

```bash
pnpm --filter @forgebadger/gateway start
pnpm --filter @forgebadger/web start
```

For development or manual smoke:

```bash
pnpm --filter @forgebadger/gateway dev
FORGEBADGER_WEB_HOST=127.0.0.1 FORGEBADGER_WEB_PORT=18333 pnpm --filter @forgebadger/web dev
```

The Gateway must be reachable at `FORGEBADGER_GATEWAY_URL`. The browser must load
the Web console at `http://localhost:18333` or the forwarded host configured by
the operator.

## 6. Repeatable npm Release Procedure

Registry semantics: [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
and [npm dist-tag](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/).

Only `packages/cli` is published as `forgebadger`; Gateway/Web are private
workspace packages bundled into that CLI. A release is bound to one clean
source commit, an immutable tarball, its SHA-512 integrity and one npm dist-tag.
Local state and credentials must never enter the package or release notes.

### A. Select source, version and channel

1. Start from a clean checkout. Fetch and compare the target branch with its
   remote; do not publish uncommitted source or claim unrelated CI runs.
2. Query the public registry and check the maintainer identity without reading
   or printing npm tokens:

   ```bash
   npm whoami --registry=https://registry.npmjs.org
   npm owner ls forgebadger --registry=https://registry.npmjs.org
   npm view forgebadger dist-tags versions --json --registry=https://registry.npmjs.org
   ```

3. Set a never-published version in `packages/cli/package.json` and record
   release notes below. Commit the version/docs before creating artifacts.
   Versions cannot be overwritten; use a new version for a corrective release.
4. A prerelease such as `0.2.0-beta.0` uses `--tag beta`; a fully accepted
   stable release uses `--tag latest`. Never promote a beta to `latest` as an
   implicit side effect. `npm install forgebadger` follows `latest`.
5. If npm cannot write its default cache in a restricted environment, supply
   a disposable `--cache` directory. Do not change ownership of the user's
   entire npm directory as part of publishing.

### B. Verify the frozen candidate

Run the commands below and keep sanitized output with the source SHA. Existing
results may be reused only when they apply to unchanged source on the same
host; rerun version-sensitive CLI tests after a version change.

```bash
node --test scripts/*.test.mjs
pnpm validate:brand
pnpm validate:db-migrations
pnpm trial:readiness-validate
pnpm -r typecheck
pnpm -r test
pnpm --dir packages/gateway test test/session-server-daemon-lifecycle.test.ts
pnpm --dir packages/gateway test test/model-provider-routes.test.ts test/model-provider-repository.test.ts test/cli-config-apply.test.ts test/codex-provider-env.test.ts test/session-adapter-decoupling.test.ts
git diff --check
```

Run the relevant real-Gateway browser smoke and security/terminal regressions
from `docs/CI-CD-PLAN.md`. Record pass, failure and environment limitations
separately. Native Windows/WSL and live AI-provider evidence remain caveats
until those hosts/accounts are actually tested.

Stable publication requires the automated gates to pass (or a documented
missing-environment skip). A beta may carry explicitly accepted, bounded
pre-existing failures only when the record includes the failing cases, baseline
comparison, affected feature checks and follow-up. A baseline failure is not a
pass or an environment skip. Failed package integrity, install/startup/PTY smoke,
secret filtering, tenant isolation or the new feature's regressions block both
channels. Do not silently weaken tests to make a release pass.

### C. Build, inspect and install the exact package

`pnpm smoke:npm` builds Gateway/Web/CLI, verifies artifacts, packs the CLI,
installs the tarball into a disposable prefix, and tests doctor, Gateway/Web
startup, auth, project import and real Session Server PTY input/output/stop.
Retain its tarball for publication:

```bash
FORGEBADGER_KEEP_NPM_SMOKE_ROOT=1 pnpm smoke:npm
pnpm verify:npm
```

Save the printed `Packed tarball` path as `release_tarball`; do not pack again
between smoke and publication. Inspect the exact archive using
`tar -tzf "$release_tarball"` and
`npm publish "$release_tarball" --dry-run --ignore-scripts --access public --tag beta --registry=https://registry.npmjs.org`.
Check name/version, the files whitelist, migrated DB assets and Web standalone
runtime. No `.env`, databases, logs, credentials, override directories,
symlinks or build-host native Web binaries may ship. Record file count, size,
SHA-512 integrity and source SHA; keep temporary artifacts outside the repo.
Reconfirm the candidate has no source drift or version collision.

### D. Publish and confirm

Publish that tested tarball with an explicit channel and public registry:

```bash
npm publish "$release_tarball" --ignore-scripts --access public --tag beta --registry=https://registry.npmjs.org
npm view forgebadger@0.2.0-beta.0 version dist.integrity dist.tarball --json --registry=https://registry.npmjs.org
npm view forgebadger dist-tags --json --registry=https://registry.npmjs.org
```

Replace the example version/tag only with the selected release values. If npm
requires browser authentication or 2FA, let the maintainer complete npm's
native flow; never record credentials or OTPs in Git, command files or reports.
If the publish result is ambiguous, query the exact version and compare
integrity before retrying. Never claim success based only on the command launch.

An accepted upload can return HTTP 202 before the version is installable.
According to [npm's publish-time scanning announcement](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/),
availability typically takes about five minutes and can take 15 minutes or
longer, depending on load and package content/size. Poll the exact version
with bounded waits and fresh registry reads; do not republish an accepted
upload merely because the first read returns 404. If availability remains
pending, record that state and check the maintainer's npm version history or
notifications rather than declaring the release complete.

Compare registry integrity with the tested tarball, install the exact registry
version into a disposable prefix, and run its version/doctor checks with a fresh
state directory. Then create annotated tag `v<version>` on the release source
commit and push the source branch plus that exact tag. Do not claim a GitHub
Release, CI success or provenance attestation unless actually produced.

Retain the release record and sanitized evidence; remove only the test's own
services/state. On a beta publish, confirm `latest` still points to the previous
stable version. Recovery uses a new version or an explicit maintainer decision
to move a dist-tag back; do not unpublish as an automatic rollback.

### 2026-10-11 candidate: 0.2.0-beta.0

- Source baseline: `7a04a310`; the release commit adds this procedure and version.
- Channel: `beta`, explicitly selected by the maintainer. Previous `latest`:
  `0.1.3`; stable promotion is outside this release.
- Changes: default loopback Gateway/Web ports `18332`/`18333`; native Claude
  template memory; credential reveal response isolation; Copilot tool/context
  boundaries; read-only terminal wheel reports and task input consumption;
  scoped MCP lifecycle tools, live project-grant editing and stop observations;
  mobile authorization dialog fix; Windows directory-picker diagnostics.
- Compatibility: existing persisted runtime ports are retained. New/default
  installs use the new ports. Existing MCP tokens are not silently given the
  lifecycle scope. Terminal observations persist identity only, never output.
- Evidence before version bump: Web tests 1157 passed, CLI tests 127 passed,
  script harness 136 passed; MCP/Claude/security subset 238 passed; real
  WebSocket/PTY subset 49 passed and shell cancellation/stop subset 4 passed;
  core browser suite 25 passed and Project Manager suite 6 passed; real Gateway
  MCP create/edit/authority-denial/revoke flow passed. Some browser cases mock
  HTTP; the real-Gateway flows are recorded separately.
- Known limitations: full Gateway regression had 45 failures also present in
  the HEAD baseline; 4 PTY stop cases subsequently passed outside the sandbox.
  The current release rerun is recorded below. Broader E2E includes
  pre-existing interface/fixture mismatches. Neither suite is claimed fully
  green. Physical Windows/ConPTY, live provider accounts and real AI CLI
  automatic execution remain unverified. Beta use must retain these caveats.
- Follow-up before stable: clear the full-regression failures and stale E2E
  contracts, obtain required platform/live-host evidence, rerun the frozen
  candidate gates, and publish a new stable version through explicit acceptance.
- Current candidate checks: CLI **127/127**, Web **1157/1157**, root harness
  **136/136**, and mandatory Gateway release subset **302/302** passed.
  Workspace typecheck, brand, migration and trial-readiness validation passed.
- Full suite on macOS, Node `24.16.0`, pnpm `12.6.0`:
  Gateway **2952 tests: 2905 passed, 42 failed, 5 skipped**. 41 failures match
  the previous HEAD failure list; the previously skipped real collaboration
  PTY case also fails in the old `54fc87a1` baseline outside the sandbox.
  Thus all 42 failing names reproduce in baseline evidence. The failures are
  retained as beta limitations, not cleared by the focused tests.

| Failing test file | Cases | Follow-up before stable |
| --- | ---: | --- |
| `adapter-updates-route.test.ts` | 1 | Align adapter/account fixtures and verify the native CLI boundary |
| `adapter-updates.test.ts` | 1 | Align adapter/account fixtures and verify the native CLI boundary |
| `cli-account-routes.test.ts` | 1 | Align adapter/account fixtures and verify the native CLI boundary |
| `collaboration-workflow.test.ts` | 14 | Diagnose workspace preparation before claiming delivery/team workflow acceptance |
| `copilot-playbook-migration.test.ts` | 1 | Diagnose historical playbook migration and backup fixture |
| `dependency-check.test.ts` | 1 | Align adapter/account fixtures and verify the native CLI boundary |
| `mcode-account.test.ts` | 9 | Align adapter/account fixtures and verify the native CLI boundary |
| `project-template-binding.test.ts` | 5 | Align adapter-specific template boundary fixtures and rerun tenant cases |
| `session-server.test.ts` | 1 | Resolve platform path fixtures and validate on native Windows |
| `team-administration.test.ts` | 2 | Diagnose workspace preparation before claiming delivery/team workflow acceptance |
| `windows-npm-shim.test.ts` | 6 | Resolve platform path fixtures and validate on native Windows |

### 2026-10-11 published: 0.2.0-beta.0

- Package: [forgebadger@0.2.0-beta.0](https://www.npmjs.com/package/forgebadger/v/0.2.0-beta.0).
  Registry tags confirmed: `beta=0.2.0-beta.0`, `latest=0.1.3`.
- Release source: `c1aee6843356b477a61014f9d195a73fa624bd38`; annotated Git
  tag: `v0.2.0-beta.0`. This subsequent documentation record is outside the
  frozen release artifact.
- The exact installed/PTY-smoked tarball was published with `--ignore-scripts`.
  It contains 8470 files and is 28,022,004 bytes compressed. Registry integrity
  matched the tested artifact after it became publicly available at
  `2026-10-11T11:07:22Z`.
- SHA-256: `6e4512e9f1f05832a802907abdcffcffe8f3708b866093787b2145b69a44ef59`.
- Registry integrity: `sha512-LoRjQieRb5ALAP5xoIwYvZaX7ThBB5vwKmhL2SZcfh5dG49365PDJejkVNQe84dpOvOIbf/nUUxkNp63IPtu/g==`.
- A fresh install of the exact public registry version passed `--version` and
  `doctor` on macOS arm64 / Node `24.16.0`, including loadable `node-pty` and
  `better-sqlite3`. Publication used temporary Node `22.23.3` / npm `10.9.9`
  after local TLS connection failures; the artifact was not rebuilt.
- The candidate's full-regression and physical-platform/live-host limitations
  above still apply. Install explicitly with `npm install -g forgebadger@beta`.

## 7. Release Acceptance

A release candidate is acceptable only when:

- Required automated checks in `docs/CI-CD-PLAN.md` pass or have recorded
  environment skip reasons; any beta-only baseline exception follows section 6.
  This does not claim stable release acceptance.
- Manual smoke in `docs/SMOKE-TEST.md` passes for auth, projects, config sync,
  sessions, terminal attach, notifications, Templates, Skills, plugins,
  usage, and snapshots.
- Windows native/WSL evidence is recorded from a physical Windows host before
  removing the current platform caveat.
- Existing projects can still render config previews and apply config sync with
  explicit conflict decisions.
- Existing stored API keys decrypt with the configured `FORGEBADGER_MASTER_KEY`.
- No hardcoded secrets or plaintext credentials are introduced.

## 8. Phase C Entry Criteria

Phase C product hardening starts from beta feedback, not from opening new
runtime scope. The first Phase C backlog should prioritize:

- first-run install and dependency failure states;
- clearer CLI availability and provider-configuration recovery paths;
- diagnostics export review and feedback intake;
- Windows/WSL terminal remediation based on physical host evidence;

The Codex app-server control-plane prototype was removed on 2026-08-14; Codex
runs exclusively as Session Server-backed terminal sessions.

## 9. Rollback

Rollback sequence:

1. Stop the Web console process.
2. Stop the Gateway process.
3. Restore the previous release commit or build artifact.
4. Restore the previous `.env` if secret or port configuration changed.
5. Restore the backed-up SQLite database if the new release wrote incompatible
   state.
6. Start Gateway, then Web.
7. Inspect the authenticated Sessions page/API and stop only disposable failed
   sessions belonging to this release smoke. Do not kill unrelated processes.

Terminal history is held in the daemon headless terminal, not SQLite. Gateway
rollback/restart preserves CLI processes only while the same compatible daemon
remains alive. Daemon or OS restart loses those processes and requires explicit
new sessions. Legacy tmux/psmux processes are neither adopted nor terminated;
finish old tasks before retiring the old runtime. Do not uninstall system tools
or delete active daemon state as part of release cleanup.
