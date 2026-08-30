<p align="center">
  <img src="logos/ForgeBadger.svg" alt="ForgeBadger" width="720">
</p>

# ForgeBadger

[简体中文](docs/README.zh-CN.md) | [繁體中文](docs/README.zh-TW.md)

ForgeBadger is a local-first control plane for AI programming CLIs. It gives
developers one Web console for managing projects, persistent terminal
sessions, AI tool configuration, models, API keys, Agents, Skills, Templates,
usage visibility, and session history across Claude Code, OpenCode, and
Codex.

ForgeBadger is built for self-hosted developer machines and private workspaces.
The Gateway owns filesystem access, SQLite persistence, tmux sessions,
WebSocket terminal traffic, encryption, and CLI process lifecycle. The Web
console is a pure Next.js SPA that talks to the Gateway over HTTP and
WebSocket.

## Project Status

ForgeBadger is in MVP / local-first release-candidate development. The core
Gateway, Web console, tmux terminal flow, authentication, encrypted API key
storage, project setup, adapter discovery, provider model profiles, live model
sync, and management surfaces are in place for local user testing.

Codex app-server lifecycle work is currently experimental and intentionally
guarded behind the Web console's experimental features area. Hosted
collaboration, billing, cloud deployment, and autonomous remote execution are
not part of the current local-first MVP.

The product and local repository are being renamed to ForgeBadger on the
`codex/rename-forgebadger` branch. The public GitHub remote is still
`Lanzhou3/OpenForge` until the repository owner completes the external rename;
links to existing issues, pull requests, and security settings intentionally
continue to use that current remote.

## First User Trial

- [Trial runbook](docs/TRIAL-RUNBOOK.md)
- [Trial checklist](docs/TRIAL-CHECKLIST.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Trial feedback template](docs/TRIAL-FEEDBACK.md)
- [GitHub feedback issue form](.github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml)

## Why ForgeBadger

- Keep long-running AI CLI work visible and recoverable from a browser.
- Manage Claude Code, OpenCode, and Codex sessions without mixing their local
  config files by hand.
- Keep terminal persistence in tmux, not in a browser tab or database log.
- Centralize project templates, Agents, Skills, API keys, models, and local
  diagnostics in one developer control surface.
- Stay local-first: secrets, project paths, terminal processes, and SQLite
  state remain on the host running the Gateway.

## Features

- Project create/import flows with AI tool config generation and compliance
  checks.
- tmux-backed terminal sessions that survive browser disconnects and Gateway
  restarts.
- Adapter discovery and gated session launch for Claude Code, OpenCode, and
  Codex.
- Provider model profiles with encrypted API key storage and live model sync
  for OpenAI-compatible provider endpoints.
- Agent, Skill, Template, usage, history, notification, and settings
  surfaces in the Web console.
- Session snapshots, terminal focus mode, command palette prototype, and local
  diagnostics export.
- WebSocket event stream for session status, notifications, and cache refresh.

## Architecture

```text
Browser xterm.js
  -> WebSocket
  -> Gateway
  -> node-pty
  -> tmux attach
  -> AI CLI process
```

Repository layout:

```text
packages/
  cli/       npm-distributed ForgeBadger CLI wrapper
  gateway/   Express, WebSocket, tmux/node-pty, SQLite, adapters, services
  web/       Next.js App Router, React, Tailwind CSS, xterm.js
docs/        architecture, release, smoke-test, trial, and localized docs
templates/   built-in AI CLI configuration templates
```

Key rules:

- Gateway and Web are separate services. Gateway API behavior does not live in
  Next.js API routes.
- REST APIs are under `/api/v1`; terminal traffic uses `/ws/terminal/:sessionId`.
- tmux is the persistence layer for terminal sessions.
- Terminal history is recovered from tmux capture-pane, not stored in SQLite.
- API keys are decrypted only in Gateway memory and injected into CLI sessions
  through tmux environment variables.

## Requirements

- Node.js 20.12 through 24
- pnpm 10 or newer for source development
- tmux 3.2 or newer
- SQLite-compatible local filesystem
- Claude Code, OpenCode, Codex, and/or Kimi Code installed on `PATH` for real AI CLI
  sessions

On Windows, run ForgeBadger inside WSL for the built-in browser terminal. Native
Windows installs can still use the management UI, but persistent terminal
sessions depend on tmux.

## Install From npm

```bash
npm install -g forgebadger
forgebadger doctor
forgebadger start
```

Open the Web console at the URL printed by `forgebadger start`.

The npm package installs the ForgeBadger CLI wrapper. It does not install tmux,
Claude Code, OpenCode, Codex, or Kimi Code. Install the AI CLI tools you plan to use
separately and make sure they are available on `PATH`.

## Development From Source

Install dependencies:

```bash
pnpm install
```

Create a local `.env` file. Do not commit it.

```bash
FORGEBADGER_PORT=48731
FORGEBADGER_WEB_PORT=48732
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
FORGEBADGER_MASTER_KEY=<64-hex-characters-from-openssl-rand-hex-32>
FORGEBADGER_JWT_SECRET=<32+-character-random-secret>
```

Start the Gateway and Web console in separate shells:

```bash
pnpm --filter @forgebadger/gateway dev
FORGEBADGER_WEB_HOST=127.0.0.1 FORGEBADGER_WEB_PORT=48732 pnpm --filter @forgebadger/web dev
```

Open the Web console:

```text
http://127.0.0.1:48732
```

Run focused checks:

```bash
pnpm --filter @forgebadger/web typecheck
pnpm --filter @forgebadger/web test
pnpm --filter @forgebadger/gateway typecheck
pnpm --filter @forgebadger/gateway test
git diff --check
```

Run all package checks when preparing a release-sized change:

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm build:npm
pnpm verify:npm
pnpm smoke:npm
```

For Codex Background Tasks release acceptance, also run
`pnpm smoke:codex-app-server` on a host with Codex CLI installed. The Web
prototype intentionally keeps prompt/turn input disabled for beta feedback.

## Documentation

- [Architecture](docs/TECH-ARCHITECTURE.md)
- [Product requirements](docs/PRD-v1.1-MVP.md)
- [Development plan](docs/DEVELOPMENT-PLAN.md)
- [API reference](docs/API.md)
- [Open source readiness](docs/OPEN-SOURCE-READINESS.md)
- [External evidence gates](docs/EXTERNAL-EVIDENCE-GATES.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Smoke test guide](docs/SMOKE-TEST.md)
- [Release plan](docs/RELEASE-PLAN.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Security

- Never commit `.env`, SQLite databases, API keys, JWT secrets, encryption
  keys, generated credentials, or personal AI CLI config.
- Keep local Claude Code, Codex, and OpenCode user-level config outside this
  repository.
- Gateway validates project paths and rejects traversal, symlink escapes, and
  sensitive system paths.
- WebSocket terminal access requires JWT authentication and session-scoped
  attach credentials.
- ForgeBadger is local-first, but local-first does not remove the need to treat
  terminal access and API keys as sensitive.

## License

ForgeBadger is released under the [MIT License](LICENSE).
