# ForgeBadger Runbook

> Status: MVP local-first beta operations | Date: 2026-05-10

This runbook captures operational checks and failure handling for the MVP-0 Claude Code local control loop.

First-user local trial startup now begins in [TRIAL-RUNBOOK.md](TRIAL-RUNBOOK.md).
Use this runbook for deeper operational notes, dependency checks, failure
handling, and manual terminal-multiplexer inspection after the trial path needs
more detail.

## 1. Required Local Dependencies

NPM runtime:

- Node.js 20+
- tmux 3.2+ on macOS/Linux/WSL, or psmux 3.3.8+ on native Windows
- SQLite-compatible filesystem

The built-in browser terminal uses tmux on macOS/Linux/WSL and psmux over
ConPTY on native Windows.

Optional runtime dependencies:

- Claude Code CLI, OpenCode, and/or Codex on `PATH`, only for the corresponding
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
- `FORGEBADGER_LOG_LEVEL` - default `info`
- `FORGEBADGER_TMUX_PREFIX` - default `fb-`

For npm CLI startup, do not hand-create `FORGEBADGER_MASTER_KEY` or
`FORGEBADGER_JWT_SECRET`. The CLI generates them on first startup and stores
runtime state under `~/.forgebadger` by default. Set `FORGEBADGER_STATE_DIR` to use
a different state directory for config, database, logs, and runtime files.

## 3. Dependency Checks

Before Gate A:

```text
node --version
macOS/Linux/WSL: tmux -V
native Windows:  psmux -V
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
- The platform terminal runtime is installed.
- `forgebadger doctor` reports `terminal native_tmux` on macOS/Linux/WSL or
  `terminal native_psmux` on native Windows. Missing runtimes report
  `tmux_missing`/`psmux_missing`; psmux below 3.3.8 reports `psmux_outdated`.
- pnpm is installed for source development workflows.
- Claude Code, OpenCode, or Codex is available on `PATH` only when that adapter
  is being used for real sessions.

## 4. NPM CLI Startup

Use the installed CLI for local npm-distributed runtime checks:

```bash
forgebadger doctor
forgebadger start --gateway-port 48731 --web-port 48732
```

`forgebadger start` checks the platform terminal runtime before loading or
creating runtime configuration. Only a ready runtime proceeds to Gateway/Web
child-process startup and prints the Web console URL. If the browser cannot connect
immediately, wait for initialization or inspect logs and `forgebadger doctor`
output. Runtime state defaults to `~/.forgebadger`; use `FORGEBADGER_STATE_DIR`
when testing against disposable state or running multiple isolated installs.

Native Windows installs missing psmux with
`winget install --id marlocarlo.psmux --exact --source winget`, or upgrades a
version below 3.3.8 with
`winget upgrade --id marlocarlo.psmux --exact --source winget`. WSL remains an
optional tmux-based compatibility path, not a prerequisite for native Windows.

The npm postinstall and `forgebadger doctor` never install system software.
`doctor` is fully read-only: inspecting an empty state path does not create the
directory, runtime config, secrets, SQLite database, or recovery key.
`forgebadger start`/`init` may offer the fixed command only in an interactive
TTY outside CI; default No and any answer other than explicit `y`/`yes` leaves
the host unchanged. The CLI executes accepted commands without a shell and
rechecks afterward. If the runtime remains unready, both commands return
non-zero and stop before config/project-state creation or process startup.
Linux detection is limited to apt-get, dnf, yum, pacman, zypper, and apk.

For Unix-like hosts where `forgebadger doctor` reports `terminal tmux_missing`,
install tmux with the platform package manager, then re-run `forgebadger doctor`
before launching terminal sessions. Examples: `sudo apt install tmux` on
Ubuntu/Debian or `brew install tmux` on macOS.

## 5. Gateway Startup Behavior

On startup, Gateway must:

1. Open SQLite database.
2. Run or verify migrations.
3. Validate required env vars.
4. Scan `fb-*` platform-multiplexer sessions.
5. Recover matching DB sessions.
6. Kill orphan `fb-*` platform-multiplexer sessions.
7. Start HTTP and WebSocket server.

## 6. Common Failure Handling

| Failure | Expected behavior |
|---------|-------------------|
| Missing/outdated native Windows psmux | Abort CLI/Gateway startup before state initialization/listen and show the exact WinGet install/upgrade guidance |
| Missing `tmux` | Abort CLI/Gateway startup before state initialization/listen with allowlisted package-manager guidance |
| Missing Claude Code | Block session launch with adapter dependency error |
| API key decrypt fails | Block launch; do not create tmux session |
| Project under denied root | Reject before render/write/launch |
| node-pty attach fails | Keep tmux session if it exists; return terminal error |
| tmux session disappears | Mark session `exited` or `error` |
| Claude process exits | Send terminal exit event; mark session `exited` |
| WebSocket auth invalid | Reject before attaching to tmux |
| `capture-pane` fails | Attach anyway; show history restoration warning |
| config rollback fails | Return affected files for manual recovery |

## 7. Manual Multiplexer Inspection

Use `tmux` below on macOS/Linux/WSL and `psmux` on native Windows. PowerShell
users can omit the `grep` filter and inspect the bounded session list directly.

List ForgeBadger sessions:

```bash
tmux list-sessions | grep '^of-'
```

Attach manually:

```bash
tmux attach -t <session-name>
```

Capture pane:

```bash
tmux capture-pane -e -S -500 -t <session-name> -p
```

Kill orphan manually:

```bash
tmux kill-session -t <session-name>
```

Use manual cleanup only after confirming Gateway did not already reconcile the session.

## 8. Plan B: External Terminal Handoff

If Gate A fails:

1. Freeze embedded terminal UI deep work.
2. Continue project/config management only.
3. Show the user the generated platform multiplexer attach command.
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
