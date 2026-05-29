# Phase 25 Context: Tokenless Trial Diagnostics

## Purpose

Phase 25 closes a first-user safety regression found after Phase 24: the
feedback issue form and Markdown template no longer asked users to retrieve
browser auth tokens, but `docs/TRIAL-RUNBOOK.md` still described a local API
curl fallback that required reading the browser `openforge.token` value from
developer tools.

The goal is to keep the first-user diagnostics path tokenless from the user's
perspective and lock that behavior into the intake validator.

## Root Cause

Phase 24 validated the feedback intake surfaces:

- `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`
- `docs/TRIAL-FEEDBACK.md`

It did not validate the runbook that first users read before filing feedback.
The runbook therefore retained older guidance that instructed users to open
browser developer tools, read Local Storage, and use the browser token in a
manual curl command.

## Boundaries

- First users should use the Web Settings diagnostics export.
- Maintainer API fallback is allowed only as a maintainer-only path using the
  maintainer's own authenticated environment.
- Do not ask first users to retrieve, paste, screenshot, or share browser auth
  tokens.
- Do not reclassify `FIRST-USER-FEEDBACK` or any external gate.
- Do not add diagnostics upload, raw evidence storage, or new runtime surface.

## Expected Outputs

- Extend `scripts/validate-trial-feedback-intake.mjs` to validate
  `docs/TRIAL-RUNBOOK.md`.
- Add a regression test for browser-token fallback wording.
- Update `docs/TRIAL-RUNBOOK.md` to use Settings export first and a
  maintainer-only fallback.
- Active planning/report updates that preserve external gate states.
