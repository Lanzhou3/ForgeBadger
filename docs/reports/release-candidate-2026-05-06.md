# Release-Candidate Report

> Date: 2026-05-06
> Scope: MVP-10 local-first release candidate and beta feedback loop
> Decision: accepted with caveats for user testing

## Candidate Contents

- Repeatable local smoke command planner: `scripts/smoke-local-release.mjs`.
- Guarded Codex app-server Gateway prototype:
  - `packages/gateway/src/services/codex-app-server-manager.ts`
  - `packages/gateway/src/routes/codex-app-server.ts`
- Local diagnostics export:
  - `packages/gateway/src/services/diagnostics.ts`
  - `packages/gateway/src/routes/diagnostics.ts`
- API docs updated for diagnostics and Codex app-server endpoints.
- Release risk register recorded below.

## Packaging Evidence

- `pnpm build:npm`: pass outside sandbox.
- `pnpm verify:npm`: pass.
- `pnpm smoke:npm`: pass.
- Tarball from smoke: `/tmp/openforge-npm-smoke-wEVw1p/pack/openforge-0.1.0.tgz`.
- `openforge doctor` in smoke:
  - `tmux`: ok, `tmux 3.4`
  - `claude`: ok, `2.1.126 (Claude Code)`
  - `codex`: ok, `codex-cli 0.128.0`
  - `opencode`: optional-missing, command timeout after 3000 ms

The package verifier checks required Gateway/Web/CLI artifacts and rejects
credentials, local databases, build caches, user config directories, logs, and
unexpected reports in package artifact roots.

## Diagnostics Export

`GET /api/v1/diagnostics/export` returns local-only, authenticated diagnostics
with redaction. Covered by:

- `test/diagnostics.test.ts`
- `test/diagnostics-routes.test.ts`

No telemetry upload is implemented.

## Risk Register

| Risk | Status | Evidence / Owner |
|------|--------|------------------|
| Real browser terminal rendering, resize, reconnect | Closed | `docs/reports/browser-terminal-smoke-2026-05-06.md` |
| Real Claude Code permission prompt behavior | Closed | `docs/reports/claude-permission-smoke-2026-05-07.md` |
| Web production build in restricted sandbox | Accepted environment caveat | `pnpm build:npm` passes outside sandbox; sandbox failure is Turbopack process/port restriction |
| Local credential handling | Mitigated | API key encryption tests, session launch env tests, diagnostics redaction tests |
| Codex app-server prototype boundaries | Mitigated for prototype | No terminal mixing, loopback/capability token, token response redaction, per-user limit |
| Adapter CLI drift | Accepted local dependency risk | Adapter discovery and `openforge doctor`; optional CLIs remain optional |

## Acceptance

The automated local-first package and regression evidence is green where
recorded. A-stage first-user trial readiness is now closed by the browser
terminal and real Claude permission-prompt evidence in
`docs/reports/browser-terminal-smoke-2026-05-06.md` and
`docs/reports/claude-permission-smoke-2026-05-07.md`.

## 2026-05-10 Beta Handoff Update

Phase B Codex Background Tasks, Provider/Codex boundary hardening, Windows/tmux
CLI guidance, and release-sized package gates are covered by
`docs/reports/beta-handoff-2026-05-10.md` and
`docs/reports/phase-b-codex-app-server-acceptance-2026-05-10.md`.

The beta decision keeps Codex app-server prompt/turn input disabled in Web.
`/turn` remains an authenticated Gateway prototype route that returns `403`
unless `OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1` is explicitly set.
