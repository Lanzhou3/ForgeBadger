# Phase 3: First-User Product Hardening - Context

**Gathered:** 2026-05-20T09:40:24+08:00
**Status:** Ready for planning
**Mode:** Auto-selected recommended defaults per user instruction to continue without waiting.

<domain>
## Phase Boundary

Phase 3 turns first-user beta friction into scoped hardening for local dependency readiness, provider/model recovery, Copilot state clarity, partial failure visibility, trial feedback quality, and Web E2E signal. It must preserve OpenForge's local-first AI CLI control-plane wedge and must not expand into autonomous execution, hosted collaboration, Codex Web turn input, Feishu approval authority, or remote execution.

</domain>

<decisions>
## Implementation Decisions

### Dependency And Runtime Failure States
- **D-01:** Treat dependency failures as product blockers only when they affect the local-first control loop: missing `tmux`, unsupported native Windows terminal runtime, and missing selected CLI runtime must surface as visible, actionable guidance in Dashboard, Settings, project launch, session open, and diagnostics surfaces.
- **D-02:** Reuse the existing Gateway dependency report and adapter discovery contracts before adding new checks. `terminalRuntime.mode` and adapter `available` / `launchEnabled` are the preferred source of truth; do not infer launchability from frontend labels.
- **D-03:** Preserve the Windows boundary: native Windows can use management UI, but browser terminal acceptance requires WSL/tmux evidence. Do not remove the Windows/WSL caveat without physical host smoke evidence.

### Provider And Copilot Recovery
- **D-04:** Provider recovery should point users to the exact missing layer: no compatible provider, missing active credential, missing active model, provider auth failure, provider network failure, provider rate limit, timeout, or invalid selected model.
- **D-05:** Recovery surfaces must not expose plaintext provider secrets, JWTs, attach tokens, or raw provider request payloads. Continue using redacted diagnostics and Provider SSOT summaries.
- **D-06:** Codex remains subscription/SDK-managed. Do not route Codex launch recovery through provider API-key/model configuration.

### Copilot State Ordering And Approval Clarity
- **D-07:** Copilot Web active-run updates must be monotonic. Later poll or gateway-event responses must not overwrite newer terminal states, higher event sequences, or newer pending-action data.
- **D-08:** `waiting_for_approval` remains a live run state and must stay visually coherent through refresh, approval, rejection, cancellation, and multiple tabs.
- **D-09:** Stale async requests should be guarded with request ordering or state freshness checks at the component/helper boundary, not by relying on current network timing.

### Partial Failure Visibility
- **D-10:** Settings, Copilot conversations, Copilot memory, model/provider, adapter discovery, and diagnostics panels should prefer explicit degraded/error states over empty panels.
- **D-11:** Each recoverable error state should include the next useful user action where practical, such as retry, open Models, export diagnostics, open Settings, or ask Copilot with the current source context.

### Trial Feedback And Evidence Routing
- **D-12:** Trial feedback must produce reproducible tasks: exact environment, command output, provider readiness state, browser console/network failures, reproduction steps, expected behavior, actual behavior, category, severity, mapped UX requirement, and follow-up phase.
- **D-13:** Keep external evidence caveats separate from implementation fixes. If a real provider credential, physical Windows/WSL host, or real browser terminal smoke is missing, record `Caveat` with owner/next step instead of claiming pass.

### Web E2E Signal
- **D-14:** E2E mocks for `/api/v1/*` should fail fast for unhandled routes. Existing permissive fallbacks should be tightened in touched specs, starting with Copilot and Models because they guard provider/Copilot recovery.
- **D-15:** Prefer stable selectors for assertions on critical Copilot/provider flows. Avoid selectors that depend only on article role or exact body copy when a `data-testid`, accessible name, or semantic component boundary is available.
- **D-16:** Test credentials must be clearly fake and should not resemble live secrets beyond redacted previews intentionally returned by API contracts.

### the agent's Discretion
- The implementation may choose exact UI copy, component extraction, and test file split boundaries as long as the resulting surfaces are actionable, localized, and consistent with existing shadcn/Tailwind patterns.
- The planner may consolidate closely related UX requirements into a smaller number of implementation slices, but every Phase 3 requirement `UX-01` through `UX-07` must be traced to a plan and verification evidence.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product And Roadmap Boundary
- `.planning/PROJECT.md` — current local-first product wedge, active requirements, and out-of-scope boundaries.
- `.planning/REQUIREMENTS.md` — Phase 3 requirement IDs `UX-01` through `UX-07`.
- `.planning/ROADMAP.md` — Phase 3 goal, success criteria, and planned slices.
- `.planning/DECISIONS-INDEX.md` — locked decisions that should not be re-litigated.
- `CLAUDE.md` — project architecture, commands, and current product snapshot.
- `docs/DEVELOPMENT-PLAN.md` — post-beta status and Phase C first-user hardening direction.
- `docs/superpowers/specs/2026-05-06-openforge-post-rc-roadmap-design.md` — approved A -> B -> C sequencing and Phase C priority order.

### Trial Evidence And Feedback
- `docs/TRIAL-CHECKLIST.md` — first-user checklist and evidence capture shape.
- `docs/TRIAL-FEEDBACK.md` — offline issue template and triage fields.
- `docs/TRIAL-RUNBOOK.md` — local trial procedure, WSL/tmux guidance, and troubleshooting notes.
- `docs/reports/beta-handoff-2026-05-10.md` — accepted beta boundary and residual Windows/Codex caveats.
- `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md` — Copilot product contract, covered paths, and residual provider/manual gaps.

### Architecture, API, And Tests
- `docs/TECH-ARCHITECTURE.md` — Gateway/Web split, terminal persistence, launch contract, credential policy, filesystem trust boundary.
- `docs/TEST-PLAN.md` — terminal, WebSocket, security, and E2E expectations.
- `docs/CI-CD-PLAN.md` — release gate commands and explicit caveat handling.
- `docs/API.md` — Copilot, diagnostics, provider, session, and Feishu API contracts.
- `packages/gateway/src/lib/dependency-check.ts` — Gateway dependency and terminal runtime status source of truth.
- `packages/web/src/lib/terminal-runtime.ts` — Web translation mapping for runtime modes.
- `packages/web/src/components/copilot/copilot-chat-panel.tsx` — Copilot conversation, active-run, polling, gateway-event, and error-state surface.
- `packages/web/src/lib/copilot.ts` — Copilot run state helpers, readiness helpers, error classification, and poll backoff.
- `packages/web/e2e/copilot.spec.ts` — Copilot E2E contract and strict fallback pattern.
- `packages/web/e2e/models.spec.ts` — provider/model E2E contract, currently still has a permissive fallback to harden.
- `packages/gateway/src/routes/copilot.ts` — backend Copilot lifecycle, provider, approval, and run state contract.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/gateway/src/lib/dependency-check.ts`: already reports `tmux`, `claude`, `opencode`, `codex`, and `terminalRuntime.mode`; reuse for dependency/runtime guidance.
- `packages/web/src/lib/terminal-runtime.ts`: already maps runtime modes to localized copy; extend here rather than duplicating string switches.
- `packages/web/src/lib/copilot.ts`: already contains `isCopilotRunLive`, `shouldKeepCopilotActiveRunState`, error-message mapping, and poll backoff helpers; strengthen this helper layer before adding component-local ad hoc guards.
- `packages/web/src/components/copilot/copilot-chat-panel.tsx`: already shows capability, provider setup, local error, and message-load failure banners; extend these patterns for partial failures.
- `packages/web/e2e/copilot.spec.ts`: already has a strict unhandled `/api/v1/*` 404 fallback and `copilot-message-bubble` test id helper; use it as the pattern for other specs.

### Established Patterns
- Gateway owns API, process, dependency, diagnostics, and integration behavior; Web must remain a SPA client consuming `/api/v1`.
- UI copy is localized through `packages/web/src/lib/i18n.ts`; new user-facing hardening copy should be added there, not inline-only.
- Web server state uses TanStack Query; recoverable partial failures should stay visible while allowing unaffected panels to continue rendering.
- Tests use focused package commands first; broad release gates remain documented and should not be claimed if environment-gated.

### Integration Points
- Dashboard health cards already consume `getDependencies` and `terminalRuntime`; Phase 3 can make dependency remediation clearer there.
- Settings has adapter, Feishu, audit, and diagnostics cards; Phase 3 should add visible adapter/discovery error handling and recovery actions where missing.
- Project detail launch options already use adapter discovery and disabled options; Phase 3 can make no-launchable-runtime guidance more actionable.
- Session detail already shows connect errors instead of an infinite preparing state; Phase 3 can improve remediation links/copy if needed.
- Copilot panel active-run state is touched by send success, approval decisions, polling, gateway events, and conversation selection; plan should avoid stale async overwrites across all paths.

</code_context>

<specifics>
## Specific Ideas

- Start with the user's reported review items, but verify each against current code before implementing. Some older findings are already fixed, including Copilot message-load error display, visibility-aware polling/backoff, and strict Copilot E2E fallback.
- Treat `models.spec.ts` permissive fallback as a live Phase 3 candidate because it still returns success for unhandled `/api/v1/*`.
- Prioritize high-signal fixes that a first beta user can feel: clear blockers, retry paths, no invisible empty panels, and no stale Copilot state.

</specifics>

<deferred>
## Deferred Ideas

- Feishu project-manager ledger remains Phase 4.
- SSH/remote execution and hosted collaboration remain Phase 5 or later.
- Codex app-server Web prompt/turn input remains out of scope until transcript retention, consent, and security requirements are designed.
- Natural-language Feishu approvals and terminal control remain out of scope.

</deferred>

---

*Phase: 3-First-User Product Hardening*
*Context gathered: 2026-05-20T09:40:24+08:00*
