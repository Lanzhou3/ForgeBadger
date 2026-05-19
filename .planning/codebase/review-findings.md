# Codebase Map: Review Findings

This file captures the 2026-05-19 read-only review pass used to bootstrap GSD planning.

## Product And Roadmap

- Current direction is post-beta trust closure, not new feature expansion.
- Next priority order: external evidence closure, public Feishu webhook safety, first-user product hardening, then Feishu project-manager ledger.
- Stale docs should be refreshed early: `AGENTS.md`, `MEMORY.md`, `docs/reports/trial-readiness-2026-05-06.md`, and `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md`.

## CI And Release Gates

- `pnpm smoke:copilot-provider` exists but is not a default CI gate because it needs a disposable live provider credential.
- `.github/workflows/ci.yml` runs `e2e/mvp1-smoke.spec.ts`; `docs/CI-CD-PLAN.md` still lists `gate-d-smoke` plus `mvp1-smoke` for the fuller E2E command.
- CI sets `RUN_TMUX_TESTS=1`, but release evidence should also include an explicit focused tmux test command output.
- Physical Windows/WSL smoke is intentionally outside Ubuntu CI and must remain a caveat until real-host evidence exists.

## Web And E2E

- `packages/web/src/lib/copilot.ts` uses timestamp, event sequence, pending-action timestamp, and terminal-status logic for active-run replacement; Phase 3 should tighten this into a clear monotonic/request-order contract.
- `packages/web/src/components/copilot/copilot-chat-panel.tsx` applies active-run state from poll and Gateway-event refresh paths; Phase 3 should add race-oriented tests for out-of-order responses.
- Settings and Copilot message-load failures need more recoverable user actions in partial failure states.
- Web E2E should move broad `/api/v1/*` fallbacks toward fail-fast mocks and prefer stable selectors for key product assertions.

## Gateway Backend

- Confirmed fixed: `packages/gateway/src/services/db-session-recovery-store.ts` scopes `removeSession` by `id` and `user_id`.
- Confirmed fixed: `packages/gateway/src/db/migrations/0020_copilot_live_run_constraint.sql` enforces one live Copilot run per user for `queued`, `running`, and `waiting_for_approval`.
- Confirmed fixed: `packages/gateway/src/routes/integrations-feishu.ts` enforces Feishu inbound config, identity, allowlist, mapping, project ownership, replay, rate limit, active-run, and redaction checks.
- Confirmed fixed: `packages/gateway/src/routes/copilot.ts` validates Feishu outbound target and assignee policy before approved action execution.

## GSD Implications

- Phase 1 should be treated as a documentation plus external evidence closure phase.
- Phase 2 should not start public Feishu webhook implementation until the signature/replay/rate-limit contract is written.
- Phase 3 should contain the Web/Copilot state and E2E robustness items found in review.
- Backend Feishu/Copilot critical issues from the earlier hostile review are no longer the immediate GSD blockers; keep them as regression anchors.
