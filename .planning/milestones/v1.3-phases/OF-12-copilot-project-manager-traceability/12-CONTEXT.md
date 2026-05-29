# Phase 12: Copilot Project-Manager Traceability - Context

**Gathered:** 2026-05-22T17:19:01+08:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 12 links Copilot runs, pending-action approvals, Project Manager work items, evidence refs, and ledger events into a safe traceability layer. It lets Copilot propose Project Manager work item creation, status updates, and evidence attachment, but all writes stay approval gated and Gateway owned.

This phase does not turn OpenForge into a generic project-management suite. It strengthens the local-first AI CLI control plane by making AI-assisted work auditable from prompt/run to approval to Project Manager state and evidence.

</domain>

<decisions>
## Implementation Decisions

### PM Write Proposal Granularity

- **D-01:** Project Manager write proposals use atomic Copilot pending actions. Each pending action performs exactly one Project Manager mutation.
- **D-02:** Phase 12 supports only three PM proposal types: `create_work_item`, `update_work_item_status`, and `attach_evidence`.
- **D-03:** Cross-action dependencies are not allowed. Every action must reference existing entity IDs such as `projectId`, `workItemId`, `copilotRunId`, `pendingActionId`, and optional `sessionId`.
- **D-04:** PM action execution failure is terminal. Failed PM actions must become `failed` and require a new proposal; they must not return to `pending` and must not auto-retry.

### Traceability Anchor

- **D-05:** Traceability uses both work item `evidenceRefs` and `ledgerEvents`. Evidence refs support the work item detail view; ledger events support audit timeline and filtering.
- **D-06:** Copilot evidence refs store a minimum structured set: `copilotRunId`, `pendingActionId`, optional `sessionId`, `kind`, `label`, and `status`.
- **D-07:** Ledger events store safe trace markers: `copilotRunId`, `pendingActionId`, `actionType`, `targetType`, `targetId`, `evidenceRefCount`, `approvalStatus`, and `executionStatus`.
- **D-08:** Project Manager projection, evidence refs, ledger event, and audit row must commit in one repository transaction. If any part fails, the whole pending action fails.
- **D-09:** Traceability data must not store raw prompt text, raw terminal output, provider payloads, secrets, full approval diffs, or full execution summaries.

### Approval Card UX

- **D-10:** PM approval cards show a structured change summary: action type, target project/work item, fields to write, evidence reference count, and risk cues.
- **D-11:** PM approval cards use fixed field templates per action type. Model-generated prose must not be the primary approval summary.
- **D-12:** Approval cards show a safe chain preview: `Copilot run -> pending action -> target work item -> evidence refs / ledger event`.
- **D-13:** After approval succeeds, the user remains in Copilot and gets a `View in Project Manager` anchor from the action card.

### Completion Authority

- **D-14:** Copilot may propose `update_work_item_status -> done` only when the target work item already has trusted evidence refs. Because actions are atomic, a `done` status action must not attach new evidence itself.
- **D-15:** Only existing structured evidence refs on the target work item with trusted status semantics such as `accepted` or `verified` satisfy the Copilot `done` gate.
- **D-16:** If evidence is missing or not trusted, Copilot must first propose `attach_evidence` or another evidence-processing action, then propose `done` in a later independent action after trusted evidence exists.
- **D-17:** Work item detail must show the `done` status change together with the satisfying evidence refs, triggering Copilot run/action, and corresponding ledger event.

### Agent Discretion

No user choices were delegated to agent discretion. Planner may choose names and internal types where the decisions above do not constrain behavior, but must preserve the approval, audit, redaction, and atomicity boundaries.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product And Milestone Scope

- `.planning/ROADMAP.md` — Phase 12 goal, requirements, and success criteria.
- `.planning/REQUIREMENTS.md` — v1.3 requirements POS-01, POS-02, POS-03, TRACE-01, TRACE-02, TRACE-03, TRACE-04.
- `.planning/PROJECT.md` — project positioning and current milestone direction.
- `.planning/DECISIONS-INDEX.md` — rolling product decisions; AI-native PM is a traceability layer, not generic PM replacement.
- `.planning/STATE.md` — current milestone/session state.

### Project Manager And Copilot Contracts

- `docs/API.md` — Project Manager Ledger authority, tenant scoping, routes, evidence ref limits, status transitions, ledger event types, Copilot pending-action approval contract, and redaction rules.
- `docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md` — historical design source for approval-gated project-manager Copilot and evidence-backed completion.
- `docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md` — historical implementation plan; useful for intent, but route names may be stale and must be checked against current code.

### Current Code Entry Points

- `packages/gateway/src/routes/project-manager.ts` — existing Project Manager REST route surface.
- `packages/gateway/src/db/repositories/project-manager-repository.ts` — existing tenant-scoped Project Manager transactions, evidence normalization, ledger events, and audit writes.
- `packages/gateway/src/routes/copilot.ts` — existing Copilot pending-action approve/reject lifecycle.
- `packages/gateway/src/services/copilot/read-tools.ts` — existing project-manager read-only Copilot tools.
- `packages/web/src/components/projects/ProjectManagerPanel.tsx` — current Project Manager work item detail, evidence ref, status action, and ledger UI.
- `packages/web/src/lib/api.ts` — current Project Manager DTOs and API helpers.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `ProjectManagerRepository.createWorkItem`, `updateWorkItemStatus`, and `attachEvidence` already write projection, ledger event, and audit row inside repository transactions. Phase 12 should extend this transaction model rather than adding a separate write path.
- `ProjectManagerEvidenceRef` already supports `kind`, `label`, `status`, `ref`, `path`, `sessionId`, `copilotRunId`, Feishu ids, and `createdAt`. Phase 12 needs `pendingActionId` for Copilot traceability, so planner must decide whether to extend the evidence ref schema or store the action id in a bounded details marker.
- `ProjectManagerPanel` already shows work item detail, evidence refs, status actions, and ledger events. Phase 12 should extend those surfaces to show Copilot trace markers and the `View in Project Manager` target.
- Copilot already has read-only project-manager tools. Phase 12 should add prepare tools for PM writes; direct model-origin mutations remain out of scope.

### Established Patterns

- Gateway owns Project Manager state. Routes verify visible `projectId`; repositories are constructed with authenticated `user_id` and filter internally.
- Prepare tools create stored pending actions. Approve routes use the canonical stored payload and do not accept client-side replacement payloads at approval time.
- Project Manager mutation details, ledger event details, and audit details are count/marker based and redacted. Raw prompt, terminal, provider, and secret-bearing content are forbidden.
- Work item `done` currently allows evidence refs or a manual completion reason. Phase 12 tightens the Copilot-origin path: Copilot-proposed `done` requires existing trusted evidence refs and must not rely on manual reason.

### Integration Points

- Add Copilot prepare tools for `create_work_item`, `update_work_item_status`, and `attach_evidence` PM proposals.
- Add PM pending-action approval handlers that call existing Project Manager repository methods with tenant/project validation and Phase 12 redaction rules.
- Add PM-specific pending-action card rendering in the Web Copilot panel with fixed templates and safe chain preview.
- Add Project Manager detail/ledger UI markers that connect work item evidence, Copilot run/action ids, approval result, and ledger event.
- Important conflict to resolve: existing Copilot approval failure paths can reset actions from `processing` to `pending`; Phase 12 requires PM action execution failure to become terminal `failed`.

</code_context>

<specifics>
## Specific Ideas

- The user selected the conservative traceability path throughout: atomic actions, existing entity IDs only, all-or-nothing transaction, fixed approval templates, no model-generated approval prose, and evidence-backed completion.
- Approval UX should keep users in the Copilot flow after approval while providing a direct `View in Project Manager` anchor.
- `done` explanation belongs in the work item detail view, not only in ledger history.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 12-Copilot Project-Manager Traceability*
*Context gathered: 2026-05-22T17:19:01+08:00*
