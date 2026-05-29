---
phase: 10
slug: goal-and-work-item-operations
status: approved
shadcn_initialized: true
preset: openforge-dark-control-plane
created: 2026-05-22
---

# Phase 10 - UI Design Contract

> Visual and interaction contract for the Goal And Work Item Operations phase.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn-style local components |
| Preset | OpenForge dark control-plane |
| Component library | Radix-based local UI primitives |
| Icon library | lucide-react |
| Font | Existing app sans stack; monospace only for ids, paths, counts, and timestamps |

Do not fetch new registry components. Use local primitives from
`packages/web/src/components/ui` and small local patterns inside
`ProjectManagerPanel` where primitives are missing.

---

## Surface Placement

The Phase 10 UI remains inside the existing project detail `Project Manager`
tab. It must not create a global project-manager page, separate work item
route, kanban board, or decorative dashboard.

The first visible screen should show:

- Goal card with read state and compact inline edit affordance.
- Work item operations area with status filter, create action, and bounded
  table/list.
- In-context work item detail through a right-side sheet or same-tab detail
  panel.
- Existing ledger summary may remain visible, but Phase 11 owns deeper ledger
  timeline review.

The surface should feel like an operational project control panel: dense,
quiet, and built for repeated use.

---

## Spacing Scale

Declared values must follow the existing Tailwind spacing scale and remain
multiples of 4.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, badge gaps, compact inline status/action gaps |
| sm | 8px | Form field inner gaps, table cell group gaps, status action gaps |
| md | 16px | Card content spacing, dialog/sheet section gaps, tab panel gaps |
| lg | 24px | Major panel spacing and responsive column gaps |
| xl | 32px | Optional desktop split between work item table and detail panel |
| 2xl | 48px | Not used in this phase |
| 3xl | 64px | Not used in this phase |

Exceptions: none.

---

## Typography

Do not scale font sizes with viewport width. Letter spacing remains `0` except
for existing uppercase metadata labels already used elsewhere in the project
page.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 14px | 400 | 1.5 |
| Label | 12px | 500 | 1.3 |
| Heading | 16px | 600 | 1.35 |
| Compact metadata | 12px | 400 or 500 | 1.3 |
| Monospace count/id | 12px | 400 | 1.3 |
| Display | Not used | Not used | Not used |

Form helper text and validation errors stay at 12-14px. Avoid hero-scale text
inside Project Manager cards, sheets, dialogs, and tables.

---

## Color

Use existing semantic Tailwind tokens. Do not introduce a new palette or
gradient treatment.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `bg-background`, `text-foreground` | Page and primary text |
| Secondary (30%) | `bg-card`, `bg-muted/20`, `border-border/70` | Cards, tables, forms, quiet panels |
| Accent (10%) | Existing primary button token | Save goal, create work item, confirm valid status movement |
| Destructive | `text-destructive`, destructive variants | Mutation errors, blocked status, invalid completion guard |

Accent reserved for: save/create/confirm actions, active tab/filter state where
existing components support it, and enabled status movement commands. Do not use
accent for every interactive element.

---

## Layout Contract

Desktop:

- Keep the `Project Manager` tab inside the current project detail layout.
- Prefer a two-zone layout: goal/edit controls plus work item operations. A
  third ledger summary section can sit below when present.
- Work item repetition should use a compact table or list, not repeated large
  cards.
- Detail inspection should use a right-side `Sheet` or same-tab detail panel
  with a stable width. It must not navigate away from the project page.
- Do not put cards inside cards. Use card shells for major panels only.

Mobile:

- Stack goal, work item controls, table/list, and detail content vertically.
- If the desktop table would overflow, preserve columns through wrapping,
  hidden secondary metadata, or stacked row content; do not cause horizontal
  text overlap.
- Dialogs/sheets must fit within viewport height and allow scrolling.

Stable dimensions:

- Status filter controls should not resize when labels change.
- Icon buttons must keep stable square sizing.
- Status action menus/buttons must not shift table rows after async state
  changes.

---

## Interaction Contract

### Goal Editing

- The goal card has a visible edit action when data is loaded.
- Empty goal state offers the same goal edit/create path.
- Edit fields: summary, constraints, acceptance criteria, status.
- Constraints and acceptance criteria use newline-separated textareas and
  normalize to trimmed non-empty arrays.
- Save/cancel controls stay near the form, not only at page bottom.
- Mutation errors render in the goal card and do not clear existing read data.
- On success, the read state updates from refreshed persisted data.

### Work Item List And Filter

- Work item operations include a status filter with `all`, `todo`,
  `in_progress`, `blocked`, `ready_for_review`, `done`, and `cancelled`.
- Filtering calls the Gateway list endpoint with `status` when a bounded status
  is selected and omits it for `all`.
- Use a bounded list limit. The UI should not imply infinite/unbounded project
  management.
- Empty states distinguish no work items from no work items for the selected
  filter.

### Work Item Creation

- Create action opens a compact dialog or sheet.
- Required field: title.
- Optional fields: description, priority, status, acceptance criteria, bounded
  initial evidence refs, bounded initial Feishu refs.
- Initial references may only collect approved reference fields from
  `docs/API.md`; they must not invite raw terminal output, Feishu message body,
  provider payload, secret, or transcript paste.
- If the minimal reference editor becomes too dense, prioritize title,
  description, priority, acceptance criteria, status, and a small bounded
  reference input pattern over a full evidence management UI.

### Work Item Detail

- Selecting a row opens in-context detail.
- Detail shows title, description, status, priority, acceptance criteria,
  evidence count, Feishu ref count, created/updated timestamps, and safe
  reference identifiers if present.
- Detail does not include post-creation evidence attachment controls in Phase
  10.

### Status Movement

- Status movement is shown as allowed next actions, not an all-status dropdown.
- Allowed actions must match:
  - `todo` -> `in_progress`, `blocked`, `cancelled`
  - `in_progress` -> `blocked`, `ready_for_review`, `done`, `cancelled`
  - `blocked` -> `todo`, `in_progress`, `cancelled`
  - `ready_for_review` -> `in_progress`, `done`, `cancelled`
  - `done` -> no actions
  - `cancelled` -> no actions
- If marking `done` with zero evidence references, show a manual completion
  reason prompt before submit.
- The manual completion reason prompt is only for evidence-free completion; it
  is not a general notes feature.
- Gateway mutation errors remain visible and actionable.

---

## Copywriting Contract

All visible strings must go through `packages/web/src/lib/i18n.ts` in all
existing dictionaries.

| Element | English Copy |
|---------|--------------|
| Goal edit action | Edit goal |
| Goal save action | Save goal |
| Goal cancel action | Cancel |
| Goal summary label | Summary |
| Goal constraints label | Constraints |
| Goal acceptance criteria label | Acceptance criteria |
| Goal status label | Goal status |
| Work item create action | Create work item |
| Work item inspect action | View details |
| Work item filter label | Filter by status |
| Work item all filter | All statuses |
| Work item title label | Title |
| Work item description label | Description |
| Work item priority label | Priority |
| Initial evidence refs label | Initial evidence references |
| Initial Feishu refs label | Initial Feishu references |
| Status actions trigger | Change status |
| Done reason title | Completion reason required |
| Done reason body | Add a manual completion reason because this work item has no evidence references. |
| Done reason label | Manual completion reason |
| Generic mutation error | Could not save project manager changes. |
| Goal mutation error | Could not save project goal. |
| Work item create error | Could not create work item. |
| Status mutation error | Could not update work item status. |
| Filter empty heading | No work items match this status |
| Filter empty body | Try a different status filter or create a new work item. |

Chinese and Traditional Chinese copy should be semantically equivalent, short,
and action-oriented. Avoid visible copy explaining GSD, architecture, or future
phase mechanics.

---

## Accessibility Contract

- Existing tab keyboard behavior must remain intact.
- Every icon-only button needs an `sr-only` label or visible text.
- Dialog and sheet titles must be accessible through the local Radix wrappers.
- Status badges include text labels; color is never the only status cue.
- Mutation errors render as text near the affected control.
- Form controls use labels connected to inputs or the existing form primitives.
- Manual completion reason prompt must focus the reason field when opened.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| Local shadcn-style components | `Button`, `Badge`, `Card`, `Dialog`, `Sheet`, `Input`, `Label`, `Table`, `Tabs`, `DropdownMenu` | No external registry fetch required |
| lucide-react | `BriefcaseBusiness`, `ClipboardList`, `History`, `RefreshCw`, plus action icons such as `Plus`, `Save`, `Eye`, `ArrowRight`, `CheckCircle`, `AlertTriangle` if needed | Existing dependency only |
| Third-party registry | none | Not allowed in Phase 10 |

If a textarea primitive is needed, implement a small local component following
the existing `Input` token pattern rather than fetching a registry block.

---

## Phase 10 Must-Haves

- Inline goal edit/create flow persists through Gateway and refreshes read data.
- Work item list supports bounded status filtering inside the Project Manager
  tab.
- Work item detail stays in project context.
- Work item creation supports title, description, priority, acceptance
  criteria, status, and bounded initial references without raw evidence intake.
- Status actions show only documented allowed transitions.
- Evidence-free `done` requires manual completion reason.
- All new visible strings are localized.
- Strict E2E mocks continue to fail unknown `/api/v1/*` routes.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-05-22
