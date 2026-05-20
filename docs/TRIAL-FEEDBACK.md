# OpenForge Trial Feedback Template

Use this template for first-user local trial feedback. Prefer the GitHub issue
form `OpenForge first-user trial feedback` when filing feedback from the
repository; use this document as the offline copy/paste template. Review all
attachments before sharing.

## Summary

- Result: pass / pass with caveats / blocked
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

Preferred path:

1. Log in to the Web console.
2. Open Settings.
3. Click **Export diagnostics JSON**.
4. Attach the downloaded redacted diagnostics file to the issue or handoff note.

Fallback local API path:

```bash
curl --noproxy '*' -fsS \
  -H "authorization: Bearer <token>" \
  http://127.0.0.1:48731/api/v1/diagnostics/export
```

For local trial use, get `<token>` from the logged-in browser session:
   browser developer tools -> Application or Storage -> Local Storage ->
   the OpenForge browser auth token entry.

Do not include plaintext API keys, passwords, tokens, private keys, unrelated
project secrets, or the browser auth token value.

## Reproduction Steps

1.
2.
3.

## Expected Behavior


## Actual Behavior


## Triage

- Category: dependency / provider / CLI / platform / Copilot / docs / E2E / other
- Severity: blocker / high / medium / low
- Mapped requirement: UX-01 / UX-02 / UX-03 / UX-04 / UX-05 / UX-06 / UX-07 / REL-*
- Follow-up phase: Phase 3 hardening / Phase 4 / Phase 5 / later
- Owner:
- Next action:
- Caveat status: none / pass with caveats / blocked

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
- Screenshots or written observations:
- Terminal attach result:
- Terminal input/output result:
- Terminal resize result:
- Refresh/reconnect result:
- Stop-session result:
- Gateway/Web restart recovery result:
- Physical Windows/WSL result, if applicable:
- Claude permission prompt behavior, if encountered:

## Logs

- Gateway logs:
- Web logs:
- tmux session name:
- Relevant command output:
