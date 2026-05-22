---
phase: 11
slug: evidence-ledger-and-acceptance-gates
status: approved
shadcn_initialized: true
preset: openforge-dark-control-plane
created: 2026-05-22
---

# Phase 11 - UI Design Contract

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn-style local components |
| Preset | OpenForge dark control-plane |
| Component library | Radix-based local UI primitives |
| Icon library | lucide-react |
| Font | Existing app sans stack; monospace only for IDs, counts, paths, and timestamps |

Use existing primitives from `packages/web/src/components/ui`. Do not fetch new
registry components or introduce a new palette.

## Surface Placement

Phase 11 remains inside the existing project detail `Project Manager` tab.

Evidence attachment:

- Entry point is inside the work item detail Sheet.
- Do not add attach buttons directly to work item table rows.
- The form is compact and subordinate to the selected work item.
- The form exposes only `kind`, `label`, `ref`, and `path`.

Ledger review:

- Replace the current small ledger summary with an in-tab ledger timeline area.
- Do not add a separate tab, route, dashboard, kanban board, or analytics page.
- The timeline should sit below the goal/work item controls and stay scannable.

## Layout

Desktop:

- Preserve the current two-column Project Manager panel for goal and work item
  operations.
- Ledger timeline spans the available tab width below the operations cards.
- Work item detail stays in a right-side Sheet with stable width.
- Evidence form uses a two-column grid for fields where width allows, one
  column on small screens.

Mobile/narrow:

- Stack fields and ledger rows.
- Keep action buttons full-width only when the existing component pattern does
  this naturally.
- Text must wrap; paths and IDs may use `break-all` or `break-words`.

## Spacing And Sizing

Use existing Tailwind spacing in multiples of 4.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | icon gaps, badge gaps |
| sm | 8px | field inner gaps, row metadata gaps |
| md | 16px | card content, form sections |
| lg | 24px | major panel gaps |
| xl | 32px | optional desktop ledger spacing |

Cards remain at the existing app radius. Do not nest cards inside cards.

## Typography

Do not scale font sizes with viewport width. Letter spacing remains 0 except
for existing uppercase metadata labels.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 14px | 400 | 1.5 |
| Label | 12px | 500 | 1.3 |
| Heading | 16px | 600 | 1.35 |
| Metadata | 12px | 400 or 500 | 1.3 |
| Monospace count/id | 12px | 400 | 1.3 |

## Color And Icons

- Use existing semantic tokens: `bg-background`, `bg-card`, `bg-muted/20`,
  `border-border/70`, `text-muted-foreground`, `text-destructive`.
- Use primary/accent only for positive submit or active filter state.
- Use destructive styling for blocked unsafe values and mutation failures.
- Use lucide icons already imported or available for actions, such as
  `Plus`, `History`, `RefreshCw`, and a suitable evidence/link icon if added.

## Interaction Contract

Evidence attach:

- Opening a work item detail Sheet reveals the evidence attachment action/form.
- Submit is disabled while pending.
- Validation blocks missing useful reference data and obvious unsafe values
  before sending.
- Failure keeps the Sheet open and preserves safe field values.
- Success clears the evidence draft and refreshes visible work item and ledger
  state.

Ledger timeline:

- Default query shows 25 events.
- `Load more` increases the visible query window by 25.
- Filters are visible as compact controls with labels:
  `All`, `Status changes`, `Evidence`, `Manual completion`, `Blockers`.
- Empty filtered state explains that no matching events are loaded.
- Ledger load failure appears in the ledger area and does not hide goal/work
  item data.

## Copy Contract

Visible copy should be operational and short. Do not add in-app architectural
explanations.

Required concepts:

- Evidence references are links or pointers.
- Raw terminal transcripts, Feishu message bodies, provider payloads, and
  secrets should not be pasted.
- Manual completion means completion was recorded without an evidence
  reference.
- Blocker events are shown as safe event markers only.

## Accessibility

- Evidence fields have labels connected to inputs.
- Mutation errors use text plus destructive styling; do not rely on color only.
- Filter controls have accessible names.
- `Load more` is a button with disabled state while fetching.
- Sheet and dialog behavior must preserve existing keyboard behavior.

