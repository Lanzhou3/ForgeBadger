# Phase 24 Context: Trial Feedback Intake Contract

## Purpose

Phase 24 closes a quality gap in the v1.5 first-user trial loop: the GitHub
issue form and Markdown feedback template were detailed, but their required
fields, redaction language, and triage routing were not machine-checked.

The goal is to make the intake contract drift-resistant before asking real
first users to submit trial packets.

## Problem

`docs/TRIAL-FEEDBACK.md` and
`.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml` are the canonical
feedback entry points. If a later edit removes severity, owner, disposition,
diagnostics, Copilot evidence, terminal evidence, or safety language, CI would
not catch it.

That would weaken `FIRST-USER-FEEDBACK` evidence quality and could reintroduce
requests for raw terminal transcripts, provider payloads, Feishu bodies, local
databases, `.env` files, or browser tokens.

## Boundaries

- Validate the existing intake surfaces; do not collect or fabricate a real
  first-user packet.
- Keep `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-CALLBACK`, and
  `FIRST-USER-FEEDBACK` gate states unchanged.
- Do not add a generic YAML parser dependency for this narrow contract.
- Do not ask users for secrets, raw logs, raw terminal transcripts, provider
  payloads, Feishu bodies, local databases, or private AI CLI config.
- Keep the source fallback and runtime product surface unchanged.

## Expected Outputs

- `scripts/validate-trial-feedback-intake.mjs`
- `scripts/validate-trial-feedback-intake.test.mjs`
- CI script harness coverage for the intake contract.
- Phase 24 planning and report artifacts.
- Active roadmap, requirements, milestone, project, decisions, state, and
  memory updates.
