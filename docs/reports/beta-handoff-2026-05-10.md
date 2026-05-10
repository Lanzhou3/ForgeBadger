# Beta Handoff

> Date: 2026-05-10
> Scope: Phase B Codex app-server, Provider regression, Windows/tmux guidance,
> and release-sized package gates
> Decision: ready for beta feedback with explicit prototype boundaries

## Handoff Decision

The current branch is acceptable for beta feedback once reviewed and committed.
The accepted beta surface is local-first OpenForge plus a guarded Codex
Background Tasks prototype. Real prompt/turn input remains disabled in Web and
is not part of the beta workflow.

## Included

- Phase A local-first release evidence remains accepted:
  `docs/reports/browser-terminal-smoke-2026-05-06.md`,
  `docs/reports/claude-permission-smoke-2026-05-07.md`, and
  `docs/reports/release-candidate-2026-05-06.md`.
- Phase B acceptance is recorded in
  `docs/reports/phase-b-codex-app-server-acceptance-2026-05-10.md`.
- Release-sized regression evidence is recorded in
  `docs/reports/regression-2026-05-06.md` under
  "Follow-Up Regression: 2026-05-10".
- Operational Windows/tmux guidance is recorded in `docs/RUNBOOK.md`.

## Acceptance Checklist

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Codex app-server safe observable control plane | Accepted | Phase B acceptance report; Gateway/Web focused tests; Playwright smoke |
| No Web prompt/turn controls | Accepted | Playwright smoke: hidden prompt/turn send controls, no `/turn` request |
| Real zero-quota app-server initialize | Accepted | `pnpm smoke:codex-app-server`, `promptOrTurnSent: false`, no `thread/start` or `turn/start` |
| No host Codex config pollution | Accepted | Host `~/.codex/config.toml` and `~/.codex/auth.json` fingerprints unchanged around real smoke |
| Provider SSOT does not flow into Codex | Accepted | Provider regression command: 23 tests covering provider routes/apply and Codex launch isolation |
| Claude/OpenCode provider configuration still works | Accepted | Provider config apply tests and OpenCode provider-backed launch regression |
| Windows native/tmux guidance | Accepted with platform caveat | CLI tests cover modes; runbook documents WSL/tmux remediation. No physical Windows host smoke was run in this pass |
| Release-sized gates | Accepted | `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build`, `pnpm build:npm`, `pnpm verify:npm`, `pnpm smoke:npm` |

## Residual Risks

- Stopped/error app-server sessions are retained in the in-memory manager for
  observability. Add TTL or pagination if long-running use shows unbounded
  state growth.
- A real Windows host or WSL manual smoke was not available in this pass. CLI
  unit tests and runbook coverage are the current evidence for platform
  messaging.
- `/turn` exists as an authenticated, feature-flagged Gateway prototype route.
  It must stay disabled for beta unless a separate retention, quota, and
  user-facing prompt design is accepted.

## Sandbox Caveat

The restricted sandbox is not valid evidence for final local-port, Web build,
Playwright, or npm package smoke gates in this repository. The canonical
2026-05-10 results are the unrestricted reruns recorded in the regression and
Phase B acceptance reports.
