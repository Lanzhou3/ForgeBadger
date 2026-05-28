# OpenForge First-User Trial Runbook

> Status: first-user local beta trial | Date: 2026-05-10

This is the single entry point for a local OpenForge first-user trial. It is not
a public release guide. Use it to start OpenForge, run the core Claude Code
browser terminal path, collect diagnostics, and submit feedback. Prefer the
GitHub issue form `OpenForge first-user trial feedback` when filing feedback;
use `docs/TRIAL-FEEDBACK.md` as the offline copy/paste template.

To start from a local Markdown draft, run:

```bash
pnpm trial:feedback-draft -- --output /tmp/openforge-trial-feedback.md
```

The draft pre-fills bounded environment metadata only. It is not submitted,
not reviewed, and not gate-clearing evidence until a user completes it, reviews
redaction, and links or attaches it through the feedback path.

Before a completed Markdown packet is used for maintainer triage, run:

```bash
pnpm trial:feedback-audit -- /tmp/openforge-trial-feedback.md
```

Passing audit means ready for human triage only. It does not automatically
clear `FIRST-USER-FEEDBACK`.

If feedback was filed through the GitHub issue form, a maintainer can audit
the issue body directly:

```bash
pnpm trial:feedback-issue-audit -- --issue=<number>
```

This command reads the issue through GitHub CLI, converts the issue-form body
to the same packet shape, and applies the packet audit. It is read-only and
does not comment on the issue, attach artifacts, or clear any external gate.

Before editing the trial runbook, checklist, feedback template, or GitHub issue
form, run:

```bash
pnpm trial:intake-validate
```

This checks the trial intake materials stay aligned. It does not collect
evidence, submit feedback, or clear any external gate.

Before a maintainer starts a real trial collection round, optionally verify the
GitHub follow-up routes:

```bash
pnpm trial:issue-routes-validate
```

This requires GitHub CLI access to `Lanzhou3/OpenForge` and checks that issue
#3, #4, and #5 still exist, are open, and match their expected routing labels.
It does not create or update GitHub issues and does not clear any external
gate.

To run the local intake, issue-route, and gate-registry preflights together,
use:

```bash
pnpm trial:readiness-validate
```

This command is also read-only. Passing readiness means the trial materials,
route issues, and gate registry are aligned for a real collection round. It
does not collect feedback, submit issues, attach artifacts, or clear any
external gate.

The primary path is the npm/CLI startup. Source startup is a fallback for local
debugging and contribution.

## 1. Required Dependencies

Check local tools before starting:

```bash
node --version
tmux -V
claude --version
```

Required:

- Node.js 20 or newer.
- `tmux` 3.2 or newer.
- Claude Code CLI on `PATH` for the main terminal smoke path.
- A local shell where OpenForge can bind loopback ports.

Windows users should run the terminal trial inside WSL. Native Windows can open
the management UI, but the built-in persistent browser terminal depends on
tmux and is not treated as supported without WSL.

For a Windows evidence pass, record both sides explicitly:

1. Run `openforge doctor` from native Windows and record the terminal runtime
   warning.
2. Run the terminal trial from WSL with Node.js, tmux, and Claude Code installed
   inside WSL.
3. Treat only the WSL run as evidence for browser terminal attach, input,
   resize, refresh/reconnect, and stop behavior.

Required only for source fallback:

```bash
pnpm --version
```

- pnpm 9 or newer. The repository currently pins pnpm through
  `packageManager`.

Optional for later exploration only:

```bash
opencode --version
codex --version
```

- OpenCode CLI.
- Codex CLI.

Missing optional CLIs should not block the Claude Code first-user trial.

## 2. Primary Startup: npm/CLI

Install the trial package if the `openforge` command is not already available:

```bash
npm install -g openforge
```

Run the doctor first:

```bash
openforge doctor
```

On native Windows, or when `tmux` is missing, `openforge doctor` reports that
the terminal runtime is unsupported and points to WSL or tmux installation.
`openforge start` may still start the management services, but terminal session
launch should be treated as blocked until the runtime warning is fixed.

Start Gateway and Web on the trial ports:

```bash
openforge start --gateway-port 48731 --web-port 48732
```

Expected:

- Gateway listens on `127.0.0.1:48731`.
- Web listens on `127.0.0.1:48732`.
- The CLI prints the Web console URL.
- Runtime state defaults to `~/.openforge` unless `OPENFORGE_STATE_DIR` is set.

Open:

```text
http://127.0.0.1:48732/login
```

For npm/CLI startup, do not hand-create secrets unless you are intentionally
testing custom state. The CLI should create local runtime state for the trial.

## 3. Source Fallback Startup

Use this path if the npm/CLI startup fails or you are reproducing a trial defect
from a checkout.

Install dependencies:

```bash
pnpm install
```

Create or update `.env` with source runtime values:

```bash
OPENFORGE_HOST=127.0.0.1
OPENFORGE_PORT=48731
OPENFORGE_WEB_HOST=127.0.0.1
OPENFORGE_WEB_PORT=48732
OPENFORGE_GATEWAY_URL=http://127.0.0.1:48731
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
OPENFORGE_DB_PATH=/tmp/openforge-trial/openforge.db
OPENFORGE_MASTER_KEY=<64-character-hex-key-from-openssl-rand-hex-32>
OPENFORGE_JWT_SECRET=<32-or-more-random-characters>
OPENFORGE_TMUX_PREFIX=of-trial-
```

Generate local secrets when needed:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

Start Gateway:

```bash
pnpm --dir packages/gateway dev
```

In another terminal, start Web:

```bash
pnpm --dir packages/web dev
```

The source fallback dev scripts load repository root `.env` values while
preserving environment variables that are already set in the shell. This lets
operators run an isolated trial by prefixing a specific variable, for example
`OPENFORGE_DB_PATH=/tmp/openforge-trial/openforge.db pnpm --dir packages/gateway dev`.

Open:

```text
http://127.0.0.1:48732/login
```

## 4. Ports And Health Checks

Default trial ports:

- Gateway: `48731`
- Web: `48732`

Use `curl --noproxy '*'` so local proxy settings do not hide loopback failures:

```bash
curl --noproxy '*' -i http://127.0.0.1:48731/api/v1/health
curl --noproxy '*' -i http://127.0.0.1:48732/login
```

Expected Gateway result:

- HTTP 200.
- JSON envelope with `code: 0`.

If either port is already in use, stop the conflicting process or restart
OpenForge with different ports. Keep Gateway and Web URLs aligned in the env
vars when using source fallback.

## 5. Trial Flow

Follow this path in order and record the exact point of any failure.

1. Open `/login`.
2. Register a local user, or log in with an existing local trial user.
3. Create a new project or import a local project.
4. Select the Claude Code template.
5. Preview generated config.
6. Apply generated config.
7. Create a Claude Code session for the project.
8. Open the browser terminal.
9. Type a simple command or prompt and confirm terminal input and output are
   visible.
10. Resize the browser window or terminal pane and confirm the terminal remains
    usable.
11. Refresh the browser and confirm reconnect attaches to the same session.
12. Stop the session from the Web console.
13. Restart Gateway and Web, then confirm existing tmux-backed sessions recover
    or show the expected stopped state.
14. Export diagnostics if anything fails or behaves unexpectedly.
15. Submit feedback with environment, commands, diagnostics, screenshots or logs,
    expected behavior, and actual behavior.

Claude Code permission prompt behavior can vary by Claude Code version and local
configuration. If you encounter a permission prompt, include what appeared in
the browser terminal and whether the session remained usable.

## 6. Diagnostics

Collect diagnostics before changing local state after a failure.

Diagnostics export is local-only and authenticated. Diagnostics are not
uploaded automatically.

First-user path:

1. Log in to the Web console.
2. Open Settings.
3. Click **Export diagnostics JSON**.
4. Attach the downloaded redacted diagnostics file to the issue or handoff note
   after reviewing it.

Maintainer-only fallback:

- If the Web export cannot be used, a maintainer may collect diagnostics
  through the authenticated local API using their own existing authenticated
  environment.
- Do not ask first users to retrieve browser auth tokens from developer tools.
- Do not paste tokens, API keys, passwords, JWTs, attach tokens, private keys,
  project secrets, provider payloads, Feishu bodies, local databases, `.env`
  files, private AI CLI config, or raw terminal transcripts into feedback,
  screenshots, shared logs, or issues.

Recommended feedback attachments:

- `openforge doctor` output.
- Diagnostics export output after redaction review.
- Gateway and Web startup command output.
- Gateway health check output.
- Browser console errors.
- Browser network failure details for API or WebSocket requests.
- Session id and project path.
- Claude Code version.
- Screenshots when they make the failure easier to understand.

Optional draft helper:

```bash
pnpm trial:feedback-draft -- --output /tmp/openforge-trial-feedback.md
```

Review and complete the draft before sharing. It intentionally leaves
diagnostics, reproduction steps, expected behavior, actual behavior, severity,
owner, disposition, and redaction review as human-filled fields.

After completing and redacting a Markdown packet, run:

```bash
pnpm trial:feedback-audit -- /tmp/openforge-trial-feedback.md
```

After filing feedback through the GitHub issue form, a maintainer can run:

```bash
pnpm trial:feedback-issue-audit -- --issue=<number>
```

After editing trial intake materials, run:

```bash
pnpm trial:intake-validate
```

If routing feedback to the existing GitHub follow-up issues, a maintainer can
rerun:

```bash
pnpm trial:issue-routes-validate
```

Before a real collection round, a maintainer can run all preflight validators:

```bash
pnpm trial:readiness-validate
```

Do not upload secrets, API keys, plaintext credentials, local private keys, or
private project source unless you intentionally choose to share them.

## 7. Shutdown

For npm/CLI startup, stop the foreground `openforge start` process with
`Ctrl-C`.

For source fallback, stop both foreground dev processes with `Ctrl-C`:

- `pnpm --dir packages/gateway dev`
- `pnpm --dir packages/web dev`

OpenForge sessions are tmux-backed. Stopping Gateway or Web should not kill a
running CLI session by itself.

## 8. Cleanup

List OpenForge tmux sessions:

```bash
tmux list-sessions | grep '^of-'
```

Kill a trial tmux session only after confirming it is no longer needed:

```bash
tmux kill-session -t <session-name>
```

## 9. What CI Cannot Prove

CI covers static checks, package smoke, Provider/Codex boundary tests, and a
mocked Codex Background Tasks Web smoke. First-user acceptance still needs
manual evidence for the real browser terminal path, real Claude Code permission
prompt behavior, physical Windows/WSL behavior, and local diagnostics redaction
review.

Remove disposable source fallback state only if you used the example path:

```bash
rm -rf /tmp/openforge-trial
```

Remove npm/CLI trial state only if you intentionally used disposable state:

```bash
rm -rf <your-openforge-state-dir>
```

Do not remove `~/.openforge` unless you are intentionally deleting all local
OpenForge trial state.

## 9. Related Trial Materials

- [Trial checklist](TRIAL-CHECKLIST.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Trial feedback template](TRIAL-FEEDBACK.md)
- [Browser terminal smoke report](reports/browser-terminal-smoke-2026-05-06.md)
- [Trial readiness report](reports/trial-readiness-2026-05-06.md)
