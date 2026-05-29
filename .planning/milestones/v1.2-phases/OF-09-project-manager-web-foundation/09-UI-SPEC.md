---
phase: 09
slug: project-manager-web-foundation
status: approved
shadcn_initialized: true
preset: openforge-dark-control-plane
created: 2026-05-21
---

# Phase 09 - UI Design Contract

> Visual and interaction contract for the Project Manager Web Foundation phase.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn-style local components |
| Preset | OpenForge dark control-plane |
| Component library | Radix-based local UI primitives |
| Icon library | lucide-react |
| Font | Existing app sans stack; monospace only for paths, ids, and hashes |

---

## Surface Placement

The Project Manager surface belongs inside the existing project detail page as a new tab named `Project Manager`. It must not create a new global top-level page in Phase 9.

The first Phase 9 screen should show:

- A compact goal summary panel.
- A compact work item summary/list preview.
- Explicit empty and error states.
- Disabled or clearly non-authoritative affordances for actions that belong to Phase 10/11.

The surface should read as an operational project control panel, not a kanban app, marketing page, or decorative dashboard.

---

## Spacing Scale

Declared values must follow the existing Tailwind spacing scale and remain multiples of 4.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, badge gaps, inline status gaps |
| sm | 8px | Compact button/icon spacing, table cell inner gaps |
| md | 16px | Card content gaps and tab panel spacing |
| lg | 24px | Page section padding and major group gaps |
| xl | 32px | Optional two-column layout gap on desktop |
| 2xl | 48px | Not used in this phase |
| 3xl | 64px | Not used in this phase |

Exceptions: none.

---

## Typography

Do not scale font sizes with viewport width. Letter spacing remains `0` except for existing uppercase eyebrow labels already used by the project page.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 14px | 400 | 1.5 |
| Label | 12px | 500 | 1.3 |
| Heading | 16px | 600 | 1.35 |
| Page heading reuse | Existing project page heading | Existing weight | Existing line height |
| Display | Not used | Not used | Not used |

---

## Color

Use existing semantic Tailwind tokens. Do not introduce a new palette.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `bg-background`, `text-foreground` | Page and primary text |
| Secondary (30%) | `bg-card`, `bg-muted/20`, `border-border/70` | Cards, table shells, quiet panels |
| Accent (10%) | Existing primary button token | Primary retry/refresh or enabled command only |
| Destructive | `text-destructive`, destructive badge/button variants | Load/mutation errors and destructive states only |

Accent reserved for: primary refresh/retry command, active status where existing components already use it, and active tab styling inherited from `Tabs`.

---

## Copywriting Contract

All visible strings must go through `packages/web/src/lib/i18n.ts`.

| Element | Copy |
|---------|------|
| Tab label | Project Manager |
| Section heading | Project Manager |
| Primary CTA | Refresh project manager |
| Empty goal heading | No project goal yet |
| Empty goal body | Set a project goal in the next workflow phase. |
| Empty work items heading | No work items yet |
| Empty work items body | Create work items in the next workflow phase. |
| Error state | Could not load project manager state. Refresh or check Gateway availability. |
| Not found state | Project manager state was not found for this project. |
| Disabled action hint | This action is planned for the next phase. |
| Destructive confirmation | Not applicable in Phase 9 |

Avoid explanatory in-app copy about architecture, GSD, security policy, or future implementation details. The UI can name a disabled state, but deeper explanation belongs in docs or tooltips.

---

## Layout Contract

Desktop:

- Reuse the existing project detail tab layout.
- Use a two-column layout only if content density justifies it: goal/status summary on the left, work item/ledger preview on the right.
- Keep all cards at the existing project page radius and border style. Do not nest cards inside cards.
- Tables or compact lists are preferred over decorative cards for repeated work items.

Mobile:

- Stack panels vertically.
- Preserve all information, but avoid dense multi-column tables that overflow.
- Text must wrap cleanly; paths and ids should use truncation or `break-all` where needed.

---

## Interaction Contract

- Data loading is scoped to the project-manager tab unless planning finds a concrete need for a lightweight prefetch.
- Loading state must be visible inside the tab panel.
- API errors must render visible error text and a recovery command.
- Empty goal and empty work item states must be distinct.
- Phase 9 controls must not imply that full editing, status transitions, evidence attachment, or ledger filtering are complete if those remain Phase 10/11 work.
- If placeholder actions are shown, they must be disabled and labeled through accessible text or tooltip.

---

## Accessibility Contract

- The tab trigger must be keyboard reachable through the existing `Tabs` component.
- Buttons must use visible labels or `sr-only` labels when icon-only.
- Status badges must not be the only source of meaning; include text labels.
- Error states must be text-visible and not only color-coded.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| Local shadcn-style components | `Tabs`, `Card`, `Table`, `Badge`, `Button`, `Label` | No external registry fetch required |
| lucide-react | `BriefcaseBusiness` or closest existing project/work icon, `RefreshCw`, `AlertTriangle` | Existing dependency only |
| Third-party registry | none | Not allowed in Phase 9 |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-05-21
