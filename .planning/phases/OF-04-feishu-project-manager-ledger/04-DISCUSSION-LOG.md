# Phase 4: Feishu Project Manager Ledger - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-20T22:31:21+08:00
**Phase:** 4-Feishu Project Manager Ledger
**Areas discussed:** authority boundary, ledger model, API and diagnostics surface, Copilot and Feishu surfaces, audit and evidence semantics

---

## Authority Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Ledger as OpenForge state | Project-manager state is tenant-scoped OpenForge control-plane state; Feishu is only a channel/ref. | yes |
| Feishu-owned workflow | Feishu tasks/docs become the primary source of truth for work state. | |
| Remote execution authority | Feishu messages can approve actions or control terminal/session execution. | |

**User's choice:** The user authorized proceeding with the recommended default without waiting for another reply.
**Notes:** The selected option preserves Phase 2 safety findings and the product wedge: Feishu is collaboration ingress, not execution authority.

---

## Ledger Model

| Option | Description | Selected |
|--------|-------------|----------|
| Goal, work item, ledger tables | Add migration-backed project-manager tables with `user_id`, `project_id`, bounded statuses, and append-only events. | yes |
| Notes-only metadata | Store project-manager state in Copilot messages or free-form JSON only. | |
| External task-only state | Use Feishu task ids as the only durable project-manager state. | |

**User's choice:** The user authorized the recommended default.
**Notes:** The selected option makes PM-01 and PM-02 testable through repository tests and migration-backed schema.

---

## API And Diagnostics Surface

| Option | Description | Selected |
|--------|-------------|----------|
| Gateway project-scoped API | Add `/api/v1` project-manager endpoints under project scope with envelope responses and tenant filtering. | yes |
| Diagnostics only | Add only diagnostics counts and skip API-level state access. | |
| Next.js API route | Implement project-manager behavior in the Web app. | |

**User's choice:** The user authorized the recommended default.
**Notes:** Gateway-owned API behavior follows `CLAUDE.md` and keeps Web as a SPA client.

---

## Copilot And Feishu Surfaces

| Option | Description | Selected |
|--------|-------------|----------|
| Read-first Copilot tools | Add read tools that explain goal, work items, and ledger before expanding write proposals. | yes |
| Full project-manager mutation tools | Add all prepare tools and approvals in the first implementation slice. | |
| Feishu write expansion | Add more outbound Feishu operations while adding ledger state. | |

**User's choice:** The user authorized the recommended default.
**Notes:** Read-first surfaces give product value while keeping Phase 4 scoped to auditability and state explanation.

---

## Audit And Evidence Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Ledger event plus audit log | Every mutation appends a project-manager ledger event and writes a redacted `audit_logs` row. | yes |
| Ledger only | Use project-manager ledger as the only audit trail. | |
| Audit only | Store current state and audit logs without a project-specific development ledger. | |

**User's choice:** The user authorized the recommended default.
**Notes:** The selected option makes current state explainable in product terms while preserving a generic audit trail for compliance and support.

---

## the agent's Discretion

- Exact endpoint names, table names, repository method names, and enum spellings may be finalized during planning.
- The recommended default is to keep Phase 4 backend-first and avoid Web dashboard polish unless a minimal client contract is needed for tests.
- Scope should be narrowed rather than expanded if implementation risk threatens tenant isolation, redaction, or approval semantics.

## Deferred Ideas

- Batch authorization with budgets and stop conditions.
- Feishu natural-language approval semantics.
- Feishu terminal control or raw shell execution.
- Full project-manager dashboard UI polish.
- SSH/remote execution and hosted collaboration.
