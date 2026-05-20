# Phase 03: First-User Product Hardening - Research

**Researched:** 2026-05-20T09:55:00+08:00
**Status:** Ready for planning
**Research mode:** Inline recovery after researcher subagent compact failure.

## User Constraints

Copied from `03-CONTEXT.md`; planner MUST honor these.

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

## Project Constraints From AGENTS.md

- Gateway owns REST, WebSocket, terminal, process, repository, diagnostics, and integration behavior; Web stays a SPA client. [VERIFIED: AGENTS.md]
- All REST APIs stay under `/api/v1` and use the `{ code, data, message }` / `{ code, message, details }` envelope. [VERIFIED: AGENTS.md]
- Terminal persistence must remain `tmux`; terminal history is recovered from `tmux capture-pane`, not SQLite. [VERIFIED: AGENTS.md]
- Boundary inputs need schema validation, tenant-owned data needs `user_id` scoping, and secrets must not be logged or committed. [VERIFIED: AGENTS.md]
- Frontend changes should use existing React, TanStack Query, Tailwind, shadcn-style components, lucide icons, and i18n keys. [VERIFIED: AGENTS.md]
- Completion claims require relevant verification commands or explicit skip reasons. [VERIFIED: AGENTS.md]

## Standard Stack

- Backend unit/integration tests use `node:test` through `pnpm --dir packages/gateway test ...`. [VERIFIED: `CLAUDE.md`, `.planning/codebase/stack.md`]
- Frontend unit tests use Vitest through `pnpm --dir packages/web vitest run ...`. [VERIFIED: `CLAUDE.md`, `.planning/codebase/stack.md`]
- Web E2E tests use Playwright under `packages/web/e2e`. [VERIFIED: `.planning/codebase/stack.md`]
- Runtime dependency status is already centralized in `packages/gateway/src/lib/dependency-check.ts` with `TerminalRuntimeMode = "native_tmux" | "wsl_required" | "tmux_missing"`. [VERIFIED: codebase]
- Copilot Web state helpers already live in `packages/web/src/lib/copilot.ts`; this file contains live-run detection, monotonic active-run comparison, error mapping, and poll backoff. [VERIFIED: codebase]
- User-facing Web strings are centralized in `packages/web/src/lib/i18n.ts`; new recovery copy should be added there instead of hardcoding English/Chinese in components. [VERIFIED: codebase]

## Architecture Patterns

### Dependency And Runtime Readiness
- Use Gateway dependency reports as authority: `checkOpenForgeRuntimeDependencies()` returns dependency availability plus terminal runtime mode/message. [VERIFIED: codebase]
- Dashboard already consumes `getDependencies()` and maps `terminalRuntime.mode` through `terminalRuntimeTranslationKey()`. [VERIFIED: codebase]
- Project detail launch options already consume adapter discovery and disable unavailable or launch-disabled adapters. [VERIFIED: codebase]
- Session detail already prevents indefinite preparing after connect errors through `shouldAutoConnectSession()` / `shouldShowSessionPreparing()` helpers and a visible fallback error card. [VERIFIED: codebase]

### Provider And Copilot Recovery
- Copilot provider readiness is already partly represented through `getCopilotCapabilities()` and `providerConfigured`. [VERIFIED: codebase]
- `packages/web/src/lib/i18n.ts` already contains granular Copilot provider readiness and provider error copy, including missing provider, missing active credential, missing active model, auth failure, rate limit, unavailable, network failure, stream parse failure, timeout, and invalid model-selection errors. [VERIFIED: codebase]
- `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md` records that provider setup recovery is covered by current Copilot page blockers and tests, but first-user confirmation remains open. [VERIFIED: docs]

### Copilot State Ordering
- `shouldKeepCopilotActiveRunState()` currently keeps newer `updatedAt`, higher event sequence, newer pending-action timestamps, and terminal states over stale live states for the same run id. [VERIFIED: codebase]
- `copilot-chat-panel.tsx` applies active-run state from send success, approval/rejection, polling, and Gateway events. These paths should be verified together because stale responses can arrive from multiple sources. [VERIFIED: codebase]
- Polling is already visibility-aware and exponential up to 5 seconds via `getCopilotRunPollDelayMs()`. The old fixed-interval polling concern appears stale for current code. [VERIFIED: codebase]
- Conversation message load failure already renders a destructive banner and suppresses empty chat fallback. The old "empty chat on load failure" concern appears stale for current code. [VERIFIED: codebase]

### Partial Failure Surfaces
- Settings currently shows Feishu status load failure, but adapter discovery and audit log panels need explicit error-state review because their queries only expose loading/data in the inspected top section. [VERIFIED: codebase]
- Copilot memory panel already accepts an `error` boolean and renders a memory load failure state. [VERIFIED: codebase]
- Models page still needs review for query failure behavior, but E2E mock fallback is the most obvious live gap in `models.spec.ts`. [VERIFIED: codebase]

### E2E Strictness
- `packages/web/e2e/copilot.spec.ts` now fails fast for unhandled `/api/v1/*` routes with HTTP 404 and an explicit message. The old broad success fallback concern appears stale for Copilot. [VERIFIED: codebase]
- `packages/web/e2e/models.spec.ts` still fulfills unhandled `/api/v1/**` with a success envelope at the end of its route handler. This is a live regression-signal gap for Phase 3. [VERIFIED: codebase]
- `packages/web/e2e/models.spec.ts` uses `test-minimax-token` as entered test input and returns `secretPreview: "sk-...test"` from mock API response. The old finding about entering `sk-minimax-test` as a plaintext credential appears stale, but preview-like response strings should remain clearly redacted contract data. [VERIFIED: codebase]

## Don't Hand-Roll

- Do not add a parallel dependency/readiness model in Web. Use `getDependencies()`, adapter discovery, and diagnostics contracts. [HIGH confidence: codebase]
- Do not add new API routes in Next.js. Gateway remains the API/process owner. [HIGH confidence: AGENTS.md]
- Do not introduce a second Copilot active-run freshness algorithm inside the component. Strengthen `packages/web/src/lib/copilot.ts` and add focused tests there. [HIGH confidence: codebase]
- Do not redesign provider storage/configuration for Phase 3. Provider SSOT and Codex subscription boundaries are locked. [HIGH confidence: `.planning/DECISIONS-INDEX.md`]
- Do not broaden E2E cleanup into a full rewrite of all oversized specs. Tighten touched critical specs and leave broad test-file splitting as a follow-up unless directly needed. [MEDIUM confidence: roadmap scope]

## Common Pitfalls

- **False-green dependency UX:** displaying "healthy" when `dependenciesQuery` fails or when `terminalRuntime` is absent can hide the exact blocker first users need. [VERIFIED: codebase risk]
- **Stale async overwrite:** applying a fetched run detail after cancellation/approval can regress visible status unless every state update goes through freshness checks and request ordering. [VERIFIED: codebase risk]
- **Generic provider recovery:** showing only "configure provider" when the real issue is missing model or provider auth failure creates unreproducible user feedback. [VERIFIED: docs + i18n keys]
- **Permissive mocks:** success fallbacks in E2E route handlers mask wrong endpoints and contract drift. `models.spec.ts` still has this pattern. [VERIFIED: codebase]
- **Caveat erasure:** docs must not turn live-provider or Windows/WSL caveats into pass claims without real external evidence. [VERIFIED: roadmap/docs]
- **Secret leakage in reports:** trial feedback and diagnostics must continue to warn against pasted API keys, JWTs, attach tokens, private keys, and unrelated project secrets. [VERIFIED: `docs/TRIAL-FEEDBACK.md`, `docs/TRIAL-CHECKLIST.md`]

## Live Gap Inventory

| Area | Current Evidence | Planning Implication |
|------|------------------|----------------------|
| Dependency/runtime guidance | Gateway and Dashboard have primitives; Settings/project/session need user-facing error-action review. [VERIFIED: codebase] | Plan a focused Web/i18n/test slice before adding new backend APIs. |
| Provider/Copilot recovery | Many error keys and capability states already exist. [VERIFIED: codebase] | Plan should verify existing behavior and fill missing UI/test paths rather than duplicate backend logic. |
| Copilot monotonic state | Helper and tests exist for stale poll data; component has multiple async update sources. [VERIFIED: codebase] | Plan should add request-order tests/helpers for event/poll/approval interaction if missing. |
| Partial Settings failure | Feishu has error display; adapter/audit query failures need explicit review. [VERIFIED: codebase] | Plan should add degraded states and unit/E2E coverage for visible errors. |
| Trial feedback routing | Templates already include many fields. [VERIFIED: docs] | Plan should sharpen UX requirement mapping and add exact reproduction/task output guidance. |
| Models E2E fallback | End route handler fulfills success envelope for unhandled routes. [VERIFIED: codebase] | Plan must change to strict 404 fallback and update tests if hidden route assumptions fail. |

## Recommended Plan Slices

### 03-01 — Dependency And Runtime Failure States
- Primary files: `packages/web/src/app/(dashboard)/page.tsx`, `packages/web/src/app/(dashboard)/settings/page.tsx`, `packages/web/src/app/(dashboard)/projects/[id]/page.tsx`, `packages/web/src/app/(dashboard)/sessions/[id]/page.tsx`, `packages/web/src/lib/terminal-runtime.ts`, `packages/web/src/lib/i18n.ts`.
- Secondary tests: existing frontend tests for session connect state, plus new focused tests for runtime translation/action helpers if helpers are extracted.
- Acceptance target: missing `tmux`, `wsl_required`, no launchable adapter, adapter discovery failure, and session connect failure each show actionable guidance without pretending terminal support is healthy.

### 03-02 — Provider/Copilot Recovery And State Clarity
- Primary files: `packages/web/src/lib/copilot.ts`, `packages/web/src/components/copilot/copilot-chat-panel.tsx`, `packages/web/src/lib/i18n.ts`.
- Secondary tests: `packages/web/src/lib/copilot.test.ts`, Copilot E2E cases that simulate stale run responses and provider readiness blockers.
- Acceptance target: all active-run updates use monotonic/request-order guards; `waiting_for_approval`, cancelled, failed, and completed states cannot be overwritten by stale running/queued responses.

### 03-03 — Trial Checklist And Feedback Routing
- Primary files: `docs/TRIAL-CHECKLIST.md`, `docs/TRIAL-FEEDBACK.md`, `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml` if present.
- Acceptance target: feedback template maps to `UX-01` through `UX-07`, captures exact reproduction fields, keeps manual evidence caveats, and warns against secrets.

### 03-04 — Web E2E Mocks, Selectors, And Regression Signal
- Primary files: `packages/web/e2e/models.spec.ts`, `packages/web/e2e/copilot.spec.ts`.
- Secondary tests: run the focused Playwright specs if a Web server is available; otherwise run static/unit checks plus document sandbox caveat.
- Acceptance target: unhandled `/api/v1/*` routes in touched specs fail fast; critical provider/Copilot assertions use stable selectors or accessible names; mock test secret input remains fake/redacted.

## Validation Architecture

### Test Layers
- **Frontend unit/helper tests:** `pnpm --dir packages/web vitest run src/lib/copilot.test.ts src/lib/session-connect-state.test.ts` for Copilot state and session connection helpers. [VERIFIED: codebase]
- **Frontend component/page type safety:** `pnpm --dir packages/web typecheck` for TS/i18n/component changes. [VERIFIED: project commands]
- **Web E2E focused checks:** `pnpm --dir packages/web exec playwright test e2e/copilot.spec.ts e2e/models.spec.ts --project=chromium` for strict mocks and user-visible recovery flows. [VERIFIED: project commands]
- **Gateway narrow checks if backend contracts change:** `pnpm --dir packages/gateway test test/diagnostics.test.ts test/copilot-routes.test.ts` only if Phase 3 edits Gateway diagnostics/Copilot contracts. [VERIFIED: project commands]
- **Docs/static checks:** `rg` checks for `UX-01|UX-02|...|UX-07`, `Caveat`, and forbidden secret examples in trial docs after updates. [VERIFIED: docs]

### Sampling Strategy
- After each Web helper/component task: run the most relevant Vitest file plus `pnpm --dir packages/web typecheck`.
- After E2E mock changes: run focused Playwright spec if local loopback is available; if sandbox blocks listeners, record exact skip reason and run `pnpm --dir packages/web typecheck`.
- Before Phase 3 closeout: run focused Web unit/typecheck/E2E commands and `git diff --check`; run backend tests only for backend-touching plans.

### Manual-Only Evidence
- Physical Windows/WSL terminal behavior remains manual-only and cannot be satisfied by Ubuntu CI. Keep `Caveat` unless real host evidence is attached. [VERIFIED: docs]
- Live provider smoke remains manual-only without disposable provider credentials. Keep `Caveat` unless the smoke output is recorded without secrets. [VERIFIED: docs]

### Coverage Mapping
| Requirement | Automated Evidence Target | Manual Evidence Target |
|-------------|---------------------------|------------------------|
| UX-01 | Runtime/adapters visible error tests, Web typecheck | Physical Windows/WSL caveat stays explicit |
| UX-02 | Copilot/provider readiness tests, i18n coverage | Live provider credential smoke remains caveat if unavailable |
| UX-03 | Copilot monotonic state helper and E2E stale-response tests | Multi-tab manual observation optional |
| UX-04 | Trial docs include reproducible triage fields | Completed first-user feedback attachment later |
| UX-05 | `shouldKeepCopilotActiveRunState` and request-order tests | None |
| UX-06 | Settings/Copilot partial failure visible tests | None |
| UX-07 | Strict fallback E2E tests/selectors | None |

## Confidence Summary

- **HIGH:** Current code already contains dependency report primitives, Copilot state helpers, provider error copy, and strict Copilot E2E fallback. [VERIFIED: codebase]
- **HIGH:** `models.spec.ts` still has a permissive E2E fallback and should be fixed in Phase 3. [VERIFIED: codebase]
- **MEDIUM:** Settings adapter/audit failure states likely need hardening; exact UI gap should be verified before editing the component. [VERIFIED: partial code scan]
- **MEDIUM:** Additional request-order protection may be needed beyond current `shouldKeepCopilotActiveRunState`; planner should require source inspection before changes. [VERIFIED: codebase risk]
- **LOW:** No external docs were needed because this phase is primarily repo-local product hardening; current browser/runtime behavior still needs live validation where environment-gated. [ASSUMED based on scope]

## Research Complete

The planner can create Phase 3 plans from this file, `03-CONTEXT.md`, and the roadmap. The safest sequence is:

1. Runtime/dependency user guidance.
2. Copilot/provider state and recovery.
3. Trial feedback docs.
4. E2E strictness and selectors.
