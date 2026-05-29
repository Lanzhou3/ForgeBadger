# Phase 27 Context: Trial Feedback Packet Audit

## Purpose

Phase 27 adds a local audit guard for completed first-user feedback packets.
Phase 26 can generate a helpful Markdown draft, but a draft or half-filled
template must not be mistaken for completed `FIRST-USER-FEEDBACK` evidence.

The goal is to check whether a Markdown feedback packet has the minimum fields
needed for maintainer triage while still making gate clearance an explicit
human decision.

## Boundaries

- Audit Markdown packet completeness and secret-like content only.
- Passing audit means ready for maintainer triage, not automatic gate
  clearance.
- Reject generated drafts and placeholder-only template content.
- Reject obvious token/key-bearing content.
- Do not upload packets, export diagnostics, read browser storage, or mutate
  external gate state.

## Expected Outputs

- `scripts/audit-trial-feedback-packet.mjs`
- `scripts/audit-trial-feedback-packet.test.mjs`
- root `pnpm trial:feedback-audit` command
- CI script harness coverage
- trial docs pointing completed Markdown packets through the audit helper
- Phase 27 planning/report updates
