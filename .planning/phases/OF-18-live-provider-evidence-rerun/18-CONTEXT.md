# Phase 18 Context: Live Provider Evidence Rerun

Date: 2026-05-29

## Why This Phase Exists

Phase 17 created `docs/EXTERNAL-EVIDENCE-GATES.md` as the canonical evidence
gate registry. The next gate is `LIVE-PROVIDER`, currently `Caveat`, because no
disposable provider credential and explicit model id have been attached to a
fresh smoke run.

## Source Evidence

- `docs/EXTERNAL-EVIDENCE-GATES.md` defines the `LIVE-PROVIDER` clearing
  condition and redaction rules.
- `scripts/smoke-copilot-provider.ts` is the existing harness. It supports
  OpenAI and Anthropic, defaults to a safe skipped result when credentials are
  missing, and can enforce live evidence with
  `OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1`.
- `scripts/smoke-copilot-provider.test.ts` verifies safe skip behavior,
  required-live failure behavior, public summary redaction, provider inference,
  and error redaction.
- `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` is the historical
  matrix; Phase 18 should add a new v1.4 report rather than rewriting history.

## Runtime Inputs

The current shell has no visible provider smoke environment variables set:

- `OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY`
- `OPENFORGE_COPILOT_PROVIDER_SMOKE_PROVIDER`
- `OPENFORGE_COPILOT_PROVIDER_SMOKE_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`

Do not print or persist secret values if a later shell provides them.

## Expected Outcomes

Accept either:

- `Pass`: required-live smoke runs with disposable credential and explicit model
  id, emits redacted JSON, and returns `status: passed`.
- `Caveat`: smoke runs and returns safe skipped evidence such as
  `missing_provider_credential` or `missing_model_id`.
- `Blocked`: smoke cannot run because the harness, environment, or dependency
  fails before producing a trustworthy redacted result.

## Phase 18 Output

- `.planning/phases/OF-18-live-provider-evidence-rerun/18-01-PLAN.md`
- `docs/reports/phase-18-live-provider-evidence-rerun-2026-05-29.md`
- updates to planning state and registry/report links without changing Gateway
  or Web runtime behavior.
