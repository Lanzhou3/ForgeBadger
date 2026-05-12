# Platform AI Copilot Product Audit

> Date: 2026-05-13
> Scope: Platform AI Copilot first-release product readiness
> Decision: product-contract and automated gates are strong; keep the broader
> "product-grade Copilot" goal open until real provider/manual trial evidence
> and Phase C first-user hardening are closed.

## Objective Restatement

Build Copilot into a product-grade OpenForge assistant. For this release that
means a provider-backed, read-heavy, approval-gated platform assistant that can
answer operational questions, inspect OpenForge state through safe tools, and
prepare bounded actions without autonomous terminal, shell, filesystem, tmux, or
Codex app-server turn control.

## Prompt-To-Artifact Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| Provider-backed Copilot text runs | `docs/API.md` documents `/api/v1/copilot/runs`; `packages/gateway/test/copilot-model-client.test.ts` covers OpenAI Responses-style, Anthropic Messages-style, OpenAI-compatible opt-in, missing credential, timeout/cancel, HTTP failure classification, and provider-request redaction. | Covered by contract and backend tests |
| Explicit Provider/Model selection in Web | `packages/web/e2e/copilot.spec.ts` covers selected provider/model run creation and metadata display; `packages/web/src/lib/copilot.test.ts` covers selectable providers plus credential-ready and active-model filtering. | Covered by Web unit and E2E tests |
| Reject visually selectable providers without active credentials | Commit `068e41d` added selectable-provider filtering; `packages/web/e2e/copilot.spec.ts` includes "skips providers without active credentials". | Covered |
| Reject visually selectable providers without active models | Commit `1d24513` added active-model filtering for Web provider selection; `packages/web/e2e/copilot.spec.ts` includes "skips providers without active models". | Covered |
| First-user provider setup recovery | The Copilot page now explains provider setup blockers as no compatible provider, missing active credential, or missing active model; `packages/web/src/lib/copilot.test.ts` covers readiness classification and `packages/web/e2e/copilot.spec.ts` covers the visible credential/model recovery messages. `docs/TRIAL-CHECKLIST.md` asks trial users to record the visible blocker. | Covered |
| Project/session launch context | `docs/API.md` documents bounded tenant-scoped `sourceRefId` model-context injection for `source: "project"` and `source: "session"`; `packages/gateway/test/copilot-routes.test.ts` covers project context, session context, and cross-tenant non-leakage. | Covered |
| Old live run recovery | `docs/API.md` documents `GET /copilot/runs` live-run recovery beyond the requested history limit; `packages/gateway/test/copilot-routes.test.ts` covers an older `running` run still appearing with `limit=20`, so Web can select and cancel it. | Covered |
| Web/Gateway model timeout alignment | `docs/API.md` documents Gateway's 60 second model timeout and Web's 65 second Copilot run creation timeout; `packages/web/src/lib/api.test.ts` verifies the longer client timeout. | Covered |
| Read-heavy tool boundary | `docs/API.md` allowlists dashboard, project/session, adapter discovery, recent activity, diagnostics summary, and memory read tools; `packages/gateway/test/copilot-tools.test.ts` and `packages/gateway/test/copilot-routes.test.ts` cover read-tool execution. | Covered |
| Approval-gated actions only | `docs/API.md` documents prepare tools and canonical stored pending-action approval; route/Web tests cover approve, reject, duplicate submission prevention, waiting-for-approval cancel, audit rows, no rewrite of already decided actions, unknown stored action rejection, and invalid troubleshooting-step approval rejection. | Covered |
| Bounded session-create drafts | Commits `fe2ea26` and `165d4cf` restrict `openforge.propose_session_create` to supported terminal adapters and projects visible to the current user; `packages/gateway/test/copilot-tools.test.ts` covers invalid adapters, cross-tenant projects, pending-action creation, and no direct session creation. The approval route also revalidates canonical stored drafts so invalid adapters or deleted projects stay pending with `copilot_session_draft_invalid`. | Covered |
| No autonomous terminal/shell/Codex turn input | `docs/API.md` lists explicit non-goals: no browser terminal input control, raw shell, direct filesystem write, Codex app-server prompt/turn UI, automatic tmux input, or autonomous development loop. `docs/TRIAL-CHECKLIST.md` and `docs/TRIAL-FEEDBACK.md` require manual confirmation. | Covered by contract; manual confirmation still required |
| Prompt/provider/tool-output safety | `docs/API.md` documents prompt redaction, provider-request redaction, bounded tool output, and fail-closed blocked output; backend tests cover secret redaction, private-key output blocking, and redacted failure events. | Covered |
| Explicit tenant-scoped memory | `docs/API.md` documents explicit memory state and non-blocking `memory_recall_skipped` visibility when active recall fails; `packages/gateway/test/copilot-memory-repository.test.ts` covers tenant scoping and SQLite FTS; route/tool tests cover memory search/get/propose/write flows. | Covered |
| Lifecycle, cancel, timeout, concurrency | `packages/gateway/test/copilot-routes.test.ts` covers run lifecycle, cancellation, pending-action cancellation, timeout, audit, and per-user live-run guard; Web E2E covers active-run and waiting-for-approval UX. | Covered |
| Diagnostics capability/count metadata | `docs/API.md` documents diagnostics export including Copilot capability and memory counts; commit `a877554` aligned the Web diagnostics export type and API test with the Gateway contract. | Covered |
| Provider SSOT recovery diagnostics | `docs/API.md` documents Provider SSOT diagnostics without secrets; `packages/gateway/test/diagnostics.test.ts` covers provider/model/credential counts, api format distribution, per-provider readiness, tenant scoping, and absence of plaintext provider secrets. | Covered |
| Product smoke instructions | `docs/TRIAL-CHECKLIST.md` has a Copilot Smoke section; `docs/TRIAL-FEEDBACK.md` captures provider, prompt, read-tool, pending-action, memory, and no-terminal-control evidence. | Covered for trial users |
| Maintainer smoke instructions | `docs/SMOKE-TEST.md` now includes a maintainer Copilot smoke section and pass criteria. | Covered by this audit slice |
| Release/PR state | PR #2 (`feat: add release gates and platform copilot`) is open and non-draft. CI state is refreshed after each pushed Copilot-hardening commit and should be treated as the live source for merge readiness rather than static audit text. | Covered as release gate process |

## Residual Gaps

- No real provider manual smoke result is recorded in this audit. Automated
  tests cover provider contracts and Web behavior, but they do not prove a
  live user prompt against a disposable OpenAI or Anthropic credential.
- No physical Windows/WSL manual smoke was run in this pass. That remains a
  broader OpenForge platform caveat, especially for terminal-dependent flows.
- Copilot remains intentionally non-autonomous. It is product-ready only for
  the first release scope above, not for self-directed coding, shell execution,
  terminal control, or Codex app-server prompt workflows.
- Phase C first-user hardening remains open in `MEMORY.md`: dependency failure
  states, CLI availability recovery, diagnostics review, platform-specific
  remediation, and real user feedback. Provider configuration recovery now has
  more specific Copilot-page blocker messages, but still needs first-user
  confirmation with a disposable provider.

## Acceptance Judgment

The current branch has enough evidence to treat the first Platform AI Copilot
release contract as implemented and regression-gated. The broader objective
"make Copilot product-grade" should stay open because product-grade acceptance
still needs manual provider smoke evidence and first-user hardening feedback,
not only API contracts, mocked Web E2E, and green CI.
