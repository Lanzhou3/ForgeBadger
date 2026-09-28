# ForgeBadger Runbook

> Status: MVP local-first beta operations | Date: 2026-05-10

This runbook captures operational checks and failure handling for the MVP-0 Claude Code local control loop.

First-user local trial startup now begins in [TRIAL-RUNBOOK.md](TRIAL-RUNBOOK.md).
Use this runbook for deeper operational notes, dependency checks, failure
handling, and manual session troubleshooting after the trial path needs
more detail.

## 1. Required Local Dependencies

NPM runtime:

- Node.js 20+
- SQLite-compatible filesystem

The built-in browser terminal is served by the embedded Session Server
daemon. It uses a POSIX Unix socket on macOS/Linux/WSL and a named pipe
with ConPTY on native Windows. No host terminal multiplexer or other
prerequisite binary is required.

Optional runtime dependencies:

- Claude Code CLI, OpenCode, Codex, and/or Kimi Code on `PATH`, only for the corresponding
  real CLI sessions.

Optional during development:

- pnpm
- compiler toolchain for native modules
- Playwright browsers for E2E tests

## 2. Environment Variables

Required for direct Gateway/source startup:

- `FORGEBADGER_MASTER_KEY` - preferred 64-character hex key for AES-256-GCM; legacy 32-byte strings are still accepted
- `FORGEBADGER_JWT_SECRET` - JWT signing secret

Optional:

- `FORGEBADGER_PORT` - default `3000`
- `FORGEBADGER_DB_PATH` - default `~/.forgebadger/forgebadger.db`
- `FORGEBADGER_SESSION_PREFIX` - default `fb-`
- `FORGEBADGER_SESSION_SERVER_IPC_PATH` - override the Session Server IPC endpoint (Windows named pipe / POSIX socket); per-platform default when unset

For npm CLI startup, do not hand-create `FORGEBADGER_MASTER_KEY` or
`FORGEBADGER_JWT_SECRET`. The CLI generates them on first startup and stores
runtime state under `~/.forgebadger` by default. Set `FORGEBADGER_STATE_DIR` to use
a different state directory for config, database, logs, and runtime files.

## 3. Dependency Checks

Before Gate A:

```text
node --version
```

For source development:

```bash
pnpm --version
```

When the corresponding real CLI session type is in scope:

```bash
claude --version
opencode --version
codex --version
```

Expected:

- Node.js is 20 or newer.
- `forgebadger doctor` reports `ok node-pty`. A `missing node-pty` entry
  means the native module failed to load; reinstall ForgeBadger to rebuild
  native modules (`npm install -g forgebadger`).
- pnpm is installed for source development workflows.
- Claude Code, OpenCode, Codex, or Kimi Code is available on `PATH` only when that adapter
  is being used for real sessions; missing optional CLIs are reported as
  `optional-missing` and do not block startup.

## 4. NPM CLI Startup

Use the installed CLI for local npm-distributed runtime checks:

```bash
forgebadger doctor
forgebadger start --gateway-port 48731 --web-port 48732
```

`forgebadger start` loads or creates runtime configuration and then starts
the Gateway and Web child processes, printing the Web console URL. If the
browser cannot connect immediately, wait for initialization or inspect logs
and `forgebadger doctor` output. Runtime state defaults to `~/.forgebadger`;
use `FORGEBADGER_STATE_DIR` when testing against disposable state or running
multiple isolated installs.

The npm postinstall and `forgebadger doctor` never install system software.
`doctor` is fully read-only: inspecting an empty state path does not create
the directory, runtime config, secrets, SQLite database, or recovery key.

## 5. Gateway Startup Behavior

On startup, Gateway must:

1. Validate required env vars.
2. Open SQLite database and run or verify migrations.
3. Construct secrets, event bus, and session manager.
4. Connect to the Session Server daemon and reconcile live sessions
   against database sessions; sessions whose processes are gone are marked
   `lost` and are not silently recreated.
5. Mount HTTP routes and WebSocket endpoints and listen.

The Session Server daemon survives Gateway restarts: browser or Gateway
reconnect restores the live terminal snapshot and continues output. Daemon
death or an OS restart loses the original processes; startup reconciliation
marks the affected database sessions `lost`.

## 6. Common Failure Handling

| Failure | Expected behavior |
|---------|-------------------|
| Session Server daemon fails to start or IPC connect fails | Abort startup before listen; surface the daemon error in logs |
| Session process exits while attached | Send terminal exit event; mark session `exited` |
| Session process gone after Gateway/daemon restart | Mark database session `lost`; do not silently recreate the task |
| Missing Claude Code / OpenCode / Codex / Kimi Code | Block session launch with adapter dependency error |
| Project under denied root | Reject before render/write/launch |
| API key decrypt fails | Block launch; do not create a terminal session |
| WebSocket auth invalid | Reject before attaching to the terminal |
| Snapshot restore fails | Attach anyway; show history restoration warning |
| config rollback fails | Return affected files for manual recovery |

## 7. Manual Session Troubleshooting

Session inspection goes through the Gateway API and WebSocket event stream;
there is no separate host-side CLI for enumerating terminal sessions.

List sessions and their runtime state:

```bash
curl -H "Authorization: Bearer <token>" \
  http://127.0.0.1:48731/api/v1/sessions
```

Watch session status events in real time:

```text
/ws/events  (Sec-WebSocket-Protocol: forgebadger-events, <jwt>)
```

Attach to a live terminal:

- Open the session in the Web console, or
- connect to `/ws/terminal/:sessionId` with the
  `forgebadger-terminal, <jwt>, <attachToken>` subprotocol.

Stop or delete a session from the Sessions page or the
`/api/v1/sessions/:id` endpoints. Stop/delete is explicit: deleting a
session terminates its terminal process.

## 8. Plan B: External Terminal Handoff

If Gate A fails:

1. Freeze embedded terminal UI deep work.
2. Continue project/config management only.
3. Re-attach to the affected session through the Web console or the
   `/ws/terminal/:sessionId` endpoint.
4. Record failure reason and required fix.
5. Revisit embedded terminal after the POC blocker is resolved.

## 9. CLI Project Bootstrap

The MVP-5 `forgebadger init` prototype can generate ForgeBadger project config
without opening the Web console:

```bash
pnpm forgebadger -- init --path /path/to/project --dry-run
pnpm forgebadger -- init --path /path/to/project --template-id builtin-claude-code
```

Dry-run returns a JSON envelope with generated file paths, hashes, and detected
conflicts. A non-dry run writes the rendered config through the same
`writeConfigPlan` conflict and rollback pipeline used by Gateway project config
generation.

## 10. Gate D Evidence

Before entering MVP-1, record:

- Gate A/B/C status
- commands run
- skipped commands and reasons
- manual demo result for 5-minute control loop
- known issues
