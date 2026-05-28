# OpenForge First-User Trial Troubleshooting

> Status: first-user local beta trial support | Date: 2026-05-10

This guide covers the first-user trial path in
[TRIAL-RUNBOOK.md](TRIAL-RUNBOOK.md). It is not a public release guide.

Use the table by matching the visible symptom first, then checking the likely
cause before applying the smallest fix or workaround.

## Core Dependencies

| Symptom | Likely cause | Check | Fix or workaround |
| --- | --- | --- | --- |
| `openforge doctor` reports `tmux` missing, the terminal never starts, or session attach fails immediately. | `tmux` is not installed, is below the supported version, or cannot create sessions in this environment. | Run `tmux -V` and `tmux new-session -d -s of-check 'sleep 5'`; then run `tmux list-sessions`. | Install `tmux` 3.2 or newer. If `tmux new-session` fails, run the trial in a normal local shell instead of a restricted shell/container that blocks pty or tmux use. |
| `openforge doctor` reports `terminal wsl_required`, or native Windows starts the UI but terminal sessions cannot launch. | OpenForge persists browser terminal sessions with tmux; native Windows is not the supported terminal runtime. | Run `openforge doctor` and check the `terminal` line. In PowerShell or cmd, expect `wsl_required`; inside WSL, run `tmux -V`. | Run OpenForge from a WSL shell with Node.js, tmux, and the target AI CLI installed inside WSL. Use native Windows only for management UI checks, not for the built-in terminal path. |
| Claude Code session creation fails, the browser terminal opens but the CLI command is not found, or the wrong Claude Code version appears. | Claude Code is missing, not on `PATH`, shadowed by another binary, or too old for the expected prompt behavior. | Run `command -v claude` and `claude --version` in the same shell used to start OpenForge. Compare with the path shown by `openforge doctor` if available. | Install or update Claude Code, then restart OpenForge from a shell where `claude` resolves correctly. If multiple versions exist, put the intended binary earlier on `PATH`. |
| OpenCode or Codex checks fail during exploration, but Claude Code works. | Optional OpenCode/Codex CLIs are not installed. They are non-blocking for the A-stage Claude Code trial path. | Run `opencode --version` and `codex --version`. | Continue the Claude Code trial. Install OpenCode or Codex only if you are testing those optional adapters. Do not treat missing optional CLIs as a first-user trial blocker. |

## Startup And Loopback

| Symptom | Likely cause | Check | Fix or workaround |
| --- | --- | --- | --- |
| Gateway or Web startup fails with `EADDRINUSE`, health checks hit another process, or the browser opens the wrong app. | Loopback port conflict on the trial ports. | Check the configured ports, then run `curl --noproxy '*' -i http://127.0.0.1:48731/api/v1/health` and `curl --noproxy '*' -i http://127.0.0.1:48732/login`. | Stop the conflicting process or restart OpenForge with different Gateway and Web ports. For source fallback, keep `OPENFORGE_GATEWAY_URL` and `NEXT_PUBLIC_GATEWAY_URL` aligned with the Gateway port. |
| Gateway or Web cannot bind `127.0.0.1`, or Chrome/Playwright cannot connect from the test process. | Restricted environment, sandbox, container networking, or loopback binding policy. | Confirm the exact bind host and port in startup logs. Run the two `curl --noproxy '*'` checks from the same environment that will open the browser or run Playwright. | Use a normal local shell with loopback access. If a container is required, expose and map the Gateway and Web ports explicitly and keep browser checks inside the same network namespace. |
| Health checks fail only when normal `curl` is used, or they appear to go through an unrelated proxy. | Proxy environment variables are intercepting loopback requests. | Run `env | rg -i 'proxy'` and compare normal `curl` with `curl --noproxy '*'`. | Use `curl --noproxy '*'` for local OpenForge checks. If needed, add `127.0.0.1,localhost` to `NO_PROXY` for the shell that starts OpenForge. |
| Chrome/Playwright fails to launch or Next/Turbopack fails with `Operation not permitted`. | Sandbox limits prevent browser launch, worker process creation, socket operations, or Turbopack internals. | Read the first failing log line and confirm whether it mentions Chrome, Playwright, Next, Turbopack, or `Operation not permitted`. | Treat this as an environment limitation first. Re-run in a less restricted shell or CI profile. For local Web startup, try the documented Next command from the runbook and capture the full error if it still fails. |

## Automation Boundary

If automated tests pass but the user still sees a terminal failure, prefer the
manual evidence path over the CI result. Unit tests and mocked Playwright can
prove API contracts and Web safety boundaries, but they do not prove physical
host tmux behavior, real browser terminal input/output, real Claude Code
permission prompts, or native Windows versus WSL terminal support.

## Secrets And State

| Symptom | Likely cause | Check | Fix or workaround |
| --- | --- | --- | --- |
| Gateway refuses to start, login tokens fail after restart, encrypted values cannot be read, or logs mention `OPENFORGE_MASTER_KEY`. | `OPENFORGE_MASTER_KEY` is missing, malformed, changed between runs, or weaker than expected. | For source fallback, inspect the environment without printing secrets into shared logs. The preferred value is a 64-character hex key from `openssl rand -hex 32`. | Set a stable `OPENFORGE_MASTER_KEY` before starting Gateway. Do not rotate it for an existing database unless you are intentionally discarding encrypted local trial state. |
| Gateway refuses to start, authentication fails, or logs mention `OPENFORGE_JWT_SECRET`. | `OPENFORGE_JWT_SECRET` is missing, too short, or changed between Gateway restarts. | Confirm the variable is present in the same shell that starts Gateway. Use a random value with at least 32 characters for source fallback. | Set a stable `OPENFORGE_JWT_SECRET` and restart Gateway. Existing browser sessions may need logout/login after a secret change. |
| Gateway starts but account creation, project creation, or session creation fails with a Database write error. | Database path is not writable, parent directory does not exist, or file permissions belong to another user. | Check `OPENFORGE_DB_PATH`, then run `test -w "$(dirname "$OPENFORGE_DB_PATH")"` for source fallback. For npm/CLI startup, check the active state directory. | Create the parent directory, fix ownership/permissions, or set `OPENFORGE_DB_PATH` to a writable local path such as `/tmp/openforge-trial/openforge.db` for disposable source fallback. |
| Source fallback ignores an intended disposable database or port override. | The shell running Gateway/Web may not actually contain the prefixed variable, or another terminal is still running an older process. | Start Gateway with an explicit prefix such as `OPENFORGE_DB_PATH=/tmp/openforge-trial/openforge.db pnpm --dir packages/gateway dev`, then confirm the target file is created. | Restart the affected Gateway/Web process. Current source scripts preserve command-prefix env over root `.env`; if the override still does not apply, verify the command was run from a fresh shell and that no old process is serving the port. |
| npm trial shows old users, old projects, unexpected defaults, or stale sessions. | The npm/CLI trial is reusing existing default state, usually under `~/.openforge` or the configured `OPENFORGE_STATE_DIR`. | Check startup logs for the state directory. Inspect whether `OPENFORGE_STATE_DIR` is set. | Use a disposable `OPENFORGE_STATE_DIR` for a fresh trial. Do not delete `~/.openforge` unless you intentionally want to remove all local OpenForge trial state. |

## Terminal And WebSocket

| Symptom | Likely cause | Check | Fix or workaround |
| --- | --- | --- | --- |
| Browser terminal fails to connect, reconnect loops, or Network shows WebSocket 401/403. | WebSocket auth token is missing, expired, or belongs to another local state/database. | In browser devtools, inspect the `/ws/terminal/:sessionId` request status. Log out and log back in, then retry the same session. | Refresh auth by logging in again. Confirm Web and Gateway point to the same Gateway URL and database state. If using source fallback, verify `NEXT_PUBLIC_GATEWAY_URL` matches the running Gateway. |
| Terminal attach fails after session creation, or output is blank even though the session exists. | tmux session name mismatch, tmux session exited, pty attach failed, or the CLI process failed before output was captured. | Run `tmux list-sessions | rg '^of-'` and inspect Gateway logs for the session id. If safe, run `tmux capture-pane -e -S -500 -t <tmux-session-name>`. | Reopen the terminal from the session page. If the tmux session is gone, create a new session. If the pane shows CLI startup errors, fix the underlying CLI or project path issue first. |
| Reopening a session does not show recent terminal history. | `tmux capture-pane` cannot read the pane, the pane has no scrollback, or the wrong tmux target is used. | Run `tmux capture-pane -e -S -500 -t <tmux-session-name>` and confirm whether expected history appears outside OpenForge. | Keep the tmux session running and retry attach. If capture output is empty outside OpenForge too, collect tmux status and Gateway logs; terminal history is expected to come from tmux, not SQLite. |
| Opening the same terminal in a second browser tab disconnects the first tab. | OpenForge allows one active WebSocket per terminal session; the newest terminal connection replaces the previous one. | Watch the first tab when opening the same session in a second tab. Check Gateway logs for replacement or disconnect messages. | Use one active browser terminal per session. If you need side-by-side work, create a separate OpenForge session instead of attaching the same terminal twice. |
| Browser close, refresh, or Gateway restart appears to leave CLI work running. | This is expected tmux persistence. Browser and Gateway lifecycle should not kill the underlying tmux-backed CLI session by itself. | Close the browser or stop Gateway, then run `tmux list-sessions | rg '^of-'`. Restart Gateway/Web and reopen the session. | Treat this as normal persistence. Stop the session from the Web console when you intend to end it. Kill a tmux session manually only after confirming it is no longer needed. |

## Skill Discovery

| Symptom | Likely cause | Check | Fix or workaround |
| --- | --- | --- | --- |
| Skill Discovery shows unexpected local sources or more Skill roots than the first-user trial needs. | Local Skill discovery should default to `${CLAUDE_CONFIG_DIR:-~/.claude}/skills` and `${AGENTS_HOME:-~/.agents}/skills`, plus any explicit `OPENFORGE_SKILL_DIRS` override. In the root-owned trial server those defaults appear as `/root/.claude/skills` and `/root/.agents/skills`. | In the Skills page or diagnostics output, compare displayed roots with the expected A-stage roots and inspect `OPENFORGE_SKILL_DIRS`, `CLAUDE_CONFIG_DIR`, and `AGENTS_HOME` in the Gateway startup environment. | Remove unintended `OPENFORGE_SKILL_DIRS` entries or start Gateway with the intended Claude/Agents home directories. Include the displayed roots in feedback if stale Skill rows remain after local rescan. |
