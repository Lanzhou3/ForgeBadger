# Phase 1 Live Provider Evidence

> Date: 2026-05-19
> Scope: REL-01 live Copilot provider smoke evidence
> Decision: `Caveat` until a disposable provider credential and explicit model id are supplied

## Decision

REL-01 is classified as `Caveat` for this execution. The existing smoke harness
ran successfully, but the environment did not provide a disposable OpenAI or
Anthropic provider credential, so no live provider call was attempted.

## Evidence Table

| Gate | Status | Command | Environment | Result summary | Log/report location | Skip reason | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REL-01 live Copilot provider smoke | Caveat | `pnpm smoke:copilot-provider` | Ubuntu Linux `6.8.0-107-generic`, Node `v24.14.1`, pnpm `10.33.2`; sandbox run hit `tsx` IPC `EPERM`, unrestricted rerun completed | Redacted JSON result: `ok: true`, `status: skipped`, `reason: missing_provider_credential`; no provider, model id, request body, or model output was emitted | This report; command rerun in current repo session on 2026-05-19 | `missing_provider_credential` | Maintainer with disposable OpenAI or Anthropic test credential | Rerun with `OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1`, provider, model id, and disposable API key; record only redacted JSON/public summary fields |

## Secret Handling

- No API key, Authorization header, provider credential, full request body, raw
  provider response, or full model output was recorded.
- Future `Pass` evidence must use only disposable or rotatable credentials and
  must record provider, model id, run status, event types, and a redacted
  assistant preview only.
- A missing credential remains a `Caveat`, not a local implementation failure.

## Follow-up

1. Create or obtain a disposable OpenAI or Anthropic test credential.
2. Choose an explicit model id for the provider.
3. Run:

   ```bash
   # Set OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY in your shell or secret manager first.
   OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1 \
   OPENFORGE_COPILOT_PROVIDER_SMOKE_PROVIDER=<openai-or-anthropic> \
   OPENFORGE_COPILOT_PROVIDER_SMOKE_MODEL=<disposable-test-model> \
   pnpm smoke:copilot-provider
   ```

4. Replace this `Caveat` with `Pass` only if the redacted result reports a
   completed Copilot run with the expected smoke marker and no secret leakage.
