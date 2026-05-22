# Phase 10: Goal And Work Item Operations - Discussion Log

**Gathered:** 2026-05-22
**Mode:** Recommended defaults applied from prior user instruction

## Context

The user previously instructed future GSD decisions to proceed with the recommended option without waiting for repeated confirmation. For Phase 10, the discussion flow therefore auto-selected all material gray areas and recorded the recommended defaults in `10-CONTEXT.md`.

## Areas Considered

### Goal Editing

**Options considered:**
- Inline edit inside the existing Project Manager tab.
- Separate dialog or drawer for goal edits.
- Separate route or global goal editor.

**Selected:** Inline edit inside the existing Project Manager tab.

**Notes:** This preserves Phase 9 placement, keeps the project workflow continuous, and avoids introducing global project-manager navigation before the project-level workflow is proven.

### Goal List Fields

**Options considered:**
- Newline-separated textareas for constraints and acceptance criteria.
- Structured add/remove list editor.
- Free-form JSON-like editor.

**Selected:** Newline-separated textareas normalized into arrays.

**Notes:** This matches the existing Gateway payload shape while keeping Phase 10 small. A richer list editor can be revisited if the workflow proves too awkward.

### Work Item Browse And Detail

**Options considered:**
- Bounded status-filtered table plus in-context detail panel or sheet.
- Expandable rows only.
- Separate work item route.

**Selected:** Bounded status-filtered table plus in-context detail panel or sheet.

**Notes:** This satisfies list, filter, and inspect requirements without leaving the project detail page or turning Phase 10 into a broader project-management suite.

### Work Item Creation And Initial References

**Options considered:**
- Create work item with optional bounded initial references.
- Defer all references until Phase 11.
- Allow raw pasted evidence during creation.

**Selected:** Create work item with optional bounded initial references only.

**Notes:** PMUX-04 explicitly includes optional initial references, but Phase 11 owns post-creation evidence attachment. Raw evidence blobs remain out of scope.

### Status Movement And Done Guard

**Options considered:**
- Show only allowed next status actions.
- Show all statuses and rely on Gateway rejection.
- Allow arbitrary status text.

**Selected:** Show only allowed next status actions, while Gateway remains authoritative.

**Notes:** `done` and `cancelled` are treated as terminal based on the current `docs/API.md` contract and repository transition map. Evidence-free `done` requires a manual completion reason.

## Deferred Ideas

- Post-creation evidence attachment and evidence reference management — Phase 11.
- Ledger timeline filtering/deep event review — Phase 11.
- Global project-manager dashboard — future milestone.
- Kanban board or drag-and-drop workflow — future UX expansion.
- Copilot or Feishu project-manager write proposals — future pending-action workflow.

## Result

Created `10-CONTEXT.md` with locked implementation decisions for Phase 10 planning.
