# Phase 26 Context: Trial Feedback Draft Generator

## Purpose

Phase 26 reduces friction in the remaining v1.5 task: collecting a real
first-user trial packet. The feedback form, Markdown template, and runbook are
now validated, but a first user or maintainer still has to copy the template
and fill environment metadata manually.

The goal is to generate a local Markdown draft with bounded environment
metadata and explicit gate-preserving language.

## Boundaries

- Generate a draft only; do not submit feedback automatically.
- Do not export diagnostics, read browser storage, read tokens, upload files,
  or collect raw terminal/provider/Feishu evidence.
- Pre-fill safe local metadata such as commit, OS, shell, Node, tmux, and AI
  CLI version summaries.
- Leave diagnostics, reproduction, expected behavior, actual behavior,
  severity, owner, disposition, and redaction review as human-filled fields.
- Preserve `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-CALLBACK`, and
  `FIRST-USER-FEEDBACK` gate states.

## Expected Outputs

- `scripts/create-trial-feedback-draft.mjs`
- `scripts/create-trial-feedback-draft.test.mjs`
- root `pnpm trial:feedback-draft` command
- CI script harness coverage
- trial runbook/checklist/feedback docs pointing to the draft helper
- Phase 26 planning and report artifacts
