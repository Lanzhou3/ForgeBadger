<p align="center">
  <img src="packages/web/public/brand/forgebadger-banner.png" alt="ForgeBadger" width="720">
</p>

# ForgeBadger

[简体中文](docs/README.zh-CN.md) | [繁體中文](docs/README.zh-TW.md)

ForgeBadger is a local-first control plane for AI programming CLIs. It gives
developers one Web console for managing projects, persistent terminal
sessions, AI tool configuration, models, API keys, Agents, Skills, Templates,
usage visibility, and session history across Claude Code, OpenCode, Codex,
and Kimi Code.

ForgeBadger is built for self-hosted developer machines and private workspaces.
The Gateway owns filesystem access, SQLite persistence, terminal-multiplexer sessions,
WebSocket terminal traffic, encryption, and CLI process lifecycle. The Web
console is a pure Next.js SPA that talks to the Gateway over HTTP and
WebSocket.

## Project Status

ForgeBadger is in MVP / local-first release-candidate development. The core
Gateway, Web console, persistent terminal flow, authentication, encrypted API key
storage, project setup, adapter discovery, provider model profiles, live model
sync, and management surfaces are in place for local user testing.

Model/provider setup is per-CLI and user-global: the Model Center (`/models`)
keeps provider profiles, model profiles, and encrypted credentials, and an
explicit apply-provider action writes the selection into each CLI's native
global config — Claude `~/.claude/settings.json`, OpenCode `opencode.json`,
Codex `~/.codex/config.toml` + `~/.codex/auth.json`, Kimi
`~/.kimi-code/config.toml`. Sessions are model-agnostic and always launch with
host-environment credentials; ForgeBadger injects no provider, model, or
credential environment at launch, and never reads the OS keyring. Hosted collaboration, billing,
cloud deployment, and autonomous remote execution are not part of the current
local-first MVP.

The product, package scope, CLI, runtime identifiers, local state contract, and
public GitHub repository now use the ForgeBadger brand. The rename compatibility
window is closed: only ForgeBadger environment variables, state paths, browser
storage keys, cookies, WebSocket protocols, and `fb-` session prefixes are
accepted. Historical phase IDs beginning with `OF-` remain stable evidence
identifiers.

## First User Trial

- [Trial runbook](docs/TRIAL-RUNBOOK.md)
- [Trial checklist](docs/TRIAL-CHECKLIST.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Trial feedback template](docs/TRIAL-FEEDBACK.md)
- [GitHub feedback issue form](.github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml)

## Why ForgeBadger

- Keep long-running AI CLI work visible and recoverable from a browser.
- Manage Claude Code, OpenCode, Codex, and Kimi Code sessions without mixing their local
  config files by hand.
- Keep terminal persistence in the host multiplexer—tmux on macOS/Linux/WSL,
  psmux on native Windows—not in a browser tab or database log.
- Centralize project templates, Agents, Skills, API keys, models, and local
  diagnostics in one developer control surface.
- Stay local-first: secrets, project paths, terminal processes, and SQLite
  state remain on the host running the Gateway.

## Features

- Project create/import flows with AI tool config generation and compliance
  checks.
- Multiplexer-backed terminal sessions that survive browser disconnects and
  Gateway restarts: tmux on macOS/Linux/WSL and psmux on native Windows.
- Adapter discovery and gated session launch for Claude Code, OpenCode, Codex,
  and Kimi Code.
- Provider model profiles with encrypted API key storage and live model sync
  for OpenAI-compatible provider endpoints.
- Explicit apply-provider flow that writes a selected provider/model/credential
  into each CLI's native global config (cc-switch parity: atomic `0600` writes,
  AES-256-GCM-encrypted backup, and rollback), with a redacted preview.
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
  -> tmux attach (macOS/Linux/WSL) or psmux attach (native Windows)
  -> AI CLI process
```

Repository layout:

```text
packages/
  cli/       npm-distributed ForgeBadger CLI wrapper
  gateway/   Express, WebSocket, tmux-or-psmux/node-pty, SQLite, adapters, services
  web/       Next.js App Router, React, Tailwind CSS, xterm.js
docs/        architecture, release, smoke-test, trial, and localized docs
templates/   built-in AI CLI configuration templates
```

Key rules:

- Gateway and Web are separate services. Gateway API behavior does not live in
  Next.js API routes.
- REST APIs are under `/api/v1`; terminal traffic uses `/ws/terminal/:sessionId`.
- tmux (macOS/Linux/WSL) or psmux (native Windows) is the persistence layer for
  terminal sessions.
- Terminal history is recovered from multiplexer `capture-pane`, not stored in SQLite.
- API keys are decrypted only in Gateway memory and injected into CLI sessions
  through multiplexer environment variables.

## Requirements

- Node.js 20.12 through 24
- pnpm 10 or newer for source development
- tmux 3.2 or newer on macOS, Linux, or WSL
- psmux 3.3.8 or newer on native Windows
- SQLite-compatible local filesystem
- Claude Code, OpenCode, Codex, and/or Kimi Code installed on `PATH` for real AI CLI
  sessions

Native Windows uses [psmux](https://github.com/psmux/psmux); WSL continues to
use tmux. If psmux is missing, install it with the official WinGet package:

```powershell
winget install --id marlocarlo.psmux --exact --source winget
```

If psmux is older than 3.3.8, upgrade it with:

```powershell
winget upgrade --id marlocarlo.psmux --exact --source winget
```

See the [psmux compatibility documentation](https://github.com/psmux/psmux/blob/master/docs/compatibility.md),
[psmux v3.3.8 release](https://github.com/psmux/psmux/releases/tag/v3.3.8),
[tmux install guide](https://github.com/tmux/tmux/wiki/installing), and
[Microsoft WinGet install documentation](https://learn.microsoft.com/en-us/windows/package-manager/winget/install).

## Install From npm

```bash
npm install -g forgebadger
forgebadger doctor
forgebadger start
```

Open the Web console at the URL printed by `forgebadger start`.

The interactive `start` / `init` preflight prints a dependency-free ForgeBadger
text logo before any environment probe, then reports the terminal-runtime check
as a short two-stage flow. Color is used only on a capable TTY; redirected,
`NO_COLOR`, and `TERM=dumb` output stays plain text.

The npm package postinstall does not install system software. `forgebadger
doctor` only reports dependency state. When `forgebadger start` or
`forgebadger init` detects a missing terminal runtime, it shows the fixed
official/package-manager command and asks before running it. Installation runs
only in an interactive TTY outside CI, defaults to No, requires an explicit
`y`/`yes`, and rechecks the runtime afterward. If the runtime is still not
ready, the command exits non-zero before creating runtime/project state or
starting Gateway/Web. `forgebadger doctor` is read-only: inspecting an empty
state directory does not create config, secrets, databases, or directories.
Linux detection is limited to the fixed `apt-get`, `dnf`, `yum`, `pacman`,
`zypper`, and `apk` allowlist.
Install Claude Code, OpenCode, Codex, or Kimi Code separately and make sure the
tools you plan to use are available on `PATH`.

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

For Model Center and apply-provider changes, run the focused Gateway
regression set (`test/model-provider-routes.test.ts`,
`test/model-provider-repository.test.ts`, `test/cli-config-apply.test.ts`,
`test/codex-provider-env.test.ts`, `test/session-adapter-decoupling.test.ts`)
plus the Web provider tests and `packages/web/e2e/models.spec.ts` against a
real loopback Gateway and Next composition. A real OpenAI-provider smoke,
native Codex-account smoke, and native Windows psmux lifecycle remain external
evidence; unit/mocked coverage must not be reported as those real-host results.

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
