## ADDED Requirements

### Requirement: Task Attempts and Task Packets are deterministic execution facts
The system MUST create a tenant-scoped Task Attempt for every governed execution of a Work Item. A Task Attempt MUST retain an immutable attempt number, source Work Item version, selected adapter, Task Packet version, packet digest, creation actor, and lifecycle facts. The Task Packet MUST be deterministically rebuilt from the Project Dossier, Work Item, acceptance criteria, declared verification requirements, and selected Skill version; it MUST NOT be an arbitrary model or channel string.

#### Scenario: Preparing an attempt
- **WHEN** an owner or accepted workflow command prepares execution for a Work Item
- **THEN** the system creates or idempotently reuses a `prepared` Task Attempt with a packet digest
- **THEN** it does not launch a CLI process or submit packet content during preparation

#### Scenario: Work Item changes before dispatch
- **WHEN** a Work Item or its acceptance criteria change after a Task Packet was prepared
- **THEN** the system detects that the rebuilt digest differs from the prepared digest
- **THEN** it invalidates the pending command or authorization and requires a new preparation

### Requirement: Session assignment leases own execution control
The system MUST create at most one active session-assignment lease for a Task Attempt and at most one active Portfolio assignment for a session. Dispatch, follow-up, interrupt, permission response, and observation collection MUST validate tenant, project, attempt, session, lease token, lease generation, expiry, and current session state. A concurrent or stale claimant MUST not send input to the Code CLI. While a session has an active Portfolio assignment, the Gateway MUST reject browser-originated raw terminal input and direct or non-worker `sendInput` calls. Only a valid worker capability bound to that assignment may write input.

#### Scenario: Duplicate dispatch wakeup
- **WHEN** two runners reconcile the same dispatch request concurrently
- **THEN** only one obtains the assignment lease and creates the idempotent dispatch command
- **THEN** the other records no external side effect and returns a retryable ownership result

#### Scenario: Expired lease follow-up
- **WHEN** an old Task Attempt attempts a follow-up after its session assignment lease expires or is replaced
- **THEN** the Gateway rejects the operation as a lease mismatch
- **THEN** it does not write terminal input or disturb the active assignment

#### Scenario: Active assignment rejects an unfenced writer
- **WHEN** a browser terminal message or a direct/non-worker `sendInput` call targets a session with an active Portfolio assignment
- **THEN** the Gateway rejects it before terminal input is written
- **THEN** only a worker capability that validates the current tenant, project, attempt, session, lease generation, packet digest, and authorization binding may pass the writer fence

### Requirement: Dispatch is separate from preparation and requires observed readiness
The system MUST treat preparation and dispatch as distinct commands. The Phase 4 adapter integration MUST be conditional Claude `SessionStart` worker support with a fixed, authenticated readiness-forwarder. For every command and assignment lease generation, the Gateway MUST create a distinct worker ACK capability using an HMAC and bind it to the dispatch command, Task Attempt, session, assignment lease generation, and Task Packet digest; it MUST persist only the capability digest. The raw capability MUST never be returned through a connect API, browser terminal attach protocol or WebSocket, or generic hook settings, and a valid terminal attach token alone MUST fail readiness acknowledgement. The forwarder MUST consume that capability to persist at most one durable readiness ACK. `prepareDispatch` MUST use one database transaction for source/packet/lease compare-and-swap, canonical server-created ActionIntent, authorization decision and consumption, idempotent command intent, expected worker signal, Task Attempt transition to `dispatching`, and immutable facts. The worker, CLI, or tmux call MUST occur strictly after that transaction commits. Dispatch MUST validate adapter discovery, session eligibility, assignment lease, Task Packet digest, authorization, and that exact readiness ACK before a valid worker capability submits exactly one canonical Task Packet. A database session record, tmux session existence, or browser WebSocket connection alone MUST NOT prove CLI readiness. The readiness ACK MUST remain distinct from the observed dispatch receipt, which is recorded only after the canonical-packet submission path runs. A crash or timeout after commit but before that receipt is an unknown outcome for reconciliation and MUST NOT trigger a blind packet resend.

#### Scenario: CLI is still starting
- **WHEN** a dispatch command finds that a session has not reached adapter-defined input readiness
- **THEN** the command remains `dispatching` or schedules a bounded observation Wakeup
- **THEN** it does not send an early Task Packet prompt

#### Scenario: Terminal attachment cannot forge readiness
- **WHEN** a caller presents a valid terminal attach token, or any ACK capability not matching the command, attempt, session, lease generation, and packet digest
- **THEN** the Gateway rejects the readiness ACK before durable consumption
- **THEN** it does not expose the distinct worker ACK capability through a connect API, browser terminal attach protocol or WebSocket, or generic hook settings

#### Scenario: Prepare-dispatch commits before any worker input
- **WHEN** `prepareDispatch` accepts a dispatch request
- **THEN** one database transaction applies source/packet/lease CAS, canonical ActionIntent, authorization decision/consumption, command intent, expected worker signal, `dispatching` state, and immutable facts
- **THEN** the worker, CLI, or tmux call occurs only after the transaction commits

#### Scenario: Receipt persistence is interrupted after a worker write
- **WHEN** a worker writes the canonical packet but the process crashes or times out before the distinct dispatch receipt is persisted
- **THEN** reconciliation treats the result as unknown and never blindly submits the packet a second time
- **THEN** an existing readiness ACK or command intent alone does not prove a dispatch receipt

#### Scenario: Phase 4 default runtime is not verified for input
- **WHEN** Phase 4 runs without Task 8.2 real Claude/tmux evidence and verified-runtime enablement
- **THEN** the runtime remains `unverified_no_input` and the worker does not write real CLI or tmux input
- **THEN** Phase 4 tests MUST use mocked/database integration and MUST perform zero real CLI/tmux input while validating the readiness-forwarder and dispatch control path

#### Scenario: Successful first dispatch
- **WHEN** all dispatch checks pass, including one durable readiness ACK authenticated by the exact per-command, per-lease-generation worker capability and bound to the command, attempt, session, lease generation, and packet digest
- **THEN** the valid worker capability submits the one canonical packet and the system records a distinct durable dispatch receipt
- **THEN** the system records one idempotent command result and an observed Task Attempt state of `running`
- **THEN** the State Gate may transition the linked Work Item from `todo` to `in_progress`

### Requirement: Execution authorization has three non-bypassable tiers
The Gateway MUST evaluate every side effect against a canonical ActionIntent and classify it as preauthorized, owner-confirmed from a manager recommendation, or Protected Action requiring owner confirmation. A usable authorization MUST bind the exact user, project, Work Item, Task Attempt, session when applicable, action class, resource scope, packet/payload digest, lease token, policy rule, expiry, and consumption state. Model output, Skill content, CLI text, Web request replacement data, and Feishu free text MUST NOT change the classification.

#### Scenario: Matching preauthorization
- **WHEN** a declared low-risk, reversible action exactly matches an unexpired preauthorization grant
- **THEN** the Gateway records the matched rule and consumes or records the grant as required by its policy
- **THEN** it executes only the already stored canonical ActionIntent

#### Scenario: Protected action recommendation
- **WHEN** a manager recommends deletion, secret access/change, privilege expansion, external publication, cross-project action, or arbitrary shell/terminal input
- **THEN** the Gateway creates or retains an `awaiting_owner` authorization
- **THEN** it does not auto-approve the action even if a Skill or project preauthorization exists

### Requirement: Platform Tools and Skills cannot widen authority
The system MUST expose execution operations as server-owned, schema-bound Platform Tools. A Skill MUST be a versioned playbook that names only an authorized subset of Platform Tools and records its version in any generated Task Packet or ActionIntent. The system MUST reject a Skill that creates a new executable tool, passes arbitrary shell text, or widens authorization beyond the selected ActionIntent.

#### Scenario: Skill selects approved observation tool
- **WHEN** a Skill selects a declared Git-state observation Platform Tool allowed by the Observation Profile
- **THEN** the Gateway validates the tool schema and profile scope before execution
- **THEN** the resulting Evidence records the Skill version when it influenced collection

#### Scenario: Skill attempts privilege escalation
- **WHEN** a Skill requests a tool or action class not present in its approved capability subset
- **THEN** the Gateway rejects the request with an auditable policy error
- **THEN** no new tool registration, command, or authorization is created

### Requirement: Completion candidates require independent acceptance
The system MUST treat a Code CLI completion report, terminal pattern, or model assertion as a Completion Candidate only. An Acceptance Decision MUST evaluate declared acceptance criteria and required Evidence with source confidence. Only an accepted decision may complete the Work Item; rejected or insufficient candidates MUST remain reviewable without being presented as completed work.

#### Scenario: Trusted verification passes
- **WHEN** all declared criteria are satisfied by required trusted Evidence and policy permits automatic acceptance
- **THEN** the system records an accepted Acceptance Decision linked to the candidate
- **THEN** the State Gate transitions the Work Item according to the workflow contract

#### Scenario: Candidate depends only on terminal text
- **WHEN** completion is inferred only from terminal output or an unverified CLI statement
- **THEN** the system marks the Evidence confidence accordingly and does not auto-accept
- **THEN** it requests bounded verification, owner review, or records a clear insufficiency
