# OpenForge

[简体中文](docs/README.zh-CN.md) | [繁體中文](docs/README.zh-TW.md)

OpenForge is a local-first AI programming IDE control platform. It provides a
Web console for managing AI CLI workflows across Claude Code, OpenCode, and
Codex, including project setup, configuration generation, terminal sessions,
model and API key management, Agents, Skills, Templates, plugins, usage
visibility, and session history.

OpenForge is designed as a self-hosted developer tool. The Gateway owns all
filesystem, database, tmux, WebSocket, encryption, and CLI process behavior.
The Web console is a pure Next.js SPA that talks to the Gateway over HTTP and
WebSocket.

## Features

- Web console for projects, sessions, terminal access, Agents, Skills,
  Templates, models, API keys, plugins, usage, history, and settings.
- tmux-backed terminal sessions that survive browser disconnects and Gateway
  restarts.
- Claude Code, OpenCode, and Codex adapter discovery and gated session launch.
- Project create/import with best-effort AI config generation.
- Built-in best-practice templates for Claude Code, OpenCode, and Codex.
- Project-level AI config editor with raw file editing plus form-based fields.
- Read-only global AI CLI config preview with sensitive value redaction.
- SQLite persistence with user-scoped repositories and JWT authentication.
- AES-256-GCM encrypted API key storage.
- WebSocket event stream for notifications and cache refresh.

## Architecture

```text
Browser Web Console
  -> HTTP / WebSocket
  -> Gateway Service
  -> SQLite / tmux / node-pty
  -> AI CLI process (claude / opencode / codex)
```

The repository is a pnpm monorepo:

```text
packages/
  gateway/   Express, WebSocket, tmux/node-pty, SQLite, adapters, services
  web/       Next.js App Router, React, Tailwind CSS, xterm.js
docs/        Localized README translations
```

## Requirements

- Node.js 20 or newer
- tmux 3.2 or newer
- Claude Code, OpenCode, and/or Codex installed on `PATH` for real CLI sessions
- SQLite-compatible local filesystem
- pnpm 9 or newer for source development

## Install From npm

```bash
npm install -g openforge
openforge doctor
openforge start
```

Open the Web console at the URL printed by `openforge start`.

`npm install -g openforge` installs the OpenForge CLI only. It does not install
`tmux`, Claude Code, OpenCode, or Codex. Install the AI CLI tools you plan to
use separately and make sure they are available on `PATH`.

## Development From Source

Install dependencies:

```bash
pnpm install
```

Create a local `.env` file. Do not commit this file. The values below are the
minimum needed for local development; use your own generated secrets.

```bash
OPENFORGE_PORT=48731
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
OPENFORGE_MASTER_KEY=<64-hex-characters-from-openssl-rand-hex-32>
OPENFORGE_JWT_SECRET=<32+-character-random-secret>
```

Run in development mode:

```bash
pnpm --filter @openforge/gateway dev
pnpm --filter @openforge/web dev -- --hostname 127.0.0.1 --port 48732
```

Open the Web console:

```text
http://localhost:48732
```

Build all packages:

```bash
pnpm -r build
```

Run checks:

```bash
pnpm -r typecheck
pnpm -r test
git diff --check
```

## Security Notes

- Never commit `.env`, SQLite databases, API keys, JWT secrets, encryption
  keys, generated credentials, or personal AI CLI config.
- Local user-level Claude Code, Codex, and OpenCode config files are not part
  of the repository.
- API keys stored through OpenForge are encrypted at rest with AES-256-GCM.
- Gateway validates project paths and rejects traversal, symlink escapes, and
  sensitive system paths.
- WebSocket terminal access requires both JWT authentication and per-session
  attach credentials.

## Documentation

- [`docs/README.zh-CN.md`](docs/README.zh-CN.md) - Simplified Chinese README
- [`docs/README.zh-TW.md`](docs/README.zh-TW.md) - Traditional Chinese README

## License

OpenForge is released under the [MIT License](LICENSE).
