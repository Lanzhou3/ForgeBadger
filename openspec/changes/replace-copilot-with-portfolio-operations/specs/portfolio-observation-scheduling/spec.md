## ADDED Requirements

### Requirement: Portfolio scheduling is inactive
The Gateway MUST NOT start Portfolio observations, wakeups, heartbeat timers, risk reconciliation, or Portfolio-specific Git probes.

#### Scenario: Gateway remains running
- **WHEN** normal startup and recovery complete
- **THEN** no Portfolio timer or reconciliation cycle is scheduled
- **THEN** no historical Portfolio row can trigger a side effect
