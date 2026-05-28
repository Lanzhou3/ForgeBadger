---
phase: 12
slug: copilot-project-manager-traceability
status: approved
shadcn_initialized: true
preset: new-york
created: 2026-05-22
approved: 2026-05-22
---

# Phase 12 - UI Design Contract

> Visual and interaction contract for Copilot Project-Manager Traceability. This phase adds traceable Copilot approval and Project Manager evidence surfaces without changing OpenForge into a generic project-management suite.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn/ui with Tailwind CSS v4 CSS variables |
| Preset | `new-york` |
| Component library | Radix UI via existing shadcn components |
| Icon library | `lucide-react` |
| Font | Existing system sans stack from the app shell |

### Existing Components To Reuse

- `Button`, `Badge`, `Card`, `Sheet`, `Tabs`, `Table`, `Input`, `Label`, `Textarea`, `Separator`.
- Existing Copilot `PendingActionCard` shape: compact bordered block inside the chat activity surface.
- Existing Project Manager detail `Sheet` and ledger row cards.
- Existing React Query invalidation and localized `t(...)` copy patterns.

### No New Visual System

Do not add a new component library, standalone CSS framework, marketing-style layout, decorative gradients, or independent card style. Phase 12 must extend the existing dark, dense developer-tool UI.

---

## Phase UI Surfaces

| Surface | Location | Contract |
|---------|----------|----------|
| PM pending-action card | `packages/web/src/components/copilot/copilot-chat-panel.tsx` | Shows fixed structured summary, risk cue, safe trace chain preview, Approve/Reject buttons. |
| PM approval result | Copilot run timeline / persisted message activity | Shows approved/failed status, bounded result markers, and a `View in Project Manager` link when a project/work item target exists. |
| Project Manager anchor | `/projects/:id?tab=project-manager&workItemId=:workItemId` or equivalent URL state | Opens the Project Manager tab and selects or highlights the target work item detail. |
| Work item detail trace | `ProjectManagerWorkItemDetailSheet` | Shows evidence refs plus Copilot run/action markers and the ledger event associated with completion where available. |
| Ledger trace marker | `ProjectManagerLedgerRow` | Shows bounded Copilot trace fields as compact key-value markers, not raw ledger details. |

---

## Spacing Scale

Declared values must stay on the existing Tailwind/shadcn spacing rhythm and be multiples of 4.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, badge gaps, trace-chain separator gaps |
| sm | 8px | Inline controls, compact key-value rows, action button gaps |
| md | 16px | Card/Sheet internal spacing, form groups |
| lg | 24px | Panel section spacing |
| xl | 32px | Large project-manager grid gaps only |
| 2xl | 48px | Not used in the new Phase 12 surfaces |
| 3xl | 64px | Not used in the new Phase 12 surfaces |

Exceptions: none.

### Layout Rules

- Copilot PM pending-action cards use `rounded-md`, `border`, `bg-background/70`, `p-3`, `space-y-3`, matching the existing card.
- Trace marker groups use compact rows or two-column grids. They must not nest full cards inside other cards.
- Project Manager ledger trace markers use the existing row card and `LedgerDatum` style; add marker cells instead of introducing a new container style.
- All ID-like values use `font-mono text-xs tabular-nums break-all`.
- Buttons inside pending-action cards remain right-aligned on desktop and wrap cleanly on narrow widths.

---

## Typography

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 14px | 400 | 1.5 |
| Label | 12px | 500 | 1.4 |
| Heading | 16px | 600 | 1.4 |
| Display | Not used | Not used | Not used |
| Mono marker | 12px | 400 | 1.4 |

### Typography Rules

- No hero-scale type, display headings, negative letter spacing, or viewport-scaled font sizes.
- Pending-action card title uses `text-sm font-medium`.
- Field labels, trace-chain labels, risk cues, and ledger marker labels use `text-xs text-muted-foreground`.
- Values use `text-xs` or `text-sm`; long IDs must wrap with `break-all` rather than overflow.

---

## Color

Use existing app tokens from `packages/web/src/app/globals.css`.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `hsl(var(--background))` | Page background and panel base |
| Secondary (30%) | `hsl(var(--card))`, `hsl(var(--muted))`, `hsl(var(--surface-raised))` | Cards, Copilot activity surfaces, PM ledger rows |
| Accent (10%) | `hsl(var(--brand))` and status badges | Primary safe action emphasis, trace anchors, selected state only |
| Destructive | `hsl(var(--destructive))` | Reject/failure/error states only |

Accent reserved for:

- `View in Project Manager` link or button.
- Active Project Manager tab state through existing Tabs component.
- Success/approved trace indicators through existing `Badge` variants.

Do not use gradients, decorative orbs, bokeh, one-off brand palettes, or color-only communication. Every status cue must include text.

---

## Copywriting Contract

All copy must be localized through `packages/web/src/lib/i18n.ts`.

| Element | Copy |
|---------|------|
| Pending card section label | `Pending actions` / existing `copilot.pendingActions` |
| PM create action label | `Create work item` |
| PM status action label | `Update work item status` |
| PM evidence action label | `Attach evidence` |
| Primary CTA | `Approve` / existing `copilot.approve` |
| Secondary CTA | `Reject` / existing `copilot.reject` |
| Result CTA | `View in Project Manager` |
| Safe trace heading | `Trace` |
| Risk cue heading | `Review before approval` |
| Terminal failure error | `Project Manager action failed. Create a new proposal before retrying.` |
| Missing trusted evidence error | `Trusted evidence is required before Copilot can mark this done.` |
| Empty trace marker | `No Copilot trace markers` |

### Copy Rules

- Approval copy must be short, factual, and action-specific.
- Do not show raw prompt text, raw terminal output, provider payload, full approval diff, secret-looking strings, or model-generated prose as the primary summary.
- Risk cues describe the authority boundary, not instructions. Use one short sentence when needed: `Approval writes Project Manager state through Gateway.`
- Do not add visible educational text about keyboard shortcuts, styling, or how the application works.

---

## PM Approval Card Contract

### Common Card Fields

Every PM pending-action card must show these fields when available:

- `Action`: fixed label for create work item, update status, or attach evidence.
- `Project`: project name if available, otherwise project id.
- `Work item`: target title if available, otherwise work item id. Omit for create action before approval.
- `Fields`: bounded list of fields to write.
- `Evidence refs`: count and safe marker labels only.
- `Trace`: `Copilot run -> pending action -> target work item -> evidence refs / ledger event`.
- `Risk`: short fixed risk cue when action can mutate status or mark done.

### Create Work Item Card

Show:

- Title.
- Initial status.
- Priority if present.
- Acceptance criteria count.
- Evidence ref count.
- Source `copilotRunId` and `pendingActionId` if present.

Do not show:

- Full raw prompt.
- Raw terminal output.
- Provider messages.

### Update Status Card

Show:

- Target work item.
- Current status if available.
- Target status.
- Trusted evidence gate state when target status is `done`.
- Source `copilotRunId` and `pendingActionId`.

For `done`, card must show `Trusted evidence: verified` or `Trusted evidence: accepted` when satisfied. If not satisfied, show the missing trusted evidence error and no Approve button.

### Attach Evidence Card

Show:

- Target work item.
- Evidence kind.
- Label.
- Status.
- Ref/path/session id if present.
- Source `copilotRunId` and `pendingActionId`.

Render ref/path/session id in mono text and truncate only visually; full values must remain accessible in the DOM text for copying and tests.

---

## Project Manager Trace Contract

### Work Item Detail

The detail sheet must include a compact `Copilot trace` section when any evidence ref or ledger marker has `copilotRunId` or `pendingActionId`.

Required fields:

- `Run`: `copilotRunId`.
- `Action`: `pendingActionId`.
- `Evidence`: kind, label, status.
- `Session`: `sessionId` when present.
- `Ledger`: linked ledger event id or event type when available.

For completed work items, show completion and evidence chain in the same detail view:

- Status badge: `done`.
- Trusted evidence refs that satisfied the gate.
- Triggering Copilot run/action.
- Corresponding ledger event marker.

### Ledger Row

Ledger rows with Copilot trace markers must show a compact marker grid:

- `Run`
- `Action`
- `Action type`
- `Target`
- `Evidence refs`
- `Approval`
- `Execution`

The route may expose a bounded `trace` DTO. The UI must not render arbitrary raw `details` JSON.

---

## Navigation And Anchor Contract

`View in Project Manager` must land on a Project Manager surface, not the default sessions tab.

Preferred URL shape:

```text
/projects/:projectId?tab=project-manager&workItemId=:workItemId
```

Required behavior:

- `tab=project-manager` opens the Project Manager tab on page load.
- `workItemId` selects or highlights the target work item and opens its detail sheet when the work item is loaded.
- If the work item is missing or cannot be loaded, the Project Manager tab remains open and shows a scoped error or empty marker, not a global navigation failure.
- The browser URL stays stable enough for copy/paste.

---

## State Contract

| State | Copilot Card | Project Manager Surface |
|-------|--------------|-------------------------|
| Pending | Structured summary, risk cue, Approve/Reject enabled when valid | No mutation yet |
| Processing | Buttons disabled, existing compact loading state | No optimistic PM state unless backend response confirms |
| Approved | Approved badge, bounded result summary, `View in Project Manager` anchor | Detail/ledger show trace markers after refetch |
| Rejected | Rejected badge or timeline event; no PM anchor | No PM mutation |
| Failed | Failure badge, terminal PM failure copy, no retry button for same action | No partial PM mutation or missing trace |
| Missing trusted evidence | Approve disabled, trusted-evidence error | Work item can still show existing evidence refs |

---

## Responsive Contract

- Desktop: cards and trace markers remain dense; no marketing-style whitespace.
- Tablet/narrow desktop: action buttons wrap to a second line while preserving `Approve` and `Reject` labels.
- Mobile: Project Manager tab and work item detail sheet remain readable; long marker values wrap with `break-all`.
- No text may overlap adjacent content. Trace labels and values must wrap rather than shrink below 12px.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | Existing `Button`, `Badge`, `Card`, `Sheet`, `Tabs`, `Table`, `Input`, `Label`, `Textarea`, `Separator` | No new registry install required |
| third-party | none | Not allowed for Phase 12 |

---

## Verification Expectations

- `packages/web/src/lib/copilot.test.ts` covers PM action labels, fixed summaries, result summaries, failure copy, and no raw JSON fallback for PM actions.
- `packages/web/src/lib/api.test.ts` covers evidence `pendingActionId` and ledger `trace` DTO types/routes.
- Focused Playwright coverage proves `View in Project Manager` opens the Project Manager tab and target work item trace marker.
- Visual/manual review checks Copilot PM card and PM detail/ledger marker density at desktop and mobile widths.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-05-22
