# OpenForge Trial Checklist

Attach a completed copy of this checklist to trial feedback. Use short notes,
screenshots, and exact reproduction steps for anything that looks wrong.
Attach the completed `docs/TRIAL-FEEDBACK.md` copy as the triage input for
requirement mapping and follow-up phase assignment.

## Environment

- Startup path:
  - [ ] npm/CLI package: command used:
  - [ ] source fallback: repo path, branch, and command used:
- OS and version:
- Shell and version:
- Node version: `node --version`
- tmux version: `tmux -V`
- Claude Code version: `claude --version`
- npm/CLI only: `openforge doctor` output:
- Windows only:
  - [ ] Native Windows management UI check only.
  - [ ] WSL terminal trial used for browser terminal evidence.
  - WSL distribution and version:

```text
paste output here
```

## Startup

- [ ] Started OpenForge successfully.
- Web URL:
- [ ] Gateway health envelope returns `{"code":0,"data":...,"message":""}`.
- [ ] `/login` loads in the browser.
- Notes:

## Account

- [ ] Registered a new user.
- [ ] Logged out and logged back in.
- Notes:

## Project And Config

- [ ] Created or imported a disposable project.
- [ ] Selected or reviewed the Claude Code template.
- [ ] Previewed generated config.
- [ ] Applied generated config.
- Notes:

## Claude Code Session

- [ ] Created a Claude Code session.
- [ ] Attached to the browser terminal.
- [ ] Entered a command and saw input/output.
- [ ] Resized the browser or terminal area and confirmed terminal resize.
- [ ] Refreshed the browser and reconnected to the same terminal session.
- [ ] Stopped the session and confirmed UI state changed.
- [ ] Restarted Gateway/Web and confirmed the session recovery behavior.
- [ ] Confirmed this evidence came from a real browser, not only automated unit
      tests or mocked Playwright.
- Claude Code permission prompt behavior, if encountered:

```text
write what Claude Code asked, what OpenForge showed, and what happened next
```

## Diagnostics And Evidence

- [ ] Exported diagnostics from Settings.
- [ ] Checked browser console for errors.
- [ ] Checked browser Network tab for failed requests.
- [ ] Added screenshots or written observations.
- [ ] Added reproduction steps for each issue.

## Phase 3 Hardening Triage

Map every observed issue to at least one Phase 3 requirement before filing
feedback:

| Requirement | Use When The Report Shows |
|-------------|---------------------------|
| UX-01 | Missing tmux, missing Claude/Codex/OpenCode CLI, unsupported native Windows terminal mode, or unclear runtime dependency guidance. |
| UX-02 | Provider, model, or credential readiness failures that are hard to recover from or risk exposing secrets. |
| UX-03 | Copilot run, pending-action, cancellation, or waiting-for-approval state is confusing after retry, refresh, or multiple tabs. |
| UX-04 | Feedback lacks enough environment, command, browser, expected/actual, or reproduction detail to become an engineering task. |
| UX-05 | Copilot Web active-run state appears to move backward after polling, events, refresh, or out-of-order responses. |
| UX-06 | Settings, Copilot, or diagnostics panels show empty content instead of a recoverable API/query failure state. |
| UX-07 | Browser E2E evidence hides an unhandled `/api/v1/*` route, uses brittle selectors, or misses key state-ordering assertions. |

For every `pass with caveats` or `blocked` result, record:

- Owner:
- Next action:
- Evidence needed to move from Caveat/Blocked to Pass:
- Follow-up phase or issue:

## Copilot Smoke

- [ ] Maintainer live-provider harness result recorded, if available:
      `pnpm smoke:copilot-provider`.
- [ ] Configured an OpenAI or Anthropic model provider with an active model and
      test credential.
- [ ] If Copilot is blocked, recorded the visible provider readiness reason:
      no compatible provider / missing active credential / missing active model.
- [ ] Opened `/copilot` from the sidebar.
- [ ] Asked Copilot to diagnose session launch readiness.
- [ ] Verified the response uses platform state such as adapter discovery or recent activity.
- [ ] If Copilot proposed a memory write, verified it appeared as a pending action before approval.
- [ ] Approved or rejected the memory write and confirmed it did not expose pasted secrets.
- [ ] Verified proposed actions appear as pending actions before approval.
- [ ] Verified no terminal input control, raw shell control, or Codex `/turn` input appears.

Diagnostics export notes:

```text
paste location or summary here
```

Browser console/network errors:

```text
paste errors here
```

Screenshots or written observations:

```text
paste notes here
```

Reproduction steps:

```text
1.
2.
3.
```

## Manual Evidence Boundary

- [ ] I recorded any step that CI cannot prove: real browser terminal behavior,
      real Claude Code permission prompt behavior, physical Windows/WSL
      behavior, and local diagnostics review.
- [ ] I did not paste API keys, passwords, JWTs, attach tokens, private keys,
      or unrelated project secrets into feedback.
