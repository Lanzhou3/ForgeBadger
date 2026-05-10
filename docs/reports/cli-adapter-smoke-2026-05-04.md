# OpenForge CLI Adapter Smoke Report

Date: 2026-05-04
Workspace: `/tmp/openforge-cli-smoke-ru5Wfy`
Gateway: `127.0.0.1:48731`
Web: `127.0.0.1:48732`
Isolation: temporary DB, temporary projects, `OPENFORGE_TMUX_PREFIX=of-smoke-`, temporary `HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `OPENCODE_CONFIG_DIR` for Gateway-launched sessions.

## Preflight

- `claude --version`: `2.1.126 (Claude Code)`
- `opencode --version`: `1.14.28`
- `codex --version`: `codex-cli 0.128.0` with warning: `could not update PATH: Read-only file system`
- `tmux -V`: `tmux 3.4`
- `node --version`: `v24.14.1`
- `pnpm --version`: `10.33.2`

## Service Smoke

- Gateway `/api/v1/health`: HTTP 200, `{ code: 0, data: { status: "ok" } }`
- Web `/`: HTTP 200, `text/html`

## Adapter Discovery

First discovery had a transient OpenCode timeout at 3000ms. A repeat discovery in the same isolated Gateway process reported all adapters available:

- Claude Code: available, launch enabled, `2.1.126 (Claude Code)`
- OpenCode: available, launch enabled, `1.14.28`
- Codex CLI: available, launch enabled, `codex-cli 0.128.0`

## Session Smoke

For each adapter, the script registered a disposable user, created a disposable project, generated config, created a host-environment session, connected to `/ws/terminal/:sessionId` with protocol-based JWT auth, observed terminal output, then stopped the session.

- Claude Code: project create ✅, config generation ✅, session create ✅, terminal attach/output ✅, stop ✅
- OpenCode: project create ✅, config generation ✅, session create ✅, terminal attach/output ✅, stop ✅
- Codex CLI: project create ✅, config generation ✅, session create ✅, terminal attach/output ✅, stop ✅

Raw JSON evidence: `docs/reports/cli-adapter-smoke-results-2026-05-04.json`

## Cleanup

- `tmux list-sessions -F '#{session_name}' | rg '^of-smoke-'`: no leftover smoke tmux sessions.
- Gateway and Web smoke processes were stopped; ports `48731` and `48732` no longer listen.

## Remaining Manual Acceptance

This smoke intentionally did not send prompts to the CLIs or trigger real provider permission flows, because the requirement was to avoid modifying the installed CLIs' own files and global configuration. Provider-level prompt/permission smoke should only be run with explicit approval for how to isolate or snapshot each CLI's real config.
