## ADDED Requirements

### Requirement: Portfolio membership and dossiers are explicit
The system MUST treat only projects explicitly enrolled by their owner as Portfolio Projects. Each enrolled project MUST have a tenant-scoped Project Dossier containing its objective, owner reference, intended outcome, project scope, and the current evidence-backed Observed State. The system MUST NOT infer portfolio membership by scanning arbitrary directories or repositories.

#### Scenario: Enrolling an existing OpenForge project
- **WHEN** an owner enrolls a project that belongs to the authenticated tenant
- **THEN** the system creates or updates that project's Dossier with an audit fact
- **THEN** the project becomes eligible for Portfolio Requests, Work Items, and declared observations

#### Scenario: Attempting to observe an unenrolled path
- **WHEN** a request refers to a directory or repository that is not an enrolled project
- **THEN** the system records no project observation or workflow state for that path
- **THEN** the owner receives an explicit enrollment or routing decision requirement

### Requirement: Every requirement becomes an immutable Portfolio Request
The system MUST persist every Web or accepted Channel Connector requirement as a tenant-scoped Portfolio Request before performing intake, dispatch, or notification. A Portfolio Request MUST preserve its original wording, requester identity, source, received timestamp, source event identity when available, and an idempotency/correlation identifier. The original payload MUST NOT be silently rewritten by model reasoning or later workflow updates.

#### Scenario: Web requirement is submitted
- **WHEN** an authenticated owner submits a portfolio requirement through Web
- **THEN** the system creates a `received` Portfolio Request before any Work Item is created
- **THEN** later intake, work, evidence, and delivery records reference that request ID

#### Scenario: Duplicate channel delivery
- **WHEN** Feishu redelivers an inbound event with the same verified provider event identity
- **THEN** the system returns the existing Portfolio Request or a no-op result
- **THEN** it does not create a second Work Item or dispatch a second Task Attempt

### Requirement: Intake decisions record routing and owner involvement
The system MUST create an Intake Decision that records candidate project IDs, selected project ID when one exists, scope assessment, decision producer, supporting evidence references, and a decision status. A clear single-project, in-boundary request MAY create a `todo` Work Item automatically. Ambiguous routing, a request spanning multiple projects, a missing dossier, or a material scope change MUST move the request to `needs_owner_decision` until the owner decides.

#### Scenario: Clear in-boundary request
- **WHEN** intake identifies exactly one enrolled project and the request is within its Dossier scope
- **THEN** the system records the selected project and reasoning evidence in an Intake Decision
- **THEN** it may create one linked `todo` Work Item without treating model text as an unrecorded fact

#### Scenario: Ambiguous request
- **WHEN** intake finds multiple plausible projects or insufficient project evidence
- **THEN** the Portfolio Request transitions to `needs_owner_decision`
- **THEN** no Work Item, Task Attempt, or Code CLI dispatch is created until an owner records a decision

### Requirement: Work Item lifecycle is evidence-gated
The system MUST allow a Work Item only in `todo`, `in_progress`, `blocked`, `ready_for_review`, `done`, or `cancelled`. All transitions MUST pass through the Gateway State Gate, be linked to a Portfolio Request or owner action, and append a durable ledger fact. Direct route, Web, model, connector, or CLI writes to status MUST be rejected.

#### Scenario: Starting a Work Item
- **WHEN** a lease-valid Task Attempt has a recorded dispatch receipt for a `todo` Work Item
- **THEN** the State Gate may transition the Work Item to `in_progress`
- **THEN** a Task Attempt creation or idle session alone does not change the Work Item status

#### Scenario: Blocking a Work Item
- **WHEN** a trusted observation or owner report records an attributable blocker for an `in_progress` Work Item
- **THEN** the State Gate may transition it to `blocked` with the blocker Evidence reference
- **THEN** a timeout, missed forecast, or Risk Signal without blocker Evidence does not by itself make it blocked

### Requirement: Completion and cancellation require explicit authority
The system MUST transition a Work Item from `in_progress` to `ready_for_review` only after a Completion Candidate and all required verification Evidence exist. It MUST transition `ready_for_review` to `done` only after an accepted Acceptance Decision or the policy-required owner confirmation. Only the owner may cancel a Work Item by default. `done` and `cancelled` MUST be terminal in V1.

#### Scenario: CLI claims completion without evidence
- **WHEN** a Code CLI session reports that work is complete but required verification Evidence is missing
- **THEN** the system records a Completion Candidate or Risk Signal as appropriate
- **THEN** it does not transition the Work Item to `ready_for_review` or `done`

#### Scenario: Owner cancels active work
- **WHEN** the owner cancels a nonterminal Work Item
- **THEN** the State Gate records the owner decision, cancels pending governed operations, and transitions the Work Item to `cancelled`
- **THEN** a manager recommendation or channel free text alone cannot cancel it

### Requirement: Portfolio workflow preserves traceability and tenant isolation
The system MUST link each Work Item, Task Attempt, Evidence record, Risk Signal, Authorization, Acceptance Decision, and delivery projection to its initiating Portfolio Request or explicit owner action. Repositories MUST enforce `user_id` filtering before project, work-item, or attempt lookup. A cross-tenant caller MUST receive a non-disclosing not-found or equivalent response.

#### Scenario: Viewing a request timeline
- **WHEN** an owner reads a Portfolio Request timeline
- **THEN** the system returns only tenant-authorized linked workflow facts in causal order
- **THEN** the response excludes raw terminal transcript, credentials, and unrelated project records

#### Scenario: Cross-tenant work item ID
- **WHEN** a caller supplies another tenant's Work Item or Portfolio Request ID
- **THEN** the API does not reveal whether the ID exists
- **THEN** no linked attempt, authorization, evidence, or delivery record is returned or changed
