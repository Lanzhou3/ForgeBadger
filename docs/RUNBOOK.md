# OpenForge Runbook

> Status: MVP-0 baseline | Date: 2026-04-26

This runbook captures operational checks and failure handling for the MVP-0 Claude Code local control loop.

First-user local trial startup now begins in [TRIAL-RUNBOOK.md](TRIAL-RUNBOOK.md).
Use this runbook for deeper operational notes, dependency checks, failure
handling, and manual tmux inspection after the trial path needs more detail.

## 1. Required Local Dependencies

NPM runtime:

- Node.js 20+
- tmux 3.2+
- SQLite-compatible filesystem

Optional runtime dependencies:

- Claude Code CLI, OpenCode, and/or Codex on `PATH`, only for the corresponding
  real CLI sessions.

Optional during development:

- pnpm
- compiler toolchain for native modules
- Playwright browsers for E2E tests

## 2. Environment Variables

Required for direct Gateway/source startup:

- `OPENFORGE_MASTER_KEY` - preferred 64-character hex key for AES-256-GCM; legacy 32-byte strings are still accepted
- `OPENFORGE_JWT_SECRET` - JWT signing secret

Optional:

- `OPENFORGE_PORT` - default `3000`
- `OPENFORGE_DB_PATH` - default `~/.openforge/openforge.db`
- `OPENFORGE_LOG_LEVEL` - default `info`
- `OPENFORGE_TMUX_PREFIX` - default `of-`

For npm CLI startup, do not hand-create `OPENFORGE_MASTER_KEY` or
`OPENFORGE_JWT_SECRET`. The CLI generates them on first startup and stores
runtime state under `~/.openforge` by default. Set `OPENFORGE_STATE_DIR` to use
a different state directory for config, database, logs, and runtime files.

## 3. Dependency Checks

Before Gate A:

```bash
node --version
tmux -V
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
- tmux is installed.
- pnpm is installed for source development workflows.
- Claude Code, OpenCode, or Codex is available on `PATH` only when that adapter
  is being used for real sessions.

## 4. NPM CLI Startup

Use the installed CLI for local npm-distributed runtime checks:

```bash
openforge doctor
openforge start --gateway-port 48731 --web-port 48732
```

`openforge start` starts the Gateway/Web child processes and prints the Web
console URL. If the browser cannot connect immediately, wait for initialization
or inspect logs and `openforge doctor` output. Runtime state defaults to
`~/.openforge`; use `OPENFORGE_STATE_DIR` when testing against disposable state
or running multiple isolated installs.

## 5. Gateway Startup Behavior

On startup, Gateway must:

1. Open SQLite database.
2. Run or verify migrations.
3. Validate required env vars.
4. Scan `of-*` tmux sessions.
5. Recover matching DB sessions.
6. Kill orphan `of-*` tmux sessions.
7. Start HTTP and WebSocket server.

## 6. Common Failure Handling

| Failure | Expected behavior |
|---------|-------------------|
| Missing `tmux` | Block session launch with dependency error and install guidance |
| Missing Claude Code | Block session launch with adapter dependency error |
| API key decrypt fails | Block launch; do not create tmux session |
| Project under denied root | Reject before render/write/launch |
| node-pty attach fails | Keep tmux session if it exists; return terminal error |
| tmux session disappears | Mark session `exited` or `error` |
| Claude process exits | Send terminal exit event; mark session `exited` |
| WebSocket auth invalid | Reject before attaching to tmux |
| `capture-pane` fails | Attach anyway; show history restoration warning |
| config rollback fails | Return affected files for manual recovery |

## 7. Manual tmux Inspection

List OpenForge sessions:

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
3. Show user the generated `tmux attach` command.
4. Record failure reason and required fix.
5. Revisit embedded terminal after the POC blocker is resolved.

## 9. CLI Project Bootstrap

The MVP-5 `openforge init` prototype can generate OpenForge project config
without opening the Web console:

```bash
pnpm openforge -- init --path /path/to/project --dry-run
pnpm openforge -- init --path /path/to/project --template-id builtin-claude-code
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
