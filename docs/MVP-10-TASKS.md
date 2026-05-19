# MVP-10 Task List

> Status: implemented; beta feedback ready with documented platform caveats
> Window: 2026-05-19 to 2026-05-25
> Goal: prepare a local-first release candidate and beta feedback loop after
> MVP-8 acceptance and MVP-9 prototype decisions.

2026-05-06 update: npm package build/verify/smoke, local diagnostics export,
Codex app-server prototype boundaries, risk register, and regression evidence
are recorded in `docs/reports/release-candidate-2026-05-06.md` and
`docs/reports/regression-2026-05-06.md`. The release-candidate decision is
accepted with caveats that were later closed by the 2026-05-07 user-run
browser terminal and real provider prompt smoke.

2026-05-10 update: Phase A browser terminal and real Claude Code permission
prompt evidence is closed by `docs/reports/browser-terminal-smoke-2026-05-06.md`
and `docs/reports/claude-permission-smoke-2026-05-07.md`. Phase B Codex
Background Tasks are accepted for beta feedback with prompt/turn input disabled;
see `docs/reports/beta-handoff-2026-05-10.md` and
`docs/reports/phase-b-codex-app-server-acceptance-2026-05-10.md`. The remaining
platform caveat is physical Windows/WSL validation, not a repository test gap.

MVP-10 should not start hosted collaboration, billing, cloud deployment, hosted
marketplaces, autonomous remote execution, or richer plugin executable/MCP/LSP
execution unless a new architecture review explicitly expands scope.

## Priority Order

1. Release-candidate packaging and install validation.
2. Beta feedback instrumentation.
3. Documentation and onboarding hardening.
4. Release risk register.
5. Final regression and acceptance gate.

## Task 1: Release-Candidate Packaging

Goal: validate that local users can install and run OpenForge without relying
on repository-only workflows.

Scope:

- Re-run `scripts/build-npm-package.mjs`, `scripts/verify-npm-package.mjs`, and
  `scripts/smoke-npm-package.mjs` where applicable.
- Validate generated package contents do not include credentials, local
  databases, build caches, or user config directories.
- Test startup with a disposable database and explicit environment secrets.

Verification:

- Release-candidate report records package commands, tarball contents summary,
  startup commands, ports, and cleanup evidence.

## Task 2: Beta Feedback Instrumentation

Goal: make beta feedback actionable without adding hosted telemetry.

Scope:

- Add a local export/reporting workflow for diagnostics that redacts secrets.
- Include app version, adapter discovery, health summary, recent audit/activity
  counts, and environment checks.
- Do not upload diagnostics automatically.

Verification:

- Tests cover secret redaction and export shape.
- Manual smoke verifies the export file can be generated and reviewed locally.

## Task 3: Documentation And Onboarding Hardening

Goal: reduce setup failures for local users.

Scope:

- Update README, RUNBOOK, SMOKE-TEST, and release docs with the latest
  acceptance state.
- Add troubleshooting for tmux, WebSocket protocol auth, Codex app-server
  prototype status, provider config isolation, and restricted-sandbox build
  limitations.
- Keep CLI-specific instructions explicit about not modifying real user config
  without consent.

Verification:

- Documentation review confirms commands are copy-pasteable and current.
- Smoke report links are consistent.

## Task 4: Release Risk Register

Goal: make release blockers and deferred scope visible.

Scope:

- Maintain a risk register covering browser terminal smoke, real provider
  prompt behavior, adapter CLI drift, Web production build environment limits,
  local credential handling, and app-server prototype boundaries.
- Assign each risk a status: open, mitigated, accepted, or deferred.
- Link every release-blocking risk to a test, report, or manual evidence item.

Verification:

- Risk register is included in the final acceptance report.
- No release-blocking risk is left without evidence or owner.

## Task 5: Final Regression And Acceptance Gate

Goal: decide whether to tag a local-first release candidate.

Scope:

- Run the full local regression gate from MVP-8.
- Run browser smoke and real-provider prompt smoke in an unrestricted
  environment.
- Review all MVP-8 through MVP-10 artifacts.
- Update `CLAUDE.md`, `docs/DEVELOPMENT-PLAN.md`, and release docs with the
  final status.

Verification:

- Final acceptance report states one of: release candidate accepted, accepted
  with documented caveats, or blocked with concrete fixes.
