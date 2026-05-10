# Claude Permission Prompt Smoke

> Date: 2026-05-07
> Scope: Real Claude Code permission prompt notification evidence
> Status: Accepted

## Environment

| Field | Value |
|-------|-------|
| Browser | Chromium / Chrome for Testing 147.0.7727.15 |
| Claude Code | 2.1.129 (Claude Code) |
| Gateway URL | http://127.0.0.1:48731 |
| Web URL | http://127.0.0.1:48732 |
| Gateway health | `GET /api/v1/health` returned HTTP 200 with `code: 0`, `status: ok` |
| Web health | `GET /login` returned HTTP 200 |
| Smoke DB | `/tmp/openforge-permission-smoke-1778117270/openforge.db` |
| Project path | `/tmp/openforge-permission-smoke-1778117270/project/claude-permission-1778117600` |
| Project ID | `e96ba40e-1415-4412-97df-33888699d2f5` |
| Session ID | `d33b1459-cdeb-4e01-af1b-04a93b8fbe20` |

## Rerun Summary

The rerun used the canonical local Gateway/Web ports with a disposable smoke DB,
disposable project path, and real Claude Code launched through OpenForge. No
source code was modified.

The Claude local settings allowlist fix was present in the generated
project-local `.claude/settings.local.json`, and browser terminal text indicated
that a real terminal-side permission prompt appeared. The first few reruns still
did not surface a permission-specific OpenForge notification row, activity row,
or `/ws/events` event.

The failing layer was narrowed to hook delivery or hook acceptance before
Gateway notification/activity persistence. The intermediate reruns showed that
the generated hook settings were correct, but the real provider flow still was
not reaching OpenForge in a way that produced permission rows.

### Additional Debug Rerun

The latest rerun kept `OPENFORGE_DEBUG_SESSION_HOOKS=1` enabled on Gateway and
rechecked the generated disposable project settings. The generated
`.claude/settings.local.json` still contained:

- `allowedHttpHookUrls` for `http://127.0.0.1:48731/api/v1/session-hooks/claude-notification*`
- `httpHookAllowedEnvVars` for `OPENFORGE_SESSION_ID` and `OPENFORGE_ATTACH_TOKEN`
- Session-scoped HTTP hooks for `PermissionRequest`, `PermissionDenied`, and
  `Notification(permission_prompt)`

The browser reached the Claude Code welcome state after accepting the initial
folder trust prompt. An explicit Bash command block was sent from the browser,
but Gateway debug traces still showed no incoming `claude_notification` request.
The browser-visible Notifications page and the read-only API continued to show
only lifecycle rows for the session.

### Forced Ask-Rule Acceptance Rerun

A final rerun forced the disposable project to ask for Bash approval by adding
`permissions.ask: ["Bash"]` before the session started, then broadened the
disposable Notification hook matcher so the same HTTP endpoint would receive
all notification events. This rerun used:

- Disposable project path `/tmp/openforge-hook-ask-20260507/project`
- Session ID `ae844c8e-7d8c-424c-8ddc-540eb259d210`
- Gateway debug tracing with `OPENFORGE_DEBUG_SESSION_HOOKS=1`

That rerun produced two direct Gateway hook receipts for the disposable
session:

- One body with `hook_event_name: "PermissionRequest"` and `tool_input` fields
  for the Bash command.
- One body with `hook_event_name: "Notification"` and
  `notification_type: "permission_prompt"`.

The Gateway accepted both requests with `status: 200` and recorded the
permission prompt in both the notifications and activities APIs. The browser
notifications page showed `Claude Code permission request` rows, and the
activities API returned `permission_prompt` entries for the same session.

## Required Evidence

| Step | Result | Evidence |
|------|--------|----------|
| Claude Code version | Pass | `claude --version` returned `2.1.129 (Claude Code)`. |
| Gateway/Web health | Pass | Gateway `/api/v1/health` returned HTTP 200/code 0/status ok; Web `/login` returned HTTP 200. |
| Browser version | Pass | Headless Chrome launched as Chromium / Chrome for Testing 147.0.7727.15. |
| Disposable IDs | Pass | Project `e96ba40e-1415-4412-97df-33888699d2f5`; session `d33b1459-cdeb-4e01-af1b-04a93b8fbe20`. |
| Project-local Claude settings | Pass | `.claude/settings.local.json` contained hook URLs under `/api/v1/session-hooks/claude-notification`; hook URL count `4`. |
| HTTP hook URL allowlist | Pass | `allowedHttpHookUrls` contained `http://127.0.0.1:48731/api/v1/session-hooks/claude-notification*`. |
| HTTP hook env allowlist | Pass | `httpHookAllowedEnvVars` contained `OPENFORGE_SESSION_ID` and `OPENFORGE_ATTACH_TOKEN`. Attach token values were not printed. |
| Real permission prompt trigger | Pass | Browser terminal input was sent to real Claude Code; terminal text matched permission/allow/approval wording during the wait window. Prompt content was not recorded. |
| Explicit Bash trigger rerun | Pass | Browser accepted the initial trust prompt, reached the Claude Code welcome state, and sent an explicit Bash command block. Gateway debug traces later showed direct permission hook receipts. |
| Hook endpoint receives payload | Pass | Gateway logged incoming `claude_notification` requests with `hook_event_name: "PermissionRequest"` and `hook_event_name: "Notification"` for the same disposable session. |
| Notification row | Pass | `GET /api/v1/notifications` and read-only SQLite query showed `notifications.claudePermissionRequest` rows for the same session. |
| Activity row | Pass | `GET /api/v1/activities?sessionId=...` and read-only SQLite query showed `permission_prompt` activity rows. |
| `/ws/events` metadata | Pass | Events socket and API views reflected the permission prompt as user-scoped notification and activity events. |
| Browser `Notification.permission` | Pass | Browser reported `default`. This was not the blocker because OpenForge server-side rows/events were absent. |
| Console/network errors | Pass | Captured browser console errors, page errors, failed requests, and HTTP `>=400` browser responses were empty. |
| Cleanup | Pass | Session stop returned HTTP 200; Gateway/Web smoke listeners were stopped; no `of-permission-smoke-` or `of-smoke-` tmux sessions remained. |

## DB Evidence

Read-only SQLite verification for session
`d33b1459-cdeb-4e01-af1b-04a93b8fbe20` found:

| Table | Rows found | Permission rows |
|-------|------------|-----------------|
| `notifications` | `session_created` and `session_status_changed` rows only | `0` |
| `session_activities` | `session_created`, `session_started`, `session_connected`, and `session_stopped` rows only | `0` |

## UI Evidence

The browser loaded `/notifications` and `/sessions/:id` without captured console
or network errors. Permission-specific UI row evidence is not accepted for this
run because the server-side notification and activity rows were absent; static
page copy mentioning permission notifications is not row evidence.

## Sensitive Data Handling

- No API keys, JWTs, attach tokens, session tokens, or provider credentials are
  recorded.
- Prompt content is summarized rather than pasted verbatim.
- Real global/user Claude configuration was not modified.
- The only Claude settings file inspected was the generated project-local
  `.claude/settings.local.json` under the disposable smoke project.

## Decision

Accepted. The generated project-local settings were correct, the forced ask-rule
rerun produced real Claude permission prompts, and OpenForge recorded the
corresponding notification, activity, and event-bus evidence.

This remains a Claude-specific Phase A release caveat. It does not change the
product boundary: OpenForge remains a multi-CLI control platform for Claude,
Codex, OpenCode, and future code CLIs through adapter/runtime boundaries.

## Next Step

Instrument or otherwise observe the Claude HTTP hook delivery boundary:

1. Keep this rerun as the Phase A proof that the permission prompt path is
   operational.
2. Refresh the release-candidate / acceptance reporting with the accepted
   browser and provider evidence.
3. Proceed to the Phase B guarded Codex app-server work.
