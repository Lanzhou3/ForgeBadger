## ADDED Requirements

### Requirement: Sessions have no Portfolio execution ownership
Session launch, terminal input, hooks, adapter discovery, and lifecycle recovery MUST NOT depend on Portfolio assignments, workers, capabilities, authorization records, or writer fences.

#### Scenario: User attaches to a session
- **WHEN** an authenticated user connects and sends valid terminal input
- **THEN** the normal session and WebSocket security rules apply
- **THEN** no Portfolio lease or worker capability is consulted
