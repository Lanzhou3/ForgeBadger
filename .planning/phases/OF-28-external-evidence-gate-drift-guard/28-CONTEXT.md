# Phase 28 Context: External Evidence Gate Drift Guard

## Purpose

Phase 28 adds a machine-verified guard for `docs/EXTERNAL-EVIDENCE-GATES.md`.
After Phase 27, completed Markdown packets can be audited before maintainer
triage, but the external gate registry itself still needs protection against
accidental status drift.

The goal is to keep `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-CALLBACK`, and
`FIRST-USER-FEEDBACK` truthful until the required external artifacts exist.

## Boundaries

- Validate registry shape, required gates, exact current states, and key rerun
  or target phrases.
- Keep `FIRST-USER-FEEDBACK` tied to `pnpm trial:feedback-audit` before
  maintainer triage.
- Do not collect, fabricate, upload, or attach external evidence.
- Do not move any gate to `Pass`.

## Expected Outputs

- `scripts/validate-external-evidence-gates.mjs`
- `scripts/validate-external-evidence-gates.test.mjs`
- root `pnpm evidence:gates-validate` command
- CI script harness coverage
- external gate registry rerun-path wording synced with Phase 27 audit helper
- Phase 28 planning/report updates
