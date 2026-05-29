# Phase 6 User Setup

## Status

Incomplete. Phase 6 can execute with explicit caveats when these resources are
unavailable, but `Pass` evidence requires the matching setup below.

## Disposable Live Provider Credential

Required only to convert the live Copilot provider row from `Caveat` to `Pass`.

| Item | Required For | Notes |
|------|--------------|-------|
| Disposable OpenAI or Anthropic API key | Live provider `Pass` evidence | Supply outside the repository through the shell or secret manager. Do not write the key into docs, `.env`, screenshots, or reports. |
| Explicit model id | Live provider `Pass` evidence | Use a low-risk disposable test model id for the selected provider. |
| Provider selection | Live provider `Pass` evidence | Use either OpenAI or Anthropic. One passing provider is enough for Phase 6. |

Verification command shape:

```bash
OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1 \
OPENFORGE_COPILOT_PROVIDER_SMOKE_PROVIDER=<openai-or-anthropic> \
OPENFORGE_COPILOT_PROVIDER_SMOKE_MODEL=<disposable-test-model> \
pnpm smoke:copilot-provider
```

Record only provider name, model id, command, environment, status, event-type
summary, marker match, sanitized failure classification, and redacted JSON.

## Physical Windows/WSL Host

Required only to convert the physical Windows/WSL terminal row from `Caveat` to
`Pass`.

| Item | Required For | Notes |
|------|--------------|-------|
| Physical Windows host with WSL | WSL terminal `Pass` evidence | Native Windows management UI checks do not prove tmux-backed browser terminal behavior. |
| `tmux` inside WSL | Terminal persistence evidence | Capture version with `tmux -V`. |
| OpenForge prerequisites inside WSL | Launch and recovery evidence | Node, pnpm, CLI package/source checkout, Gateway/Web loopback access. |
| Browser access to Web console | Browser terminal evidence | Use the same host/ports recorded in the terminal gate report. |

Minimum WSL checklist:

- `openforge doctor`
- project launch
- browser terminal attach
- tmux session existence
- WebSocket disconnect/reconnect
- Gateway restart recovery
- no orphan smoke session

## Secret Handling

- Do not paste API keys, JWTs, Feishu secrets/tokens, full auth/config files,
  provider request/response payloads, full model output, or terminal
  transcripts containing secrets into evidence docs.
- If a scan reports placeholder or fixture-like strings, record the count and
  classification only.
