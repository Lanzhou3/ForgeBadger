## 1. Contract and inventory

- [x] 1.1 Confirm Copilot as the sole assistant and Portfolio Operations as fully retired.
- [x] 1.2 Define historical migrations/schema declarations as the only allowed Portfolio persistence artifacts.
- [x] 1.3 Inventory Portfolio-only files and mixed-file imports across Gateway, Web, tests, docs, and OpenSpec.

## 2. Web retirement

- [x] 2.1 Remove `/portfolio`, its navigation entry, workspace, companion, components, hooks, clients, event handling, translations, and browser/unit tests.
- [x] 2.2 Verify `/copilot` remains the native Copilot workspace and no Portfolio presentation is mounted globally.

## 3. Gateway retirement

- [x] 3.1 Remove Portfolio routes, services, repositories, workers, scheduler, event projection, and Copilot tool integration.
- [x] 3.2 Remove Portfolio dependencies from startup, server composition, sessions, hooks, adapter discovery, terminal WebSocket, and Feishu integration.
- [x] 3.3 Preserve applied migrations and historical schema declarations without live readers or writers.

## 4. Documentation and acceptance

- [x] 4.1 Update current product, architecture, API, testing, operational, phase, and agent guidance to remove Portfolio as a live feature.
- [x] 4.2 Run live-source Portfolio and DeepSeek Harness scans and classify all retained historical references.
- [x] 4.3 Run relevant Gateway/Web tests, workspace typecheck/build, brand/operational validators, and a browser-level Copilot check.
- [x] 4.4 Review the final diff for unrelated changes, regressions, and accidental destructive migration edits.
