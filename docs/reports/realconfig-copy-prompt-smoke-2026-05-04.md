# Real Config Copy Prompt Smoke Report

Date: 2026-05-04
Workspace: `/tmp/openforge-realconfig-smoke-swCJ80`

## Isolation

Real config sources were read and copied into temporary locations:

- Claude source: `/root/.claude` and `/root/.claude.json`
- Codex source: `/root/.codex`
- OpenCode sources: `/root/.config/opencode` and `/root/.opencode`

Prompt smoke used only temporary environment variables:

- `HOME=/tmp/openforge-realconfig-smoke-swCJ80/home`
- `CLAUDE_CONFIG_DIR=/tmp/openforge-realconfig-smoke-swCJ80/home/.claude`
- `CODEX_HOME=/tmp/openforge-realconfig-smoke-swCJ80/codex-home`
- `XDG_CONFIG_HOME=/tmp/openforge-realconfig-smoke-swCJ80/xdg-config`
- `OPENCODE_CONFIG_DIR=/tmp/openforge-realconfig-smoke-swCJ80/xdg-config/opencode`

## Prompt Smoke Results

- Claude Code temporary-copy prompt: passed. Output included `OPENFORGE_SMOKE_OK`. A copied SessionEnd hook failed inside the temporary environment; source config was not intentionally modified.
- Codex temporary-copy prompt: passed. Output included `OPENFORGE_SMOKE_OK`. Codex emitted a warning about refusing helper binary creation under `/tmp`, but completed.
- OpenCode temporary-copy prompt: passed. Output included `OPENFORGE_SMOKE_OK`.

## Real Config Caveat

A real-directory mtime scan showed recent updates under `/root/.codex` and `/root/.claude/telemetry`. This environment itself is a Codex CLI session, so `/root/.codex` is actively written by the current agent runtime. Also, direct `--version` checks against real CLI defaults may write telemetry/log/state despite appearing read-only.

Because of that, future checks against real CLI directories must not run CLI commands without explicit approval, even for `--version`. Use filesystem reads only unless approved.

## Cleanup

Temporary copied config directories are removed after this report to avoid leaving copied credentials in `/tmp`.
