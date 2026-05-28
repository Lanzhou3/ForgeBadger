# OpenForge Trial Feedback Template

Use this template for first-user local trial feedback. Prefer the GitHub issue
form `OpenForge first-user trial feedback` when filing feedback from the
repository; use this document as the offline copy/paste template. Review all
attachments before sharing.

## Summary

- Result: pass / pass with caveats / blocked
- Affected surface: onboarding / dependency / provider / platform / terminal / Copilot / Feishu / Project Manager / docs / other
- Startup path: npm/CLI / source fallback
- OpenForge version or commit:
- Operating system:
- Shell:
- Windows native or WSL, if applicable:
- Browser and version:

Result rubric:

- pass: required evidence is attached and no blocking first-user issue remains.
- pass with caveats: implementation worked, but external evidence such as live
  provider smoke, physical Windows/WSL terminal proof, or real browser terminal
  evidence is missing. Include owner and next action.
- blocked: the trial cannot continue. Include the blocking step, owner, and next
  action.

## Dependency Versions

```bash
node --version
tmux -V
claude --version
openforge doctor
```

Optional:

```bash
opencode --version
codex --version
```

## Diagnostics Export

Diagnostics are generated locally and are not uploaded automatically.

First-user path:

1. Log in to the Web console.
2. Open Settings.
3. Click **Export diagnostics JSON**.
4. Attach the downloaded redacted diagnostics file to the issue or handoff note.

Maintainer-only fallback:

- If the Web export cannot be used, a maintainer may collect diagnostics through
  the local API using their own existing authenticated environment.
- Do not ask first users to retrieve browser auth tokens from developer tools.
- Do not include plaintext API keys, passwords, JWTs, attach tokens, private
  keys, unrelated project secrets, browser auth token values, local databases,
  `.env` files, raw provider payloads, raw Feishu bodies, or raw terminal
  transcripts.

## Reproduction Steps

1.
2.
3.

## Expected Behavior


## Actual Behavior


## Triage

- Affected surface: onboarding / dependency / provider / platform / terminal / Copilot / Feishu / Project Manager / docs / other
- Category: dependency / provider / CLI / platform / Copilot / docs / E2E / other
- Severity: blocker / high / medium / low
- Mapped requirement: UX-01 / UX-02 / UX-03 / UX-04 / UX-05 / UX-06 / UX-07 / REL-*
- Owner:
- Disposition: gate-clearing evidence / preserved caveat / preserved blocker / product defect / docs or support gap / no action
- Follow-up route: issue #3 LIVE-PROVIDER / issue #4 WINDOWS-WSL / issue #5 FIRST-USER-FEEDBACK / Feishu callback evidence report / new issue / next phase / no action
- Next action or no-action rationale:
- Caveat status: none / pass with caveats / blocked
- Redaction review completed: yes / no

Requirement mapping guide:

| Requirement | Use When The Report Shows |
|-------------|---------------------------|
| UX-01 | Missing tmux, missing local CLI, unsupported native Windows terminal mode, or unclear dependency/runtime guidance. |
| UX-02 | Provider/model/credential readiness failures or recovery paths that risk exposing secrets. |
| UX-03 | Copilot run, pending-action, cancellation, or waiting-for-approval state confusion. |
| UX-04 | Feedback is not reproducible enough to become an engineering task. |
| UX-05 | Copilot active-run state regresses after polling, events, refresh, or out-of-order responses. |
| UX-06 | Settings, Copilot, or diagnostics panel shows an empty state instead of a recoverable API/query failure. |
| UX-07 | E2E mock, selector, or state-ordering regression signal is weak or hiding API contract drift. |

## Browser Evidence

- Console errors:
- Network failures:
- `pnpm smoke:copilot-provider` result: passed / skipped / failed
- Provider smoke skip or failure reason:
- Copilot provider with active model configured: yes / no / skipped
- Copilot prompt used:
- Copilot read-tool evidence observed:
- Copilot pending-action approve/reject result:
- Copilot memory write proposal tested: yes / no / skipped
- Copilot memory notes:
- Confirmed no terminal/shell/Codex turn input in Copilot: yes / no
- Screenshots or written observations, redacted:
- Terminal attach result:
- Terminal input/output result summary, no raw transcript:
- Terminal resize result:
- Refresh/reconnect result:
- Stop-session result:
- Gateway/Web restart recovery result:
- Physical Windows/WSL result, if applicable:
- Claude permission prompt behavior, if encountered:

## Bounded Support Notes

- Gateway log summary, no raw log attachment:
- Web log summary, no raw log attachment:
- tmux session name:
- Relevant command result summary, no raw private output:
