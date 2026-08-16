# OpenForge Release Plan

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

- npm package tarball for the publishable `openforge` CLI.
- CLI build output: `packages/cli/dist`.
- Gateway build output: `packages/gateway/dist`.
- Web build output: `packages/web/.next`.
- README, LICENSE, localized docs, and database migrations needed by the
  package.

Operational runtime state:

- SQLite data file at `OPENFORGE_DB_PATH`.
- Project-generated config files under user-approved project directories.
- Runtime tmux sessions named with `OPENFORGE_TMUX_PREFIX`, default `of-`.
- User agent configuration directories such as `.claude`, `.codex`, and
  `.opencode`.
- Local API keys, credentials, and user configuration files.

Operational runtime state is never part of the npm package or release artifact.

The Gateway owns all API and WebSocket behavior. The Web console is a pure
Next.js client that talks to the Gateway through `NEXT_PUBLIC_GATEWAY_URL`.

## 2. Required Environment

Minimum runtime dependencies:

- Node.js 20 or newer.
- pnpm 9 or newer.
- tmux 3.2 or newer.
- Claude Code CLI on `PATH` for Claude sessions.
- OpenCode and/or Codex CLI on `PATH` only when those adapters are in scope.
- SQLite-compatible filesystem for `OPENFORGE_DB_PATH`.

Windows native hosts can run management UI workflows, but the built-in browser
terminal requires WSL because terminal persistence depends on tmux. Run release
terminal acceptance inside WSL for Windows users.

Required secrets:

| Variable | Requirement |
|----------|-------------|
| `OPENFORGE_MASTER_KEY` | Preferred: 64 hex characters from `openssl rand -hex 32`. Legacy 32-byte strings are still accepted for existing local installs. |
| `OPENFORGE_JWT_SECRET` | 32 or more high-entropy characters. |

Typical local `.env` shape:

```bash
OPENFORGE_HOST=127.0.0.1
OPENFORGE_PORT=48731
OPENFORGE_WEB_HOST=127.0.0.1
OPENFORGE_WEB_PORT=48732
OPENFORGE_GATEWAY_URL=http://127.0.0.1:48731
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
OPENFORGE_DB_PATH=/absolute/path/to/openforge.db
OPENFORGE_MASTER_KEY=<64-hex-characters>
OPENFORGE_JWT_SECRET=<32+-character-secret>
OPENFORGE_LOG_LEVEL=info
OPENFORGE_TMUX_PREFIX=of-
```

Do not commit `.env`, database files, API keys, JWTs, or generated user
credentials.

Native dependency notes:

- The npm package still declares runtime dependencies on native modules
  `better-sqlite3` and `node-pty`.
- `tmux` is a system dependency and is not installed by npm.
- If prebuilt native binaries are unavailable for the operator's platform,
  dependency installation requires a working C/C++ build toolchain compatible
  with Node.js 20 or newer.

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
opens `OPENFORGE_DB_PATH`. Before restarting an existing install, back up the
database file and keep the previous release commit available for rollback.

## 5. Start Or Restart

Build first, then start each process with the same `.env`:

```bash
pnpm --filter @openforge/gateway start
pnpm --filter @openforge/web start
```

For development or manual smoke:

```bash
pnpm --filter @openforge/gateway dev
pnpm --filter @openforge/web dev --port 48732
```

The Gateway must be reachable at `OPENFORGE_GATEWAY_URL`. The browser must load
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
API keys, `.claude`, `.codex`, `.opencode`, SQLite databases, or internal
development artifacts.

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
- Existing stored API keys decrypt with the configured `OPENFORGE_MASTER_KEY`.
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
