# Codebase Map: Concerns

## Active Concerns

- Root `MEMORY.md` still contains stale wording that PR #2 is open even though the PR has merged. Phase 1 should refresh this source of truth.
- `AGENTS.md` still describes the product as "MVP Phase 0 / early infrastructure" while `CLAUDE.md`, `docs/DEVELOPMENT-PLAN.md`, and `MEMORY.md` describe post-beta readiness.
- `docs/reports/trial-readiness-2026-05-06.md` preserves an older `blocked` decision even though later browser-terminal and Claude-permission evidence closed that historical caveat.
- `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md` still says PR #2 is open against `master`; the PR has merged.
- Live Copilot provider evidence is not recorded without a disposable provider credential.
- Physical Windows/WSL smoke is still a platform caveat.
- First-user feedback is needed to decide which Phase C hardening items are real product blockers rather than theoretical polish.
- Public Feishu webhook exposure must not reuse the guarded test adapter assumptions without signature verification and replay controls.
- Feishu and Copilot approval semantics are tightly coupled; natural-language approval must remain non-authoritative.
- SSH/remote execution changes the threat model and must remain out of current beta evidence work.
- Web Copilot review found possible state-ordering risk in active run refreshes and partial user-visible error gaps in Settings/Copilot panels.
- Several Web E2E files still use broad `/api/v1/*` fallback mocks and exact-copy selectors; these lower regression signal for contract changes.

## Safe Defaults

- Fail closed on unknown integration policy, identity mode, source, or tenant mapping.
- Preserve explicit approval, audit, and redaction before side effects.
- Keep Codex app-server prompt/turn input disabled unless a later phase designs transcript retention and consent.
- Prefer documentation caveats over false-green release claims.

## Confirmed Fixed From Prior Review

- Gateway session recovery `removeSession` now takes `userId` and updates by `WHERE id = ? AND user_id = ?`.
- Copilot live-run concurrency includes `waiting_for_approval` and is backed by a DB partial unique index on live statuses.
- Feishu inbound rejects disabled/emergency-disabled configs, unknown identity mode, empty or mismatched chat allowlists, unmapped users, cross-tenant projects, replayed accepted message ids, active Copilot runs, and per-chat rate limit overflow.
- Feishu inbound redacts user text before Copilot persistence, provider request context, audit summaries, and API response payloads.
- Feishu outbound approval policy validates identity mode, target allowlist, and task assignee mapping before executing approved outbound actions.
