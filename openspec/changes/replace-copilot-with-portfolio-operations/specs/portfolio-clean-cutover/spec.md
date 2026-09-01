## ADDED Requirements

### Requirement: Copilot is the sole assistant surface
ForgeBadger MUST expose `/copilot` as its assistant workspace and MUST NOT expose `/portfolio`, a Portfolio companion, or a Portfolio bookmark alias.

#### Scenario: User opens Copilot
- **WHEN** an authenticated user opens `/copilot`
- **THEN** the native Copilot conversation workspace is rendered
- **THEN** no Portfolio component or request workflow is loaded

#### Scenario: User requests Portfolio
- **WHEN** a client requests `/portfolio` or `/api/v1/portfolio/**`
- **THEN** no product page or API route is registered
- **THEN** no Portfolio service is constructed or invoked

### Requirement: Portfolio has no live runtime dependency
Live Gateway and Web source MUST NOT import or construct Portfolio repositories, services, workers, schedulers, events, session fences, Claude hooks, Feishu routing, clients, hooks, or presentation components.

#### Scenario: Gateway starts
- **WHEN** startup composes the Gateway
- **THEN** it creates no Portfolio runtime, reconciliation timer, worker capability, or Portfolio API facade
- **THEN** terminal and session behavior does not depend on Portfolio state

#### Scenario: Copilot runs a tool
- **WHEN** native Copilot builds its tool registry
- **THEN** no Portfolio tool or facade is present
- **THEN** existing non-Portfolio platform tools remain available according to policy

### Requirement: Historical database artifacts remain inert
Applied Portfolio migrations and historical schema declarations MUST remain unchanged unless a separately authorized data-removal procedure is approved. Live repositories, routes, services, and schedulers MUST NOT read or write Portfolio tables.

#### Scenario: Runtime reference scan runs
- **WHEN** live source is scanned for Portfolio dependencies
- **THEN** only approved migration/schema continuity references may remain
- **THEN** any live import, SQL query, route, event, or UI reference fails acceptance

### Requirement: DeepSeek Harness remains removed
Copilot MUST use the ForgeBadger-owned Gateway runtime and MUST NOT import, spawn, configure, call, or fall back to DeepSeek Harness or `packages/dsh-bridge`.

#### Scenario: Copilot sends a message
- **WHEN** an authenticated user sends a Copilot message
- **THEN** the Gateway-owned provider/orchestrator path handles it
- **THEN** no DSH process, bridge, callback, or configuration endpoint is involved

### Requirement: Retirement is verified against real composition
Acceptance MUST include live-source scans, relevant Gateway and Web tests, workspace typecheck/build, brand and operational validators, and a browser-level `/copilot` check.

#### Scenario: Acceptance passes
- **WHEN** all required checks pass
- **THEN** Copilot is the only assistant workspace and Portfolio has no live runtime path
- **THEN** retained Portfolio database identifiers are documented as inert historical continuity artifacts
