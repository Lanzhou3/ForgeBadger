# Phase 12: Copilot Project-Manager Traceability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-22T17:19:01+08:00
**Phase:** 12-Copilot Project-Manager Traceability
**Areas discussed:** PM write proposal granularity, Traceability anchor, Approval card UX, Completion authority

---

## PM Write Proposal Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Atomic action | Each pending action performs one Project Manager mutation. | yes |
| Grouped change package | One approval can create work items, change status, and attach evidence. | |
| Hybrid UI grouping | Underlying actions remain atomic but UI groups them by Copilot run. | |

**User's choice:** Atomic action.
**Notes:** Phase 12 supports only `create_work_item`, `update_work_item_status`, and `attach_evidence`. Cross-action dependencies are not allowed. Failed PM actions are terminal and require a new proposal.

---

## Traceability Anchor

| Option | Description | Selected |
|--------|-------------|----------|
| Evidence refs plus ledger events | Evidence refs support work item display; ledger events support audit timeline. | yes |
| Evidence refs only | Work item detail is direct, but global traceability is weaker. | |
| Ledger events only | Audit is clean, but work item evidence display is indirect. | |

**User's choice:** Evidence refs plus ledger events.
**Notes:** Evidence refs store structured Copilot run/action/session markers. Ledger events store safe trace markers. Projection, evidence refs, ledger events, and audit rows must commit in one transaction.

---

## Approval Card UX

| Option | Description | Selected |
|--------|-------------|----------|
| Structured change summary | Show action type, target, fields, evidence counts, and risk cues. | yes |
| Full diff preview | Strong review affordance, but PM mutations do not always map cleanly to diff. | |
| Minimal confirmation card | Fastest UI, but too opaque for approval. | |

**User's choice:** Structured change summary.
**Notes:** Cards use fixed templates per PM action type. They show a safe chain preview and keep the user in Copilot after approval with a `View in Project Manager` anchor.

---

## Completion Authority

| Option | Description | Selected |
|--------|-------------|----------|
| Allow done with evidence refs | Copilot can propose `done` only when trusted evidence refs already exist. | yes |
| Disallow Copilot done proposals | Humans must always mark `done`. | |
| Allow manual completion reason instead | Human reason can replace evidence. | |

**User's choice:** Allow done with evidence refs.
**Notes:** Copilot-proposed `done` requires existing trusted structured evidence refs on the target work item. If evidence is missing or not trusted, Copilot must first propose evidence-related actions. Work item detail should show completion and evidence chain together.

---

## Agent Discretion

None. The user selected explicit options for all discussed gray areas.

## Deferred Ideas

None.
