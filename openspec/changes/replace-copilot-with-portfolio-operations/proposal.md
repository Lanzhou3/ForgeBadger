## Why

The earlier change incorrectly treated Portfolio Operations as a replacement or peer product for the completed Copilot experience. The user has confirmed that Portfolio Operations must be retired. ForgeBadger should keep Copilot as the only assistant workspace and continue to remove DeepSeek Harness without substituting another workflow product.

## What Changes

- Keep `/copilot` and `/api/v1/copilot/**` as the sole assistant surface and API.
- Remove `/portfolio`, `/api/v1/portfolio/**`, Portfolio Web components, clients, hooks, events, schedulers, execution workers, Feishu Portfolio routing, and Copilot-to-Portfolio tools.
- Remove Portfolio runtime wiring from startup, session launch, terminal input, WebSocket events, navigation, settings, documentation, and tests.
- Preserve already-applied Portfolio database migrations and historical schema declarations only for migration continuity and operator data safety. Live code must not read or write those tables.
- Keep the project-owned Copilot runtime and the completed DeepSeek Harness removal.

## Capabilities

### New Capabilities

- `portfolio-clean-cutover`: complete Portfolio Operations retirement while preserving Copilot and historical database continuity.

### Modified Capabilities

- None.

## Impact

- Gateway: Portfolio routes, services, repositories, workers, scheduler, events, Feishu handler, and mixed runtime wiring are removed.
- Web: Portfolio route, navigation, companion, components, query clients, event handling, and browser tests are removed.
- Persistence: applied migrations and schema declarations remain unchanged; no destructive data migration is introduced.
- Product: Copilot is the only assistant entry point; Project Manager remains the existing project-work workflow.
