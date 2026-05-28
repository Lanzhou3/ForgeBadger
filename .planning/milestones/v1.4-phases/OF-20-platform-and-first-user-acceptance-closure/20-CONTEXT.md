# Phase 20 Context: Platform And First-User Acceptance Closure

Date: 2026-05-29

## Why This Phase Exists

Phase 20 closes v1.4 External Evidence Closure by publishing one final matrix
for the external gates that remain after Phases 17 through 19:

- `LIVE-PROVIDER`
- `WINDOWS-WSL`
- `FEISHU-CALLBACK`
- `FIRST-USER-FEEDBACK`

This phase does not remove caveats without real external artifacts. It packages
the current state into a release closeout that users and maintainers can rely
on without overclaiming.

## Source Evidence

- `docs/EXTERNAL-EVIDENCE-GATES.md` is the canonical gate registry.
- `docs/reports/phase-18-live-provider-evidence-rerun-2026-05-29.md` records
  `LIVE-PROVIDER` as `Caveat` with `missing_provider_credential`.
- `docs/reports/phase-19-feishu-public-callback-evidence-2026-05-29.md`
  records `FEISHU-CALLBACK` as `Blocked`.
- `docs/reports/phase-6-terminal-gate-evidence-2026-05-21.md` records
  historical `WINDOWS-WSL` caveat evidence and the WSL rerun checklist.
- `docs/TRIAL-FEEDBACK.md` and
  `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml` define the feedback
  packet shape, but they are not completed feedback evidence.
- `docs/OPEN-SOURCE-READINESS.md`, `docs/TRIAL-CHECKLIST.md`, and
  `docs/SUPPORT-DIAGNOSTICS.md` preserve user-facing caveats and redaction
  rules.

## Current Host Evidence

The current host reported:

- OS: Linux `6.8.0-107-generic` `x86_64 GNU/Linux`
- WSL detection: `not_wsl`
- tmux: `tmux 3.4`
- Node: `v24.14.1`
- pnpm: `10.33.2`
- commit: `93c0b8c`

This is useful current-host metadata, but it is not physical Windows/WSL
terminal evidence.

## Expected Outcomes

Accept only:

- `Complete (Caveat)`: Windows/WSL and first-user feedback are truthfully
  preserved as caveats with rerun/collection paths.
- `Complete (Blocked)`: Feishu remains blocked by missing public HTTPS route,
  webhook setup environment, and developer-console URL verification.
- no `Pass` reclassification unless the corresponding required artifact exists.

## Phase 20 Output

- `.planning/phases/OF-20-platform-and-first-user-acceptance-closure/20-01-PLAN.md`
- `docs/reports/v1.4-external-evidence-closeout-2026-05-29.md`
- planning-state updates that close v1.4 without expanding runtime scope.
