# Release Acceptance Report

> Date: 2026-05-04
> Scope: post-security-review release acceptance checkpoint
> Verdict: MVP-7 implementation-complete; formal release acceptance still waits
> on real browser permission-prompt smoke evidence.

## Summary

OpenForge remains aligned with the documented local-first MVP direction:
MVP-0 through MVP-7 implementation work is present in code and task documents,
but the development plan should not be declared fully closed until the remaining
manual browser permission-prompt smoke in `docs/SMOKE-TEST.md` is executed in
an unrestricted environment.

This checkpoint also records the security review fixes completed after the
2026-05-02 completion audit.

## Progress Verdict

| Area | Status | Notes |
|------|--------|-------|
| MVP-0 through MVP-6 implementation | Complete | Existing task docs and code evidence remain consistent with the 2026-05-02 audit. |
| MVP-7 implementation | Complete | Scaffold pack, template-from-project, direct Skill install hardening, snapshot restore, Agent activity filtering, role decision, and CI workflow are implemented. |
| Formal MVP-7 closure | Pending manual evidence | Browser permission-prompt UI evidence is still required. CLI adapter launch and temporary-copy prompt smoke evidence now exists. |
| Future hosted/cloud scope | Deferred | Hosted collaboration, cloud deployment, billing, hosted marketplace trust UX, autonomous remote execution, and richer executable/MCP/LSP plugin execution remain out of current scope. |

## Security Review Corrections

The 2026-05-04 security review identified critical and important issues that
were fixed before this checkpoint:

- `packages/gateway/src/services/tmux.ts` now launches tmux sessions with argv
  boundaries using `tmux new-session ... -- command args`, removing the shell
  command string construction path.
- `packages/gateway/src/server.ts` now registers the global `errorHandler`
  after route mounting so uncaught route errors use the project API envelope.
- `packages/gateway/src/websocket/terminal.ts` no longer accepts JWTs through
  query parameters; terminal JWT authentication uses the Authorization header
  or `Sec-WebSocket-Protocol`.
- `packages/gateway/src/websocket/events.ts` no longer accepts `?token=`;
  event WebSocket JWT authentication uses the Authorization header or
  `Sec-WebSocket-Protocol`.
- `packages/gateway/src/websocket/connection-limits.ts` adds simple global and
  per-user WebSocket connection limits for terminal and event channels.
- `packages/gateway/src/services/model-endpoint-health.ts` validates model
  health-check endpoints before fetch, requiring HTTPS and blocking loopback,
  private, link-local, and metadata targets, including DNS results.
- `packages/web/src/lib/ws.ts`, `packages/web/src/hooks/use-notifications.tsx`,
  and `packages/web/src/app/(dashboard)/sessions/[id]/page.tsx` were updated so
  JWTs are not placed in WebSocket URLs.

## Verification Evidence

Commands run in this checkpoint:

| Command | Result |
|---------|--------|
| `pnpm --filter @openforge/gateway typecheck` | Pass. |
| `pnpm --filter @openforge/web typecheck` | Pass. |
| `pnpm --filter @openforge/gateway test -- test/model-endpoint-health.test.ts test/terminal-ws.test.ts test/websocket-events.test.ts test/server.test.ts` | Pass: 35 tests passed. Required localhost binding approval. |
| `RUN_TMUX_TESTS=1 node --test --import tsx test/integration/tmux.test.ts` from `packages/gateway` | Pass: 2 tests passed. Required tmux socket approval. |
| `pnpm --filter @openforge/gateway test` | Pass: 301 tests passed. Required localhost binding approval for WebSocket tests. |
| `pnpm --filter @openforge/web test -- src/lib/ws.test.ts` | Pass: Vitest executed the Web test set, 13 files and 63 tests passed. |
| `git diff --check` | Pass before this report was added. |
| CLI adapter smoke | Pass: Claude Code, OpenCode, and Codex project create, config generation, session create, terminal attach/output, and stop all passed. See `docs/reports/cli-adapter-smoke-2026-05-04.md`. |
| Temporary real-config prompt smoke | Pass: Claude Code, OpenCode, and Codex each returned `OPENFORGE_SMOKE_OK` using copied config directories. See `docs/reports/realconfig-copy-prompt-smoke-2026-05-04.md`. |

Environment-limited checks not completed in this checkpoint:

- Manual browser smoke on `48731/48732` with a real browser.
- Real browser permission-prompt notification smoke.
- Web production build was not rerun in this checkpoint; the 2026-05-02 audit
  already records the restricted-sandbox Turbopack/process limitation.

## Required Manual Acceptance

Run `docs/SMOKE-TEST.md` outside the restricted sandbox with:

1. Gateway on `127.0.0.1:48731`.
2. Web console on `127.0.0.1:48732`.
3. A real browser with console/network inspection available.
4. `tmux` available to the Gateway process.
5. Claude Code installed and authenticated or configured with disposable
   credentials.

Acceptance remains pending until evidence is recorded for:

- Browser registration/login and dashboard navigation.
- Project create/import and config preview/apply.
- Session creation, terminal attach, resize, refresh reconnect, stop/restart.
- Real browser terminal prompt/response display using the embedded terminal.
- Claude permission notification producing both notification and activity rows.
- Usage and history pages rendering after session activity.

## Recommendation

Treat the project as **MVP-7 implementation-complete but not formally accepted**.
The next task should be a real-environment release smoke run and evidence
capture, not additional feature expansion.

Do not start hosted collaboration, cloud deployment, billing, hosted
marketplace, autonomous remote execution, or richer plugin executable/MCP/LSP
execution until the local-first release acceptance evidence is complete and a
new architecture review expands scope.
