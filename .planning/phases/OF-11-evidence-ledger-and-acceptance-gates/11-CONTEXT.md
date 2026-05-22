# Phase 11: Evidence, Ledger, And Acceptance Gates - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 11 closes the v1.2 Project Manager Web workflow by adding bounded
post-creation evidence attachment, upgrading the ledger from a small summary
into a safe review timeline, and documenting/test-proving the end-to-end
project-manager workflow. This phase stays inside the existing project detail
Project Manager tab and existing Gateway-owned project-manager contract.

Phase 11 does not add raw evidence blob storage, terminal transcript storage,
Feishu or Copilot write authority, a global project-manager dashboard, a kanban
board, a separate ledger route/tab, or new Gateway data-model scope unless a
planner proves a narrow backend bugfix is required to honor the existing API.

</domain>

<decisions>
## Implementation Decisions

### Evidence Reference Attachment

- **D-01:** Add the evidence attachment entry point inside the existing work item detail Sheet. Users should inspect a work item first, then attach evidence from that detail context.
- **D-02:** Do not add evidence attachment buttons directly to work item table rows. The table remains optimized for scanning, status, and detail entry.
- **D-03:** One evidence attachment submission creates exactly one evidence reference. Bulk attachment UI is deferred.
- **D-04:** The attachment form exposes only `kind`, `label`, `ref`, and `path`. Do not expose `sessionId`, `copilotRunId`, `feishuChatId`, `feishuMessageId`, or every API field in Phase 11.
- **D-05:** The attachment form must not include raw multiline evidence, terminal output, Feishu message body, provider payload, transcript, secret, or note/body paste areas.
- **D-06:** Add lightweight Web-side blocking for obvious sensitive or raw-content values in `ref` and `path`, including API keys, JWTs, private-key blocks, multi-line terminal transcripts, and provider payload-like blobs. Gateway remains the final validation authority.
- **D-07:** A failed evidence attachment should keep the detail Sheet and entered safe field values recoverable, show a local mutation error, and not clear the existing work item or ledger data.

### Ledger Timeline Review

- **D-08:** Replace the current five-row ledger summary with a full in-tab ledger timeline area inside the Project Manager tab. Do not add a separate ledger tab or a "view all" Sheet in Phase 11.
- **D-09:** Load 25 ledger events by default and provide a manual `Load more` control. Do not implement infinite scrolling.
- **D-10:** Add a concise event-type filter with these user-facing groups: `All`, `Status changes`, `Evidence`, `Manual completion`, and `Blockers`.
- **D-11:** The planner may map user-facing filter groups to one or more Gateway event types using the existing `eventType` query capability, local grouping, or another bounded approach that keeps the UX stable.
- **D-12:** Each ledger event should render as a safe summary card or row showing event type, work item title or ID, status, evidence count, Feishu reference count, and timestamp.
- **D-13:** Do not expand raw event details or evidence reference lists from ledger events in Phase 11. Evidence reference inspection belongs to the work item detail context and must still stay bounded.
- **D-14:** Distinguish blocker and manual-completion events with event-type badges plus short explanatory copy, for example that manual completion means completed without an evidence reference. Do not show raw manual reason text.

### Acceptance Path And Handoff

- **D-15:** Add one main Playwright happy path that proves the full v1.2 project-manager workflow: open a project, open the Project Manager tab, use the existing goal/work item flow, attach evidence from a work item detail, move or confirm status/done behavior, and observe the relevant ledger events.
- **D-16:** Phase 11 error/regression coverage should focus on evidence attachment failure, ledger load failure, and the Phase 10 evidence-free `done` guard. Do not expand into an exhaustive error matrix for every Project Manager mutation.
- **D-17:** Extend typed client and strict E2E mock coverage so endpoint drift still fails fast for the Project Manager workflow.
- **D-18:** Update `docs/TRIAL-CHECKLIST.md` and `docs/SUPPORT-DIAGNOSTICS.md`, and add a v1.2 closeout report under `docs/reports/`.
- **D-19:** Handoff docs must include an explicit forbidden-content list and acceptable evidence-reference examples. Forbidden content includes raw terminal transcripts, Feishu message bodies, provider payloads, API keys, JWTs, private keys, attach tokens, and unrelated project secrets. Acceptable examples include docs paths, test command names, report paths, issue or PR identifiers, and short reference IDs.

### the agent's Discretion

The user selected the recommended option for every discussed gray area. The
planner may choose exact component factoring, query key shapes, and whether the
ledger timeline uses cards or compact rows, as long as the locked decisions
above and the existing Phase 9/10 Project Manager tab style are preserved.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### GSD Scope

- `.planning/PROJECT.md` — v1.2 milestone direction, local-first product wedge, and Project Manager workflow boundaries.
- `.planning/REQUIREMENTS.md` — Phase 11 requirement IDs PMEV-01, PMEV-02, PMEV-03, PMQA-01, and PMQA-02.
- `.planning/ROADMAP.md` — Phase 11 goal, success criteria, and v1.2 backlog boundaries.
- `.planning/DECISIONS-INDEX.md` — Locked Gateway/Web, tenant, Copilot, Feishu, and local-first authority decisions.
- `.planning/phases/OF-09-project-manager-web-foundation/09-CONTEXT.md` — Prior locked decisions for Project Manager tab placement, typed client boundaries, and strict mocks.
- `.planning/phases/OF-10-goal-and-work-item-operations/10-CONTEXT.md` — Prior locked decisions for goal editing, work item operations, status movement, and deferred Phase 11 evidence/ledger scope.
- `.planning/phases/OF-10-goal-and-work-item-operations/10-SECURITY.md` — Phase 10 security closure and threat mitigations that Phase 11 must preserve.

### Project Manager Contract

- `docs/API.md` §Project Manager Ledger — Gateway-owned authority, endpoint list, status transitions, evidence reference fields, ledger event types, done guard, and sensitive-data exclusions.
- `packages/gateway/src/routes/project-manager.ts` — Existing zod schemas and route DTOs for evidence attachment and ledger reads.
- `packages/gateway/src/db/repositories/project-manager-repository.ts` — Existing evidence normalization, append semantics, ledger event writes, user/project scoping, and done/manual-completion behavior.

### Web Integration Points

- `packages/web/src/components/projects/ProjectManagerPanel.tsx` — Existing Project Manager tab, work item detail Sheet, create/status flows, ledger summary, and query invalidation patterns.
- `packages/web/src/lib/api.ts` — Typed Project Manager DTOs and client helpers, including `attachProjectManagerWorkItemEvidence` and `listProjectManagerLedger`.
- `packages/web/src/lib/api.test.ts` — Existing typed client test style for Project Manager URL, method, body, and error assertions.
- `packages/web/src/lib/i18n.ts` — Existing Project Manager labels, statuses, event names, and mutation copy.
- `packages/web/e2e/project-manager.spec.ts` — Strict Project Manager Playwright mock and workflow coverage to extend.
- `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` — Existing project detail tab wiring and active-tab loading boundary.

### Handoff And Trial Docs

- `docs/TRIAL-CHECKLIST.md` — Trial workflow path to update with the v1.2 Project Manager flow.
- `docs/SUPPORT-DIAGNOSTICS.md` — Support/reproduction/redaction guidance to update for Project Manager evidence and ledger failures.
- `docs/reports/v1.1-readiness-closeout-2026-05-21.md` — Previous closeout pattern to mirror for the new v1.2 closeout report.

### Codebase Maps

- `.planning/codebase/architecture.md` — Gateway/Web ownership split and high-risk boundaries.
- `.planning/codebase/stack.md` — Current Web/Gateway stack and focused verification commands.
- `.planning/codebase/testing.md` — Strict E2E mock guidance, Playwright selector guidance, and release-gate implications.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `ProjectManagerPanel` already owns the project-manager tab content and has `enabled`/`canLoad` query guards that Phase 11 should preserve.
- `ProjectManagerWorkItemDetailSheet` already provides the right detail context for an `Attach evidence` action.
- `attachProjectManagerWorkItemEvidence` and `listProjectManagerLedger` already exist in `packages/web/src/lib/api.ts`.
- Existing UI primitives include `Button`, `Badge`, `Card`, `Dialog`, `Sheet`, `Input`, `Label`, `Table`, `Textarea`, and `DropdownMenu`.
- Existing Project Manager i18n keys include status labels and event labels, including `evidence_attached`, `blocker_recorded`, `blocker_resolved`, and `manual_completion_recorded`.

### Established Patterns

- Project Manager state uses TanStack Query with project-scoped query keys and explicit invalidation after mutations.
- Web client helpers use `fetchJson`, canonical Gateway envelopes, `GatewayApiError`, and encoded path segments for user-controlled IDs.
- E2E mocks should return 404 for unhandled `/api/v1/*` routes and record the route for assertion.
- Gateway owns validation, tenant scoping, transition enforcement, ledger rows, and audit rows. Web can guide and pre-block obvious unsafe input but must not become the security authority.
- Documentation should preserve explicit `Pass`, `Caveat`, and `Blocked` language when evidence is not proven by real host or real external integration paths.

### Integration Points

- Extend `packages/web/src/components/projects/ProjectManagerPanel.tsx` for the evidence dialog, safe input guard, ledger timeline, filter, and load-more behavior.
- Extend `packages/web/src/lib/i18n.ts` for evidence attachment, ledger filters, load-more labels, sensitive-content validation, and safe event explanation copy.
- Extend `packages/web/src/lib/api.test.ts` for evidence attachment and ledger query shape.
- Extend `packages/web/e2e/project-manager.spec.ts` for the full v1.2 happy path, evidence mutation failure, ledger load failure, and done-guard regression.
- Update `docs/TRIAL-CHECKLIST.md`, `docs/SUPPORT-DIAGNOSTICS.md`, and add a v1.2 closeout report under `docs/reports/`.

</code_context>

<specifics>
## Specific Ideas

- Keep the UI quiet and operational: the ledger should feel like a control-plane timeline, not a project-management suite or analytics dashboard.
- Evidence references are pointers, not evidence bodies. The UI should repeatedly reinforce that a path, report name, command name, issue/PR ID, or short ref is acceptable.
- Manual completion is a guardrail event and should be visible as such, but the raw manual reason should not be exposed in the ledger timeline.
- `Load more` is preferred over infinite scroll so ledger retrieval remains deliberate and bounded.

</specifics>

<deferred>
## Deferred Ideas

- Bulk evidence attachment UI.
- Session/Copilot/Feishu reference-specific fields in the attachment form.
- Separate ledger tab.
- Ledger raw evidence reference expansion.
- Work-item-level ledger filtering.
- Exhaustive Project Manager mutation error matrix.
- Global project-manager dashboard, kanban board, and cross-project analytics remain future milestone work.

</deferred>

---

*Phase: 11-Evidence, Ledger, And Acceptance Gates*
*Context gathered: 2026-05-22*
