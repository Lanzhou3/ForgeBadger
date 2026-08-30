# ForgeBadger Release Plan

> Status: local-first beta release readiness | Date: 2026-05-10

This plan covers the current local/self-hosted release shape: one Gateway
process and one Web console process. It does not cover cloud multi-tenant
hosting, billing, external worker pools, or hosted plugin marketplaces.

Phase A local-first browser terminal evidence is closed by the 2026-05-07 real
browser and Claude Code permission prompt reports. Phase B Codex Background
Tasks are accepted for beta feedback as a guarded observable control plane:
Web prompt/turn input remains disabled, and `/turn` is still a feature-flagged
Gateway prototype route.

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
- Runtime tmux sessions named with `FORGEBADGER_TMUX_PREFIX`, default `of-`.
- User agent configuration directories such as `.claude`, `.codex`, and
  `.opencode`.
- Local API keys, credentials, and user configuration files.

Operational runtime state is never part of the npm package or release artifact.

When multiple ForgeBadger instances share one operating-system account, assign
each instance a unique `FORGEBADGER_TMUX_PREFIX`. Separate state or database
paths do not isolate tmux's global server, and reusing the default `of-` prefix
can make one instance treat another instance's sessions as orphans.

The Gateway owns all API and WebSocket behavior. The Web console is a pure
Next.js client that talks to the Gateway through `NEXT_PUBLIC_GATEWAY_URL`.

## 2. Required Environment

Minimum runtime dependencies:

- Node.js 20.12 through 24.
- pnpm 10 or newer.
- tmux 3.2 or newer.
- Claude Code CLI on `PATH` for Claude sessions.
- OpenCode and/or Codex CLI on `PATH` only when those adapters are in scope.
- SQLite-compatible filesystem for `FORGEBADGER_DB_PATH`.

Windows native hosts can run management UI workflows, but the built-in browser
terminal requires WSL because terminal persistence depends on tmux. Run release
terminal acceptance inside WSL for Windows users.

Required secrets:

| Variable | Requirement |
|----------|-------------|
| `FORGEBADGER_MASTER_KEY` | Preferred: 64 hex characters from `openssl rand -hex 32`. Legacy 32-byte strings are still accepted for existing local installs. |
| `FORGEBADGER_JWT_SECRET` | 32 or more high-entropy characters. |

Typical local `.env` shape:

```bash
FORGEBADGER_HOST=127.0.0.1
FORGEBADGER_PORT=48731
FORGEBADGER_WEB_HOST=127.0.0.1
FORGEBADGER_WEB_PORT=48732
FORGEBADGER_GATEWAY_URL=http://127.0.0.1:48731
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
FORGEBADGER_DB_PATH=/absolute/path/to/forgebadger.db
FORGEBADGER_MASTER_KEY=<64-hex-characters>
FORGEBADGER_JWT_SECRET=<32+-character-secret>
FORGEBADGER_LOG_LEVEL=info
FORGEBADGER_TMUX_PREFIX=of-
```

Do not commit `.env`, database files, API keys, JWTs, or generated user
credentials.

Native dependency notes:

- The npm package still declares runtime dependencies on native modules
  `better-sqlite3` and `node-pty`.
- `tmux` is a system dependency and is not installed by npm.
- If prebuilt native binaries are unavailable for the operator's platform,
  dependency installation requires a working C/C++ build toolchain compatible
  with a supported Node.js release.

## 3. Preflight Checklist

Run before building a release candidate:

```bash
node --version
pnpm --version
tmux -V
claude --version
git status --short
```

Expected:

- Node and pnpm satisfy `package.json` engines.
- tmux and Claude Code are installed when terminal smoke is in scope.
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
pnpm --dir packages/gateway test test/model-provider-routes.test.ts test/model-provider-repository.test.ts test/model-config-apply.test.ts test/codex-provider-env.test.ts test/session-adapter-decoupling.test.ts
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
FORGEBADGER_WEB_HOST=127.0.0.1 FORGEBADGER_WEB_PORT=48732 pnpm --filter @forgebadger/web dev
```

The Gateway must be reachable at `FORGEBADGER_GATEWAY_URL`. The browser must load
the Web console at `http://localhost:48732` or the forwarded host configured by
the operator.

## 6. NPM Release Candidate

Required checks:

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm build:npm
pnpm pack:npm
pnpm verify:npm
pnpm smoke:npm
```

Before publishing, inspect the `npm pack --dry-run` output from `pnpm pack:npm`
and confirm the package does not include local config, database files, logs,
API keys, `.claude`, `.codex`, `.opencode`, SQLite databases, internal
development artifacts, symlinks, or build-host-native Web binaries. The
verifier also requires the published CLI to declare every direct Gateway
runtime dependency.

## 7. Release Acceptance

A release candidate is acceptable only when:

- Required automated checks in `docs/CI-CD-PLAN.md` pass or have recorded
  skip reasons.
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
runs exclusively as tmux-backed terminal sessions.

## 9. Rollback

Rollback sequence:

1. Stop the Web console process.
2. Stop the Gateway process.
3. Restore the previous release commit or build artifact.
4. Restore the previous `.env` if secret or port configuration changed.
5. Restore the backed-up SQLite database if the new release wrote incompatible
   state.
6. Start Gateway, then Web.
7. Inspect `tmux list-sessions` and only terminate new failed `of-*` sessions
   after confirming they are not active user sessions.

Terminal scrollback is not stored in SQLite. Recovery depends on tmux sessions
remaining alive, so do not kill tmux sessions during rollback unless they are
confirmed orphaned.
