# OpenForge Manual Smoke Test

> Status: local-first beta manual acceptance | Date: 2026-05-10

First-user trial runs should use `docs/TRIAL-CHECKLIST.md` as the execution
notes and feedback attachment. Keep this smoke test as the broader manual
acceptance checklist for maintainers.

Run this checklist before asking a user to try the local console, or when a
broader maintainer acceptance pass is needed. Use a disposable project
directory and a disposable SQLite database unless the goal is upgrade
validation.

## 1. Start Services

Use ports that match the user's SSH forwarding or local browser setup. Create
or update `.env` in the repository root so both Gateway and Web dev commands
load the same values:

```bash
OPENFORGE_HOST=127.0.0.1
OPENFORGE_PORT=48731
OPENFORGE_WEB_HOST=127.0.0.1
OPENFORGE_WEB_PORT=48732
OPENFORGE_GATEWAY_URL=http://127.0.0.1:48731
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731
OPENFORGE_DB_PATH=/tmp/openforge-smoke.db
OPENFORGE_MASTER_KEY=<64-hex-characters>
OPENFORGE_JWT_SECRET=<32+-character-secret>
```

Start Gateway, then Web in separate shells:

```bash
pnpm --dir packages/gateway dev
pnpm --dir packages/web exec next dev --hostname 127.0.0.1 --port 48732
```

Open `http://127.0.0.1:48732`.

Windows terminal acceptance must be run from WSL. Native Windows can be used
for management UI checks, but it is not accepted as evidence for tmux-backed
browser terminal sessions.

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

## 4. Template, Agent, Skill, Plugin

- Clone the built-in Claude Code template.
- Edit the cloned template and confirm a version history row is recorded.
- Create an Agent from a quick-create template and attach it to the project.
- Create a Skill from a quick-create template.
- Enable the Skill for the project and verify it appears in config preview.
- Run local Skill rescan and confirm discovered roots/counts appear.
- Install one catalog Skill or plugin package if a catalog source is available.
- Enable a Claude plugin and confirm the Plugins page explains it as a Claude
  Code plugin package, not a browser extension.

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
- Confirm an OpenForge notification and session activity are created for the
  permission prompt.

Fallback hook-path smoke from inside the tmux terminal:

```bash
printf '{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"Smoke permission request"}' \
  | curl -fsS -X POST "${OPENFORGE_GATEWAY_URL%/}/api/v1/session-hooks/claude-notification/${OPENFORGE_SESSION_ID}" \
      -H "content-type: application/json" \
      -H "x-openforge-session-token: ${OPENFORGE_ATTACH_TOKEN}" \
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

## 9. Copilot

- Maintainers can run the live provider harness before or during manual smoke:

  ```bash
  pnpm smoke:copilot-provider
  ```

  Without `OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY` or provider-specific
  disposable credentials, the harness records a skipped result. To require live
  evidence, set `OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1` plus
  `OPENFORGE_COPILOT_PROVIDER_SMOKE_PROVIDER`, `OPENFORGE_COPILOT_PROVIDER_SMOKE_MODEL`,
  and a disposable API key. The command must not print the plaintext key.
- Configure a disposable OpenAI or Anthropic provider profile with an active
  model and active test credential.
- Open `/copilot` from the sidebar.
- Ask Copilot to diagnose project or session launch readiness.
- Confirm the answer cites safe OpenForge state such as adapter discovery,
  dashboard health, recent activity, project detail, session detail, or
  diagnostics summary.
- If Copilot proposes an action, confirm it appears as a pending action before
  approval and that approve/reject updates the run without duplicate
  submission.
- If Copilot proposes a memory write, approve or reject it and confirm the
  prompt, stored memory text, and visible details do not expose pasted secrets.
- Confirm the page does not expose terminal input, raw shell execution,
  filesystem write controls, automatic tmux input, or Codex app-server `/turn`
  input.

## 10. Pass Criteria

Pass only when:

- No core page returns 404.
- No auth, project, session, model, Skill, Template, plugin, notification,
  usage, or history operation is blocked by `Failed to fetch`.
- Terminal attach, refresh reconnect, stop, restart, and delete behavior match
  the UI state.
- Permission notification smoke produces both notification and activity rows.
- Copilot can answer with safe platform state when a disposable provider,
  active model, and credential are configured, or any skipped Copilot step
  records the provider/environment reason.
- Any skipped step has a concrete environment reason.

## 11. Automation Boundary

Automated CI can cover workspace tests, builds, npm package smoke, Provider
regression, mocked Copilot page behavior, and the mocked Codex Background Tasks
Web smoke. It cannot replace these manual checks:

- real browser terminal attach, input/output, resize, refresh, and reconnect;
- real Claude Code permission prompt behavior;
- live Copilot prompt behavior against a disposable provider credential;
- physical Windows native versus WSL behavior;
- local operator review that diagnostics and logs do not contain secrets.

Record the host OS, shell, `openforge doctor` output, tmux version, Claude Code
version, and any skipped steps in `docs/TRIAL-CHECKLIST.md`.
