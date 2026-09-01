# ForgeBadger Manual Smoke Test

> Status: local-first beta manual acceptance | Date: 2026-05-10

First-user trial runs should use `docs/TRIAL-CHECKLIST.md` as the execution
notes and feedback attachment. Keep this smoke test as the broader manual
acceptance checklist for maintainers.

Phase 6 live provider and platform evidence is tracked in
`docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md`. Use that report as
the source of truth for `Pass`, `Caveat`, and `Blocked` status; do not remove
the live-provider caveat without disposable live provider evidence.
Phase 8 first-user readiness handoff is
`docs/reports/v1.1-readiness-closeout-2026-05-21.md`; use it with
`docs/TRIAL-CHECKLIST.md` and `docs/SUPPORT-DIAGNOSTICS.md` when routing trial
  support. The matrix remains the detailed manual/live gate source for live
  provider, physical Windows native psmux/WSL tmux, and Feishu bot
  long-connection evidence.

Run this checklist before asking a user to try the local console, or when a
broader maintainer acceptance pass is needed. Use a disposable project
directory and a disposable SQLite database unless the goal is upgrade
validation.

## 1. Start Services

Use ports that match the user's SSH forwarding or local browser setup. Create
or update `.env` in the repository root so both Gateway and Web dev commands
load the same values:

```bash
FORGEBADGER_HOST=127.0.0.1
FORGEBADGER_PORT=48731
FORGEBADGER_WEB_HOST=127.0.0.1
FORGEBADGER_WEB_PORT=48732
FORGEBADGER_GATEWAY_URL=http://127.0.0.1:48731
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
FORGEBADGER_DB_PATH=/tmp/forgebadger-smoke.db
FORGEBADGER_MASTER_KEY=<64-hex-characters>
FORGEBADGER_JWT_SECRET=<32+-character-secret>
```

Start Gateway, then Web in separate shells:

```bash
pnpm --dir packages/gateway dev
pnpm --dir packages/web dev
```

Source fallback scripts load the root `.env` without overriding variables
already present in the shell. For disposable smoke state, a command prefix such
as `FORGEBADGER_DB_PATH=/tmp/forgebadger-smoke.db pnpm --dir packages/gateway dev`
therefore takes precedence over the same key in `.env`.

Open `http://127.0.0.1:48732`.

Windows terminal acceptance has two explicit runtime variants: native Windows
uses psmux 3.3.8 or newer over ConPTY; WSL uses tmux 3.2 or newer. Native psmux
code/unit coverage is not acceptance evidence by itself. The external gate
remains `Caveat` until a physical Windows run exercises the browser terminal
and a real AI CLI through attach, input/output, resize, reconnect, Gateway
restart recovery, stop, and cleanup.

Before starting on the selected host:

```text
macOS/Linux/WSL: tmux -V
native Windows:  psmux -V
all platforms:   forgebadger doctor
```

On native Windows, install a missing runtime with
`winget install --id marlocarlo.psmux --exact --source winget`, or upgrade an
older runtime with
`winget upgrade --id marlocarlo.psmux --exact --source winget`. For first-run
prompt coverage, confirm `forgebadger start`/`init` defaults to No, accepts only
explicit `y`/`yes` in a TTY outside CI, and rechecks after installation. Do not
expect npm `postinstall` or `forgebadger doctor` to install system software.
If readiness is still false, confirm `start`/`init` return non-zero and do not
create runtime/project state or start Gateway/Web. Against an absent disposable
state directory, confirm `doctor` reports `(not initialized)` and leaves the
path absent. Direct Gateway source startup must likewise fail before account
recovery, database/session recovery, or listen side effects.

## 2. Auth And Shell

- Register a new user.
- Log out and log back in.
- Confirm the dashboard, sidebar, language switch, settings page, and
  notifications page load without browser console fetch errors.
- Press `Ctrl+B` or `Cmd+B` and confirm the desktop sidebar toggles.
- Press `Ctrl+K` or `Cmd+K` and confirm the command palette opens and can
  navigate to Projects.

## 3. Project And Config

- Create a new project under a disposable path.
- Import an existing disposable project path.
- Open the project detail page.
- Preview config with the built-in Claude Code template.
- Apply config.
- Re-run apply when generated files are identical and confirm identical
  conflicts are skipped without blocking the import or sync.
- Modify one generated file, preview again, and confirm an explicit skip or
  overwrite decision is required.
- Confirm config compliance reports compliant after a clean sync.

## 4. Template, Agent, Skill

- Clone the built-in Claude Code template.
- Edit the cloned template and confirm a version history row is recorded.
- Create an Agent from a quick-create template and attach it to the project.
- Create a Skill from a quick-create template.
- Enable the Skill for the project and verify it appears in config preview.
- Run local Skill rescan and confirm discovered roots/counts appear.
- Install one catalog Skill package if a catalog source is available.
- Open the Skill list on a fresh user and confirm the three builtin skills
  (code-review, safe-edits, github-context) appear once and stay enabled.

## 5. Model And API Key

- Create an Anthropic model.
- Add an API key and confirm the plaintext key is not shown after save.
- Set a default model.
- Rotate or delete the test key and confirm the list updates.

## 6. Session And Terminal

- Create a Claude session for the smoke project using host environment
  credentials or a disposable stored API key.
- Connect to the session terminal.
- Confirm xterm renders full height and accepts input.
- Resize the browser and confirm the terminal reflows.
- Enter terminal focus mode and confirm the activity rail hides.
- Refresh the browser and reconnect to the same session.
- Stop the session and confirm reconnect/start/delete controls behave
  consistently.

## 7. Claude Permission Notification

Preferred manual path:

- In the Claude Code terminal, trigger an action that requires permission.
- Confirm an ForgeBadger notification and session activity are created for the
  permission prompt.

Fallback hook-path smoke from inside the tmux terminal:

```bash
printf '{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"Smoke permission request"}' \
  | curl -fsS -X POST "${FORGEBADGER_GATEWAY_URL%/}/api/v1/session-hooks/claude-notification/${FORGEBADGER_SESSION_ID}" \
      -H "content-type: application/json" \
      -H "x-forgebadger-session-token: ${FORGEBADGER_ATTACH_TOKEN}" \
      --data-binary @-
```

Expected response:

```json
{"code":0,"data":{"accepted":true},"message":""}
```

Then confirm the Notifications page and session Activity panel show a
permission prompt event.

## 8. Usage And History

- Open Usage and confirm session/model/project aggregates render.
- Open History and confirm session snapshots can be filtered.
- Start or reconnect a session and confirm the snapshot list changes after
  Gateway records session state.

## 9. Native Copilot

- Open `/copilot` from the sidebar and confirm conversation history, model
  status, memory, tool activity, and approval UI render.
- Confirm there is no Portfolio Operations navigation item and `/portfolio`
  does not render an application workspace.
- Send a bounded message through Copilot and confirm the request uses
  `/api/v1/copilot/**` and the Gateway-owned runtime.
- Exercise one approval-gated action and confirm free-form chat does not approve
  it, duplicate decisions do not duplicate side effects, and rejection is
  persisted.
- Confirm Copilot and event payloads never expose credentials, raw provider
  bodies, terminal transcripts, or cross-tenant data.
- Confirm Feishu account/configuration administration works independently and
  no Feishu message is routed into Copilot or terminal input.

## 10. Pass Criteria

Pass only when:

- No core page returns 404.
- No auth, project, session, model, Skill, Template, plugin, notification,
  usage, or history operation is blocked by `Failed to fetch`.
- Terminal attach, refresh reconnect, stop, restart, and delete behavior match
  the UI state.
- Permission notification smoke produces both notification and activity rows.
- Copilot conversation, approval, memory, and safe event behavior match the canonical persisted state.
- Any skipped step has a concrete environment reason.

## 11. Automation Boundary

Automated CI can cover workspace tests, builds, npm package smoke, provider
regression, native Copilot/Feishu account tests, and authenticated Copilot Web
smoke. It cannot replace these manual checks:

The current CI and `pnpm smoke:npm` runtime path is Ubuntu/Linux with tmux;
neither command is native Windows psmux/ConPTY coverage.

- real browser terminal attach, input/output, resize, refresh, and reconnect;
- real Claude Code permission prompt behavior;
- real Feishu bot long-connection/WebSocket receive, routing, reply or
  pending-action, and reconnect behavior; automated signed-route regressions,
  `pnpm smoke:feishu-bot-websocket`, authenticated `/bot-websocket/*` smoke
  paths, and `lark-cli` preflight alone do not clear the gate. Use
  `pnpm smoke:feishu-bot-live -- --require-gate-evidence --output
  <report.json>` with a real self-built Feishu bot, ForgeBadger token, and
  operator-induced reconnect to collect gate-clearing evidence, then run
  `pnpm evidence:feishu-bot-live-audit -- <report.json>` and
  `pnpm evidence:feishu-bot-live-report -- --report <report.json> --output
  <report.md>` before maintainer review;
- physical Windows native ConPTY/psmux versus WSL tmux behavior;
- local operator review that diagnostics and logs do not contain secrets.

Record the host OS, shell, `forgebadger doctor` output, selected runtime and
version (`psmux -V` or `tmux -V`), AI CLI version, and any skipped steps in
`docs/TRIAL-CHECKLIST.md`. Keep output bounded and redacted; do not attach raw
terminal transcripts.
