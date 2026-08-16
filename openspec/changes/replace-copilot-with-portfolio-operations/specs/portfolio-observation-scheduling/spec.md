## ADDED Requirements

### Requirement: Observations are declared and project-bounded
The system MUST collect Evidence only for an explicitly enrolled Portfolio Project with an active Observation Profile. Phase 5 V1 supports exactly two probe contracts: `platform_lifecycle_v1` and `git_state_v1`. Each enabled V1 probe MUST have `rootRef=project_root` and `argumentsJson={}`; the system MUST reject every other source, root reference, or argument value. It MUST resolve and revalidate the approved project root on every run, not reuse a previously validated path.

`platform_lifecycle_v1` MUST derive facts only from a tenant-scoped, persisted Portfolio database snapshot and MUST spawn no process. It is reconciler-driven and MUST NOT be triggered from a generic hook/event source because Phase 5 has no stable producer-event identity contract. `git_state_v1` is the only V1 non-platform probe. It MUST use the server-owned non-shell recipe `git -C <revalidated-project-root> status --porcelain=v1 --branch`; no persisted mutable command text, model, Skill, connector, or client input may select an executable, change the recipe, or add arguments. The model MUST NOT generate or execute arbitrary shell commands.

Both V1 probes MUST use a fixed 5-second timeout, cap combined ephemeral stdout/stderr capture at 16 KiB, persist a redacted summary of at most 1,024 characters, and discard raw output after bounded redaction/digest derivation. The `platform_lifecycle_v1` freshness window is 5 minutes and the `git_state_v1` freshness window is 15 minutes. Raw output MUST NOT be persisted in Evidence, facts, reconciliation runs, logs, or user projections.

#### Scenario: Declared Git-state probe
- **WHEN** a due observation requests the configured Git-state probe for an enrolled project
- **THEN** the Gateway revalidates the project root and executes only the fixed server-owned Git recipe without a shell
- **THEN** it records a bounded, redacted result or an explicit collection failure

#### Scenario: Model suggests an extra command
- **WHEN** model reasoning suggests a shell command not declared by the Observation Profile
- **THEN** the system rejects the suggestion as an unsupported observation operation
- **THEN** no process is spawned and no Evidence is fabricated

### Requirement: Evidence has provenance and freshness
The system MUST persist Evidence with tenant, project, optional Work Item/Attempt scope, producer, source category, observation time, collection time, digest, bounded redacted summary, confidence, and freshness status. The Project Dossier display MUST retain each source's latest status as exactly `fresh`, `stale`, `unknown`, `timeout`, or `failed`; display status is not evidence eligibility. Its separate current-fact read MUST return only Evidence designated `current`, meaning it remains `fresh` within the source's fixed freshness window. Intake, Task Packet construction, and Acceptance Decision current-fact gates MUST use that current-fact read. Stale, unknown, timeout, and failed Evidence MUST NOT satisfy a current-fact gate or be converted into a current project fact.

#### Scenario: Git observation times out
- **WHEN** a declared Git-state probe exceeds its configured timeout
- **THEN** the system records timeout Evidence with its collection metadata and no partial unredacted output
- **THEN** the Project Dossier retains `timeout` as the latest display status and returns no current fact for that source

#### Scenario: Evidence is rendered in Web or Feishu
- **WHEN** an Evidence-backed progress update is projected to a user surface
- **THEN** it includes safe provenance, freshness, and bounded summary information
- **THEN** it excludes credential material, raw terminal transcript, and unredacted sensitive output

### Requirement: Risk Signals are advisory facts
The system MUST create a Risk Signal for stale observations, forecast overrun, lack of expected progress, failed bounded probes, or other supported evidence conditions. A Risk Signal MUST reference its evidence and severity rationale. A Risk Signal MUST NOT call the State Gate or transition a Work Item or Acceptance Decision to any lifecycle state.

#### Scenario: Forecast checkpoint expires without evidence
- **WHEN** a tracked Task Attempt reaches a forecast checkpoint without new progress Evidence
- **THEN** the system records a Risk Signal and schedules a bounded review Wakeup when tracking is enabled
- **THEN** it does not mark the Work Item blocked or completed solely because time elapsed

#### Scenario: Evidence confirms a real blocker
- **WHEN** an observation records a concrete blocker and the State Gate validates it against the Work Item
- **THEN** the system may create both a Risk Signal and blocker Evidence
- **THEN** only the validated blocker Evidence may support a subsequent `blocked` transition

### Requirement: Workflow Wakeups are durable, leased, and idempotent
Each Task Attempt MUST persist immutable `tracking`, which defaults to `false` at creation. The system MUST create or coalesce Workflow Wakeups only for an Attempt created with `tracking=true`; a later update cannot enable tracking. Each Wakeup MUST have a reason class, due time, idempotency/coalescing key, retry count, budget, and terminal result.

Workflow Wakeups and Heartbeats MUST share one durable Reconciliation Run ledger. Every ledger row MUST include source, source-record identity, idempotency slot, state, claim-token digest, claim lease, attempt count/budget, and a safe result digest or stable error code. It MUST NOT contain raw output. The scheduler MUST atomically claim due work through this ledger, assign a 60-second claim lease, and never run two reconciliation effects for the same active claim. It MUST tick every 15 seconds and claim no more than 20 due items in one batch.

A Workflow Wakeup MUST allow at most 3 retries and therefore at most 4 total claims. Its fixed retry backoff is 60 seconds, 300 seconds, and 1,800 seconds; after the fourth failed claim it enters `exhausted` with a stable error reason and no further automatic retry.

#### Scenario: Restart while a Wakeup is claimed
- **WHEN** the Gateway restarts while a Wakeup claim lease is active
- **THEN** recovery first records an `unknown` Reconciliation Run for the uncertain claim
- **THEN** it may reschedule only a fixed read-only V1 observation after recovery and never dispatches, sends terminal input, invokes a model, performs Feishu work, or delivers a notification

#### Scenario: Unqualified lifecycle trigger is received
- **WHEN** a generic CLI lifecycle hook or event attempts to create a Phase 5 Wakeup
- **THEN** the scheduler rejects it because no stable producer-event identity contract exists in Phase 5
- **THEN** retry budgets and audit records remain bounded

### Requirement: Portfolio Heartbeat is optional and separately controlled
The system MUST store a tenant-scoped Portfolio Heartbeat setting with `enabled=false` by default. When enabled, cadence MUST be an integer from 5 through 1,440 minutes inclusive. A disabled Heartbeat MUST materialize no recurring Reconciliation Run. Heartbeat reconciliation MUST use the shared Reconciliation Run ledger and the same fixed read-only observation, claim, budget, and idempotency rules as Workflow Wakeups. Phase 5 MUST include no model runtime. A no-change Heartbeat MUST create no model call or user notification and may record only bounded operational metadata when needed.

#### Scenario: Heartbeat is disabled
- **WHEN** a user has not enabled the Portfolio Heartbeat
- **THEN** the scheduler creates no recurring portfolio reconciliation jobs for that user
- **THEN** an already tracked Task Attempt may still run its explicitly configured Workflow Wakeup

#### Scenario: Heartbeat observes no change
- **WHEN** an enabled Heartbeat collects only unchanged fresh Evidence and no due workflow decision
- **THEN** the system records bounded operational metadata as needed
- **THEN** it does not invoke a model or create a user notification

### Requirement: Scheduler budgets prevent autonomous loops
The system MUST enforce the fixed per-Wakeup claim and retry limits and MUST NOT add model, dispatch, terminal-input, Feishu, or delivery work to a Phase 5 reconciliation run. On budget exhaustion it MUST record a stable reason, stop automatic side effects, and may surface an advisory Risk Signal or owner-review request. It MUST NOT silently reschedule indefinitely.

#### Scenario: Repeated observation failure
- **WHEN** a Wakeup exhausts its configured retry budget due to repeated collection failures
- **THEN** the Wakeup enters `exhausted` and records the final failure reason
- **THEN** the system emits a safe risk/update projection without creating another automatic retry
