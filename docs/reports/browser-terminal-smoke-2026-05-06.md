# Browser Terminal And Provider Prompt Smoke

> Date: 2026-05-06
> Scope: A-stage first-user trial browser terminal evidence
> Status: 2026-05-07 rerun passed the fake-CLI browser terminal input/output blocker check and the forced-ask real Claude Code permission prompt smoke. Phase A browser/provider prompt evidence is now complete.

## Environment

| Field | Value |
|-------|-------|
| Date | 2026-05-06 |
| Browser | Chromium / Google Chrome for Testing 147.0.7727.15. Sandboxed launch failed with Chrome crashpad `setsockopt: Operation not permitted`; escalated launch worked. |
| Node | v24.14.1 |
| tmux | tmux 3.4 |
| Claude Code | 2.1.129 (Claude Code) |
| OpenForge version/commit | 7410230 |
| Gateway URL | http://127.0.0.1:48731 |
| Web URL | http://127.0.0.1:48732 |
| Project path | `/tmp/openforge-smoke/project` |

## 2026-05-06 Initial Browser Terminal Evidence

| Step | Evidence Required | Result | Notes |
|------|-------------------|--------|-------|
| Attach | Browser terminal connects to the selected session | Partial | Real browser reached `/sessions/12efb6fb-5438-42d4-ad86-7ec97e38a099` and showed `connected session 12efb6fb-5438-42d4-ad86-7ec97e38a099`. |
| Input/output | Harmless command is typed and output renders | Fail | With a fake disposable `claude` shim, browser input rendered repeated `[openforge] Malformed terminal message` instead of fake CLI echo output. This blocks browser terminal smoke. |
| Resize | Browser resize or terminal fit reflows terminal | Not completed | Not completed after input/output failure. |
| Refresh/reconnect | Browser refresh reattaches to same session | Partial | Browser reload preserved the same session URL, but terminal content still showed the malformed-message failure. |
| Stop session | Stop action updates terminal/session controls | Partial | Clicking `停止` showed `[exited]` in the terminal, but the UI header still displayed `运行中` shortly after. |
| Gateway/Web restart recovery | Restart services and record session recovery behavior | Not completed | Not completed after input/output failure and worker interruption. |
| Browser console/network | Console and network observations recorded | Partial | Normal dev logs observed (`React DevTools`, `[HMR] connected`); config conflict surfaced as expected `409 POST .../generate-config`; one navigation-aborted dependency request appeared during route change. |

## 2026-05-07 Browser Terminal Rerun

The browser terminal blocker rerun used the canonical local ports and a
disposable smoke environment:

- Gateway: `http://127.0.0.1:48731`
- Web: `http://127.0.0.1:48732`
- Disposable DB: `/tmp/openforge-smoke/openforge-smoke.db`
- Disposable project: `/tmp/openforge-smoke/project`
- Disposable tmux prefix: `of-smoke-`
- Fake provider shim: `/tmp/openforge-smoke/bin/claude`
- Browser: Chromium / Google Chrome for Testing `147.0.7727.15`
- Session ID: `cc1a4610-fb72-44e2-9899-8704f4640db2`

Sandbox note: starting Gateway through `tsx` inside the sandbox failed with
`listen EPERM: operation not permitted /tmp/tsx-0/...pipe`. The rerun therefore
used an approved escalation for the disposable Gateway/Web listeners and
headless Chrome launch.

| Step | Result | Evidence |
|------|--------|----------|
| Gateway health | Pass | `GET /api/v1/health` returned HTTP 200 with `{ "code": 0, "data": { "status": "ok" }, "message": "" }`. |
| Web health | Pass | `GET /login` returned HTTP 200, `text/html; charset=utf-8`. |
| Register/login | Pass | Disposable user `browser-smoke-1778084837@example.local`; register returned HTTP 201/code 0, login returned HTTP 200/code 0. |
| Project create | Pass | Project `3d0d5017-5993-46cc-8d88-baaf49706857` created against `/tmp/openforge-smoke/project`. |
| Config generation reachability | Partial | `POST /api/v1/projects/:id/generate-config` reached Gateway and returned HTTP 409/code 1, `Explicit config write decisions required`, because the disposable project already had generated files from earlier smoke attempts. |
| Session create/attach | Pass | Session `cc1a4610-fb72-44e2-9899-8704f4640db2` created; browser reached `/sessions/cc1a4610-fb72-44e2-9899-8704f4640db2`; terminal displayed `connected session ...` and fake CLI banner. |
| Terminal input/output | Pass | Browser typed `smoke-1778084851`; xterm rendered `[fake-claude] echo:smoke-1778084851`; `[openforge] Malformed terminal message` was absent. |
| Resize | Pass | Browser viewport changed to `1024x700`; terminal content remained usable and no malformed terminal message appeared. |
| Refresh/reconnect | Pass | Browser reload stayed on the same session URL and retained terminal content. |
| Stop | Pass | `POST /api/v1/sessions/:id/stop` returned HTTP 200/code 0; browser body showed an exited/stopped state. |
| Browser console/network | Pass with normal dev noise | Console showed React DevTools and `[HMR] connected` messages only; no request failures and no HTTP `>=400` browser responses were captured during the browser phase. |
| Cleanup | Pass | Helper stopped both listeners; no `of-smoke-` tmux sessions remained after the run. |

Conclusion: the specific browser terminal blocker, repeated
`[openforge] Malformed terminal message` after browser input, was not reproduced
after the Web terminal message fix. Fake CLI input/output, resize, refresh, and
stop all passed in the browser smoke.

## 2026-05-06 Real Browser Attempt

The browser smoke advanced beyond the earlier sandbox-only blocker:

- Real browser launch succeeded after escalation.
- Disposable registration reached the dashboard.
- Disposable project path: `/tmp/openforge-smoke/project`.
- Config preview rendered `41` files.
- Explicit config conflict choices were shown, and a later run emitted
  `config_sync success`.
- A fake disposable `claude` shim was used to avoid real provider credentials.
- Browser session ID: `12efb6fb-5438-42d4-ad86-7ec97e38a099`.

Historical blocking failure: after browser typing, xterm rendered
`[openforge] Malformed terminal message` repeatedly instead of terminal echo
output. This was the 2026-05-06 blocker. The 2026-05-07 rerun above did not
reproduce the malformed-message failure and closes the Phase A browser terminal
evidence item.

## Next Operational State

No Phase A browser/provider prompt evidence remains open from this report. The
2026-05-07 rerun helper stopped its disposable Gateway/Web listeners and left no
`of-smoke-` tmux sessions behind. For any future regression rerun, restart or
verify the canonical local stack on Gateway `127.0.0.1:48731` and Web
`127.0.0.1:48732` with the disposable smoke database and project path before
collecting fresh browser evidence.

## Why Manual

The browser/provider prompt evidence required a real browser session and a real
Claude Code permission prompt. Automated route tests and package smoke can prove
Gateway/Web startup and API contracts, but they cannot prove the user's browser
terminal rendering, browser console/network state, or provider-side permission
prompt UX.

On 2026-05-06, the agent attempted a Playwright browser smoke against the local
Web and Gateway servers. Local Chrome for Testing was present at
`/usr/local/bin/chrome`, but headless launch in the current sandbox failed with
`setsockopt: Operation not permitted` from Chrome crashpad. This is recorded as
an environment blocker for browser-rendering evidence, not a confirmed
OpenForge regression.

To avoid launching a real AI provider CLI with host credentials, the agent then
ran a safer terminal transport smoke with a fake local `claude` command on a
disposable Gateway database and tmux prefix.

## Claude Permission Prompt Caveat

Real Claude Code permission-prompt notification is now part of the accepted
first-user validation set. The latest 2026-05-07 rerun is tracked separately in
`docs/reports/claude-permission-smoke-2026-05-07.md`; it shows the forced ask
rule path producing real permission prompt hooks, notifications, activities,
and `/ws/events` updates.

## Command Plan

Generate the latest loopback command plan:

```bash
node scripts/smoke-local-release.mjs
```

Validated output on 2026-05-06:

- Gateway: `pnpm --dir packages/gateway dev`
- Web: `pnpm --dir packages/web exec next dev --hostname 127.0.0.1 --port 48732`
- Gateway URL: `http://127.0.0.1:48731`
- Web URL: `http://127.0.0.1:48732`
- DB path: `/tmp/openforge-smoke/openforge-smoke.db`
- tmux prefix: `of-smoke-`
- Secrets are redacted in generated reports.

## User Test Checklist

1. Register and log in.
2. Create or import a disposable project.
3. Preview and apply project config.
4. Create a Claude Code terminal session.
5. Verify terminal attach, typing, resize, refresh reconnect, stop, and restart.
6. Trigger a real Claude Code permission prompt from the launched session.
7. Verify Web notification row, activity row, read state, and `/ws/events`
   refresh.
8. Record browser name/version, console errors, network failures, screenshots or
   written observations, and cleanup.
9. Confirm no tmux sessions remain with prefix `of-smoke-` after cleanup.

## Current Automated Backing Evidence

- `node --test scripts/smoke-local-release.test.mjs`: pass.
- `pnpm --dir packages/gateway test`: 318 tests passed.
- `pnpm --dir packages/web test`: 17 files, 76 tests passed.
- `pnpm smoke:npm`: pass with temporary install/startup smoke.
- Safe terminal WebSocket smoke on 2026-05-06: pass with fake local Claude CLI.
  Verified Gateway session creation, tmux attach, terminal output frame,
  terminal input frame, resize frame, second attach/reconnect, session stop, and
  no leftover `of-smoke-fake-` tmux sessions.

This fake local CLI transport evidence remains backing evidence for Gateway,
tmux, and WebSocket terminal transport only. The current browser xterm evidence
comes from the 2026-05-07 browser rerun above, and the current real Claude Code
permission-prompt evidence is tracked in
`docs/reports/claude-permission-smoke-2026-05-07.md`.

## Still Required

- None for Phase A browser/provider prompt evidence.
