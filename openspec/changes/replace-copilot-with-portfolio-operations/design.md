## Context

Portfolio Operations was implemented while removing DeepSeek Harness, but it changed the product direction and duplicated responsibilities already covered by Copilot and Project Manager. The confirmed target is simpler: native Copilot remains the assistant, Project Manager remains the work board, and Portfolio Operations has no live product or runtime role.

## Goals / Non-Goals

**Goals:**

- Remove every user-visible and runtime Portfolio entry point.
- Keep Copilot functional through ForgeBadger-owned services with no DeepSeek Harness dependency.
- Preserve existing Project Manager and terminal behavior after removing Portfolio-specific fences, hooks, workers, and scheduling.
- Avoid destructive database operations.

**Non-Goals:**

- Migrating Portfolio records into Copilot or Project Manager.
- Dropping historical Portfolio tables or rewriting applied migrations.
- Restoring DeepSeek Harness or a previous-brand compatibility runtime.
- Redesigning Copilot, Project Manager, Feishu, or terminal behavior beyond removing Portfolio dependencies.

## Decisions

### 1. Copilot is the sole assistant product

`/copilot` renders the native conversational workspace. There is no `/portfolio` alias, workspace, companion, or secondary assistant. Copilot tools may use existing Projects, Sessions, Project Manager, Memory, Graph, and Usage boundaries, but no Portfolio facade or domain state.

### 2. Portfolio runtime is removed, not disabled

Routes, service construction, workers, schedulers, event projections, session writer fences, Claude worker hooks, Feishu Portfolio routing, and Web clients are deleted. A feature flag or dormant dependency container would leave maintenance cost and accidental activation risk, so no live compatibility path remains.

### 3. Historical persistence is retained inertly

Applied migration files and Portfolio table declarations remain because editing migration history or dropping user data is unsafe. Runtime repositories and services are removed. Residual Portfolio identifiers are acceptable only in migrations, schema declarations, and clearly historical documentation/evidence.

### 4. Existing products keep their original authority

Project Manager continues to own its board and task-packet workflow. Session and terminal services return to their general-purpose behavior without Portfolio lease/capability concepts. Feishu retains only non-Portfolio integration behavior that is still supported by the product.

## Risks / Trade-offs

- Existing Portfolio rows become inert. This is intentional and reversible at the data level because no tables are dropped.
- Removing mixed session and Feishu wiring can regress unrelated paths. Targeted tests plus full Gateway/Web verification are required.
- Historical names will remain visible in migration/schema scans. Acceptance distinguishes inert continuity artifacts from live imports, routes, or runtime reads.

## Migration Plan

1. Rewrite the active change contract to the confirmed retirement boundary.
2. Remove Web Portfolio surfaces and references.
3. Remove Gateway Portfolio modules and all mixed-file wiring.
4. Update current architecture, API, test, and operational documentation.
5. Run live-source reference scans, typechecks, tests, builds, brand validators, and a browser-level Copilot check.

**Rollback:** restore code only if a regression requires it; do not recreate Portfolio data or reintroduce DeepSeek Harness. Historical tables remain untouched throughout.
