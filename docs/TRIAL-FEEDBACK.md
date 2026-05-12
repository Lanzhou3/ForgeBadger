# OpenForge Trial Feedback Template

Use this template for first-user local trial feedback. Review all attachments
before sharing.

## Summary

- Result: pass / pass with caveats / blocked
- Startup path: npm/CLI / source fallback
- OpenForge version or commit:
- Operating system:
- Shell:
- Windows native or WSL, if applicable:
- Browser and version:

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
   `openforge.token`.

Do not include plaintext API keys, passwords, tokens, private keys, unrelated
project secrets, or the `openforge.token` value.

## Reproduction Steps

1.
2.
3.

## Expected Behavior


## Actual Behavior


## Browser Evidence

- Console errors:
- Network failures:
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
