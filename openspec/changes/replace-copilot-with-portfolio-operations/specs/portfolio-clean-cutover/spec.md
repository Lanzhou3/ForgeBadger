## ADDED Requirements

### Requirement: Portfolio Operations is isolated from Legacy Copilot before Cutover
All new Portfolio Operations routes, services, repositories, state controllers, event names, Web types, and UI components MUST use isolated Portfolio namespaces. They MUST NOT import legacy Copilot services/repositories or read legacy Copilot conversations, runs, memories, pending actions, tool results, or automation records as workflow input. The system MUST NOT dual-write a Portfolio fact into legacy Copilot state or use a legacy fallback reader. `/portfolio` MUST be the complete primary workspace; `/copilot` MAY remain only as a Portfolio-only alias. The pet MAY open only a floating Portfolio companion Dialog: submitted text creates a Portfolio Request, and timely acknowledgement/progress comes only from the persisted Request's safe status, not a legacy model-chat reply. The alias and Dialog use Portfolio i18n and the restricted Portfolio API/read/event facade. They cannot receive execution runtime, worker capabilities, terminal writers, or any legacy Copilot API/runtime/data dependency, and they cannot disclose credentials, raw provider/terminal content, signed action material, or cross-tenant data. At Cutover, the Gateway legacy route/runtime/data access and legacy Feishu handler are removed. Historical Copilot tables, migrations, and data remain physically retained but have no runtime access and are reserved solely for separately authorized backup/export and disposable restore. The shared Feishu transport registry/selector cannot dual-deliver a Portfolio fact.

#### Scenario: New Portfolio Request is created before Cutover
- **WHEN** an owner creates a Portfolio Request while the legacy Copilot code remains deployed for unrelated existing behavior
- **THEN** all Portfolio workflow facts are written only to Portfolio Operations records
- **THEN** no legacy Copilot run, pending action, or memory record is created or read for that request

#### Scenario: Legacy record ID is supplied to Portfolio API
- **WHEN** a caller supplies a legacy Copilot run or pending-action ID to a Portfolio endpoint
- **THEN** the endpoint rejects it as an invalid Portfolio identifier
- **THEN** it does not look up, translate, or import legacy state

#### Scenario: Pet opens the Portfolio companion Dialog
- **WHEN** an authenticated user opens the pet companion or submits text through it
- **THEN** the pet opens a floating Portfolio-only Dialog, and submission creates a tenant-scoped Portfolio Request through the same restricted path as `/portfolio`
- **THEN** acknowledgement and progress are rendered only from the persisted Request's safe status using Portfolio i18n, not from a legacy model chat or simulated execution result
- **THEN** it exposes no legacy Copilot API/runtime/data dependency, execution or terminal-write capability, credential, raw provider/terminal content, signed action material, or cross-tenant data
- **THEN** the release does not claim focused browser or integrated acceptance before deferred verification is completed

### Requirement: Legacy removal inventory is complete and reviewable
The Clean Cutover plan MUST maintain a reviewed inventory of every Legacy Copilot-owned route, mount, service, repository, table, migration, event name, background scheduler, Web page/drawer/component, API client/type, i18n key, test, script, documentation reference, and dependency. Each entry MUST be classified as remove, retained shared foundation, retained Portfolio presentation, or replaced by a named Portfolio component. The inventory MUST verify that retained Portfolio presentation (`/copilot` alias and pet-triggered floating companion Dialog) has no legacy API/runtime/data import or request, uses Portfolio i18n, creates Requests only through the restricted Portfolio path, and returns only safe persisted Request status. Historical tables/migrations/data are classified as physically retained with no runtime access, pending the separately authorized backup/export and disposable restore procedure.

#### Scenario: Shared platform foundation is retained
- **WHEN** an existing Event Bus, Outbox utility, Session Manager, tmux integration, authentication component, or redaction utility is needed by Portfolio Operations
- **THEN** the inventory marks it as retained shared foundation with its invariant and new owner
- **THEN** the retained component does not preserve a legacy Copilot route or state dependency

#### Scenario: Legacy route remains after proposed deletion
- **WHEN** the cutover scan finds an active `/api/v1/copilot/**` mount, legacy navigation entry, or Legacy Copilot import
- **THEN** the Cutover gate fails with the unresolved inventory entry
- **THEN** the release does not claim clean replacement completion

### Requirement: Legacy data backup is separate and restore-tested
Before destructive legacy persistence removal, the release owner MUST authorize a backup/export of the legacy Copilot data. The backup MUST be integrity checked and restore-tested against a disposable target without loading any record into Portfolio Operations. Legacy data MUST NOT be migrated, transformed, or displayed as a Portfolio Request, Evidence, Authorization, Work Item, or Acceptance Decision.

#### Scenario: Backup restore test
- **WHEN** the approved backup/export is produced before Cutover
- **THEN** the release process restores it into an isolated disposable environment and verifies expected legacy data readability
- **THEN** the test records the backup version, checksum, restore result, and operator evidence

#### Scenario: Historic Copilot claim resembles a completion fact
- **WHEN** a legacy run contains a claim that a task completed
- **THEN** Portfolio Operations does not import the claim as Evidence or Acceptance
- **THEN** any new Work Item requires new evidence under the Portfolio contract

### Requirement: Cutover removes the full Legacy Copilot authority surface atomically
At Clean Cutover, the release MUST make `/portfolio` the complete primary workspace, retain `/copilot` only as its Portfolio-only alias, and retain only the pet-triggered floating companion Dialog as Portfolio presentation. The Dialog creates Portfolio Requests and reports persisted safe Request status with Portfolio i18n; it is not a legacy model chat. It MUST unmount `/api/v1/copilot/**`, remove legacy Copilot Gateway runtime and background work, and delete legacy provider/conversation Web clients, tests, types, and events. Historical Copilot tables, migrations, and data remain physically retained with no runtime access pending the authorized backup/export and disposable restore procedure. It MUST NOT leave a compatibility adapter, dual-write path, fallback read, hidden legacy action endpoint, or presentation dependency on legacy Copilot data/runtime. The retained presentation cannot receive execution/terminal-write authority or disclose credentials, raw provider/terminal content, signed action material, or cross-tenant data. The deletion batch and retained-presentation audit MUST be reviewed as one coherent change.

#### Scenario: Post-cutover generic Copilot request
- **WHEN** a client requests a removed legacy Copilot endpoint after Cutover
- **THEN** the Gateway exposes no live Legacy Copilot behavior or compatibility response
- **THEN** the client is directed only through the documented Portfolio contract in a non-sensitive error response

#### Scenario: Background startup after Cutover
- **WHEN** the Gateway starts after the Cutover release
- **THEN** it initializes Portfolio scheduler and connector services only when configured
- **THEN** it does not recover or schedule Legacy Copilot runs, pending actions, memories, or automations

### Requirement: Cutover acceptance proves safety and absence of legacy dependencies
The Cutover release MUST pass fresh transition, tenant-isolation, idempotency, authorization bypass, scheduler restart/lease, observation boundary, Feishu replay/outbox, Gateway/Web typecheck and build, and end-to-end Request-to-Acceptance evidence. It MUST also prove that Heartbeat is disabled by default, free-form channel text cannot reach terminal input, Protected Actions require owner confirmation, and repository scans contain no live legacy route/import/request references outside the separately retained backup procedure and the explicitly retained Portfolio presentation.

#### Scenario: Required safety negative test fails
- **WHEN** a validation test demonstrates a legacy fallback, cross-tenant access, duplicate dispatch, direct channel-to-terminal path, or Protected Action auto-approval
- **THEN** the Cutover gate fails and the release remains uncut
- **THEN** no cleanup or legacy table deletion is represented as complete

#### Scenario: Full acceptance passes
- **WHEN** the new Request-to-Acceptance path and all required negative tests pass against a fresh disposable database
- **THEN** the release records the exact commands, results, and environment caveats as cutover evidence
- **THEN** the team may proceed to the separately reviewed legacy deletion batch
