# Contributing To OpenForge

OpenForge is a local-first control plane for AI programming CLIs. Contributions
should strengthen local session reliability, recoverability, provider setup,
and auditable project traceability without turning the project into a hosted
cloud service or generic project-management suite.

## Before You Start

- Read `README.md`, `docs/TECH-ARCHITECTURE.md`, `docs/API.md`, and
  `docs/OPEN-SOURCE-READINESS.md`.
- Use Node.js 20 or newer, pnpm, tmux, and at least one local AI CLI when
  testing terminal/session behavior.
- Keep Gateway behavior in `packages/gateway`; do not add Next.js API routes
  for Gateway responsibilities.
- Keep Web console behavior in `packages/web`; it should talk to Gateway over
  `/api/v1` and WebSocket routes.

## Local Setup

```bash
pnpm install
pnpm --filter @openforge/gateway dev
pnpm --filter @openforge/web dev -- --hostname 127.0.0.1 --port 48732
```

Use a local `.env` and never commit it. Required secrets include
`OPENFORGE_MASTER_KEY` and `OPENFORGE_JWT_SECRET`; use throwaway local values
for development.

## Verification

Run the narrowest relevant checks first, then broaden for release-sized work:

```bash
pnpm --filter @openforge/web test
pnpm --filter @openforge/web typecheck
pnpm --filter @openforge/gateway test
pnpm --filter @openforge/gateway typecheck
git diff --check
```

For changes touching release behavior, also use `docs/RELEASE-PLAN.md` and
`docs/SMOKE-TEST.md`.

## Boundaries To Preserve

- OpenForge is local-first. Do not add hosted telemetry, hosted collaboration,
  billing, cloud workers, or remote autonomous execution without a new accepted
  architecture and security review.
- tmux is the terminal persistence layer. Do not store terminal scrollback in
  SQLite.
- Gateway owns filesystem, credentials, terminal processes, and WebSocket
  authorization.
- Copilot, Feishu, and model output may propose writes only through explicit
  pending-action approval.
- Codex subscription-managed paths must stay isolated from third-party provider
  API-key/model injection.

## Safe Feedback And Pull Requests

Issues and PRs must not include:

- API keys, JWTs, passwords, private keys, attach tokens, browser auth tokens;
- `.env` files or SQLite databases;
- raw provider request/response bodies;
- raw terminal transcripts or command histories that may contain secrets;
- Feishu app secrets, event bodies, signatures, or message bodies;
- private Claude Code, Codex, OpenCode, or OpenForge user configuration.

Use redacted diagnostics and bounded evidence references instead. When a
problem depends on external evidence such as live providers, physical
Windows/WSL hosts, Feishu developer-console callbacks, or first-user feedback,
record it as a caveat until that evidence exists.

## Issue Routing

- Bugs: use the GitHub bug report template.
- First-user trial results: use `OpenForge first-user trial feedback`.
- Security issues: follow `SECURITY.md`; do not open a public issue with
  exploitable details or secrets.
