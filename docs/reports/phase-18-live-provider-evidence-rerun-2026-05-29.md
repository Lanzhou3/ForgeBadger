# Phase 18 Live Provider Evidence Rerun

Date: 2026-05-29
Scope: Phase 18 `PROV-01` through `PROV-03` evidence attempt for the v1.4 `LIVE-PROVIDER` gate.

## Status

| Gate | Status | Decision |
|------|--------|----------|
| `LIVE-PROVIDER` | Caveat | The smoke harness ran and produced a redacted skipped result. No disposable provider credential was available, so this phase does not claim live provider `Pass`. |

## Command Evidence

Command:

```bash
pnpm smoke:copilot-provider
```

Environment summary:

- OS: Linux `6.8.0-107-generic` `x86_64 GNU/Linux`
- Node: `v24.14.1`
- pnpm: `10.33.2`
- Commit: `7698392`
- Provider smoke env availability: no relevant provider smoke environment variables were set.

Execution notes:

- First sandboxed run failed before executing the harness because `tsx` could
  not create its IPC pipe: `listen EPERM` under `/tmp/tsx-*`.
- The same command was rerun with approved escalation.
- The unrestricted rerun exited `0` and emitted only redacted JSON.

Redacted result:

```json
{
  "ok": true,
  "status": "skipped",
  "reason": "missing_provider_credential"
}
```

## Failure Classification

| Class | Result |
|-------|--------|
| Missing credential | `missing_provider_credential` |
| Missing explicit model id | Not evaluated because no credential/provider was selected. |
| Unsupported model | Not reached. |
| Endpoint or network failure | Not reached. |
| Timeout | Not reached. |
| Provider outage | Not reached. |
| Product-contract failure | Not observed; the harness returned a safe skipped result without leaking secrets. |

## Codex Boundary

This evidence attempt did not use Codex launch paths and did not inject
provider credentials or model overrides into Codex. Codex remains
subscription-managed; provider API-key/model evidence applies only to the
Copilot provider smoke harness.

## Artifact And Redaction Review

Allowed artifact fields recorded:

- command name;
- OS/Node/pnpm/commit summaries;
- smoke status;
- skip reason;
- caveat decision;
- next action.

Forbidden content not recorded:

- plaintext provider keys;
- Authorization headers;
- raw provider request bodies;
- raw provider response bodies;
- full model outputs;
- browser auth token values;
- JWTs or attach tokens.

Secret-pattern scan note: the verification scan may match the documented scan
command text in this report and the Phase 18 plan. Those matches are scan
patterns, not secret values.

## Next Action

Keep `LIVE-PROVIDER` as `Caveat`. To clear it, rerun:

```bash
OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1 \
OPENFORGE_COPILOT_PROVIDER_SMOKE_PROVIDER=<openai-or-anthropic> \
OPENFORGE_COPILOT_PROVIDER_SMOKE_MODEL=<disposable-test-model> \
pnpm smoke:copilot-provider
```

Set the disposable API key in the shell or secret manager before running the
command. Do not write the key into documentation, shell history, issue text, or
reports.

## Verification

```bash
rg -n "LIVE-PROVIDER|phase-18-live-provider|smoke:copilot-provider|missing_provider_credential|missing_model_id|Caveat|Blocked|Pass|Codex subscription" docs/EXTERNAL-EVIDENCE-GATES.md docs/reports/phase-18-live-provider-evidence-rerun-2026-05-29.md .planning/REQUIREMENTS.md .planning/ROADMAP.md .planning/STATE.md .planning/phases/OF-18-live-provider-evidence-rerun
rg -n "sk-[A-Za-z0-9_-]+|OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY=|OPENAI_API_KEY=|ANTHROPIC_API_KEY=|Authorization: Bearer" docs/reports/phase-18-live-provider-evidence-rerun-2026-05-29.md docs/EXTERNAL-EVIDENCE-GATES.md .planning/phases/OF-18-live-provider-evidence-rerun || true
git diff --check
```
