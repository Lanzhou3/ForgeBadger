# Phase 36 Context: Copilot Evidence Packet Audit Guard

## Purpose

Phase 36 closes a first-user feedback quality gap found after README
entrypoints were protected. The Markdown template, GitHub issue form, and draft
helper asked users to provide Copilot smoke and boundary evidence, but the
packet audit did not require the full Copilot prompt/read-tool/pending-action
and "no terminal/Codex turn input" evidence set before declaring a packet ready
for maintainer triage.

The goal is to make the packet and issue audits reject completed-looking
feedback that omits required Copilot evidence, while preserving the rule that
passing audit is triage readiness only and never automatic gate clearance.

## Boundaries

- Update first-user feedback audit tooling and draft/intake prompts only.
- Keep `FIRST-USER-FEEDBACK` as `Caveat`.
- Do not collect, submit, attach, or mutate first-user feedback.
- Do not clear any external evidence gate.

## Expected Outputs

- `scripts/audit-trial-feedback-packet.mjs` requires Copilot smoke/provider,
  prompt, read-tool, pending-action, memory-write, and terminal-boundary fields.
- `scripts/audit-trial-feedback-issue.mjs` maps the GitHub issue-form Copilot
  fields into the Markdown packet shape before audit.
- `scripts/validate-trial-feedback-intake.mjs` guards the Copilot evidence
  prompts in both the Markdown template and GitHub issue form.
- `scripts/create-trial-feedback-draft.mjs` includes the memory-write prompt
  that the packet audit now requires.
- Phase 36 planning/report updates.
