# OpenForge Release Plan

> Status: MVP-6 release readiness | Date: 2026-05-02

This plan covers the current local/self-hosted release shape: one Gateway
process and one Web console process. It does not cover cloud multi-tenant
hosting, billing, external worker pools, or hosted plugin marketplaces.

## 1. Release Scope

Release artifacts:

- Gateway build output: `packages/gateway/dist`.
- Web build output: `packages/web/.next`.
- SQLite data file at `OPENFORGE_DB_PATH`.
- Project-generated config files under user-approved project directories.
- Runtime tmux sessions named with `OPENFORGE_TMUX_PREFIX`, default `of-`.

The Gateway owns all API and WebSocket behavior. The Web console is a pure
Next.js client that talks to the Gateway through `NEXT_PUBLIC_GATEWAY_URL`.

## 2. Required Environment

Minimum runtime dependencies:

- Node.js 20 or newer.
- pnpm 9 or newer.
- tmux 3.2 or newer.
- Claude Code CLI on `PATH` for Claude sessions.
- SQLite-compatible filesystem for `OPENFORGE_DB_PATH`.

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
pnpm -r typecheck
pnpm --filter @openforge/gateway build
pnpm --filter @openforge/web build
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
pnpm --filter @openforge/gateway test
pnpm --filter @openforge/web test
pnpm build:npm
pnpm pack:npm
node scripts/verify-npm-package.mjs
pnpm smoke:npm
```

Before publishing, inspect the `npm pack --dry-run` output from `pnpm pack:npm`
and confirm the package does not include local config, database files, logs,
API keys, or internal development artifacts.

## 7. Release Acceptance

A release candidate is acceptable only when:

- Required checks in `docs/CI-CD-PLAN.md` pass or have recorded environment
  skip reasons.
- Manual smoke in `docs/SMOKE-TEST.md` passes for auth, projects, config sync,
  sessions, terminal attach, notifications, Templates, Skills, plugins,
  usage, and snapshots.
- Existing projects can still render config previews and apply config sync with
  explicit conflict decisions.
- Existing stored API keys decrypt with the configured `OPENFORGE_MASTER_KEY`.
- No hardcoded secrets or plaintext credentials are introduced.

## 8. Rollback

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
