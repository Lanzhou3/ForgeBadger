# Gate 1 Review: Contract, Cutover, and Implementation Baseline

**Change:** `replace-copilot-with-portfolio-operations`  
**Review scope:** tasks 1.1–1.6 only  
**Reviewed revision:** `06b4d05b` on `copilot-dev`  
**Decision:** **approved to begin Phase 2 persistence work, with the mandatory controls below**

This review approves the target contract, not the Portfolio Operations feature. No Portfolio runtime, route, table, or UI has been implemented at this point.

## 1. Evidence and Scope Boundary

| Evidence | Result |
| --- | --- |
| `openspec instructions apply --change replace-copilot-with-portfolio-operations --json` | This change has 54 implementation tasks; Phase 1 is tasks 1.1–1.6. |
| `openspec instructions apply --change add-project-manager-agent-control-loop --json` | The prior Project Manager change has 14/65 tasks marked complete. Its remaining plan retains Copilot compatibility and is not a Portfolio implementation contract. |
| `rg -n -i '/api/v1/portfolio|services/portfolio|portfolio_(requests|task_attempts|authorizations|evidence|workflow_wakeups|channel_actions|heartbeats)' packages/gateway/src packages/web/src` | No source match: there is no Portfolio runtime implementation. |
| `rg --files packages/gateway/src/services/copilot | wc -l` | 20 Legacy Copilot service files remain. |
| `packages/gateway/src/routes/index.ts:107` | `/api/v1/copilot` remains mounted. |
| Current worktree | Unrelated user edits exist in `packages/web/src/app/(dashboard)/page.tsx` and `packages/web/src/lib/i18n.ts`; this phase did not modify them. |

The earlier `add-project-manager-agent-control-loop` artifacts are useful design evidence only. Its source compatibility assumptions, including backfill from `details.taskPacket` and a command foreign key to `copilot_pending_actions`, conflict with this change's Clean Cutover and therefore do not become an implementation dependency.

## 2. Project Manager Invariant Mapping

The table below records every current Project Manager record considered for reuse. “Reference only” means the current implementation can inform a new Portfolio record but cannot be the authoritative row or a compatibility contract.

| Current record/service | Current evidence | Target mapping | Conflict or required change |
| --- | --- | --- | --- |
| `projects` | Tenant-scoped project root in `schema.ts`; repositories already scope by user. | **Retain shared foundation.** A Portfolio Project is an explicit enrollment of an existing project. | Enrollment and a Project Dossier are absent; Portfolio must never infer membership by scanning disk. |
| `project_manager_goals` / `ProjectManagerGoal` | One mutable goal per project, with summary, constraints, acceptance criteria, details, and status (`schema.ts:327`; repository `upsertGoal`). | **Retain as legacy board context only; do not use as Project Dossier authority.** | It lacks explicit portfolio enrollment, accountable owner, intended outcome, observed-state evidence, source request link, and immutable decision history. |
| `project_manager_work_items` / `ProjectManagerWorkItem` | Has existing target statuses and acceptance criteria (`schema.ts:353`; `project-manager-repository.ts:194-200`). | **Evolve through Portfolio State Gate after a migration/invariant audit.** It remains the board-facing Work Item only if target fields and guarded writes can be added atomically. | No Portfolio Request link, source version/CAS, owner action, completion candidate, or accepted decision. Direct route/repository status writes currently allow `in_progress → done` with evidence/manual reason (`project-manager-repository.ts:429`; `routes/project-manager.ts:370`). |
| `project_manager_ledger_events` / `ProjectManagerLedgerEvent` | Append-only-looking readable timeline with JSON details and legacy fields such as `copilotRunId`/`pendingActionId`. | **Retain only as a human-readable projection during the board transition.** | It is not the current-state source, lacks typed Portfolio fact vocabulary/correlation/idempotency, and contains legacy Copilot traces. New Portfolio facts need their own immutable audit/event records. |
| `project_manager_task_attempts` | Tenant/project/work-item scope, attempt number, desired/observed states, input digest, budgets and deadline (`schema.ts:589`). | **Reference only; create a new Portfolio Task Attempt contract.** | It has no Portfolio Request/Packet record/actor/canonical state version. It is not runtime-reachable and reflects the prior change's semantics rather than the accepted Portfolio state machine. |
| `project_manager_session_assignments` | Has adapter capability JSON, lease token/expiry and active-slot uniqueness (`schema.ts:630`). | **Reference only; reproduce proven lease constraints in Portfolio assignment persistence.** | There is no Portfolio action/authorization linkage and no runtime dispatcher validates these leases. It cannot be adopted by assumption. |
| `project_manager_commands` | Has command digest/idempotency and an `approval_id` FK to `copilot_pending_actions` (`schema.ts:673-710`). | **Do not reuse. Replace with Portfolio command/action records.** | The foreign key directly depends on Legacy Copilot and violates Clean Cutover. It also lacks canonical ActionIntent, tier, owner decision, policy rule, and action expiry fields. |
| `project_manager_acceptance_results` | Stores verdict, criteria, verification, evidence references, policy and summary (`schema.ts:712`). | **Reference only; create a Portfolio Acceptance Decision record.** | It has no explicit candidate/accepted/rejected/superseded lifecycle, owner decision identity, evidence provenance/freshness, or State Gate enforcement. |
| `project_manager_wakeups` | Has reason class, not-before, claim token/expiry and retry count (`schema.ts:746`). | **Reference only; implement Portfolio Workflow Wakeups.** | It has no tracking opt-in, distinct Heartbeat source, coalescing/version semantics, decision budget, delivery boundary, or scheduler runner. |
| `ProjectManagerExecutionLedgerService` and backfill | Deterministic digest, CAS attempt transitions and budget helpers are unit-tested, but only its own file imports it; `execution-backfill.ts` reads legacy `details.taskPacket`. | **Reference only; extract/test ideas, not a runtime dependency.** | No route/startup/event-bus reachability, no worker adapter, no authorization policy, no evidence service, and no current State Gate. The backfill premise is incompatible with a no-legacy-state-migration Portfolio design. |

### Invariant conclusion

The current Project Manager board may be evolved visually and, after a Phase 2 audit, may retain Work Item identifiers. No existing Project Manager execution row is approved as the new Portfolio canonical state. Phase 2 must either add an atomic, State-Gate-owned Work Item extension or create a Portfolio projection; it must not dual-write `details.taskPacket`, Copilot pending actions, or legacy execution rows.

## 3. Legacy Copilot Removal Inventory and Classification

This is a snapshot inventory for Clean Cutover. Historical migration files are intentionally retained; removal of their tables happens through a new forward migration after an approved backup and restore proof.

### 3.1 Gateway runtime and persistence

| Inventory item | Classification | Cutover action / Portfolio replacement |
| --- | --- | --- |
| `packages/gateway/src/routes/index.ts` mount at `/api/v1/copilot` | Replace | Unmount legacy route and mount isolated `/api/v1/portfolio/**` routes. |
| `packages/gateway/src/routes/copilot.ts` | Remove | Portfolio Request, authorization, dispatch, and acceptance route modules. |
| `packages/gateway/src/services/copilot/**` (20 files: orchestrator, provider clients, tool registry/read tools, memory, active recall, session-input approval, automation policy/runner/scheduler/tools/types, conversation context, provider selection/failure, redaction, types) | Remove as a module | Recreate only reviewed shared primitives, such as redaction, behind Portfolio-owned interfaces; do not import the legacy directory. |
| `packages/gateway/src/db/repositories/copilot-repository.ts`, `copilot-memory-repository.ts`, `copilot-automation-repository.ts` | Remove | Portfolio repositories for Requests, Evidence, Authorizations, Wakeups, Channel Actions and delivery records. |
| Schema exports `copilotRuns`, `copilotRunEvents`, `copilotConversations`, `copilotMessages`, `copilotPendingActions`, `copilotMemoryEntries`, `copilotMemoryNotes`, `copilotMemoryFts`, `copilotAutomations`, `copilotAutomationRuns`, `copilotAutomationRunProjects` | Remove after backup/restore | Add a reviewed forward migration that removes these tables only at Clean Cutover. |
| `0013_copilot.sql`, `0014_copilot_memory.sql`, `0018_copilot_conversations.sql`, `0020_copilot_live_run_constraint.sql`, `0029_copilot_automations.sql`, `0030_copilot_source_idempotency.sql` and their generated migration metadata | Retain historical migration history | Never delete/alter applied migration history. Add a later forward migration for legacy-table removal. |
| `packages/gateway/src/routes/automations.ts` and automation mount | Replace | Portfolio Heartbeat and Workflow Wakeup controls; no generic Copilot automation run. |
| `packages/gateway/src/services/integrations/feishu-runtime-factory.ts` | Replace | Native Portfolio Feishu runtime. Current factory imports `CopilotOrchestrator`, `CopilotAutomationScheduler`, and pending-action bridges. |
| `packages/gateway/src/services/integrations/feishu-pending-action-bridge.ts` | Remove | Portfolio Channel Action resolver only. |
| `packages/gateway/src/services/integrations/feishu-conversation-binding.ts` and `feishu-ingress-worker.ts` | Rewrite as candidate foundation | Keep verified ingress/idempotency plumbing only after it no longer dispatches `FeishuCopilotInboundDispatcher` or creates a Copilot conversation. |
| `packages/gateway/src/services/integrations/feishu-delivery-service.ts`, `feishu-delivery-worker.ts`, `feishu-sdk.ts`, `feishu-event-normalizer.ts`, `feishu-error-redaction.ts`, `feishu-connection-supervisor.ts` | Retain shared foundation after adapter audit | Reuse delivery transport, durable claim, SDK, normalization, redaction, and connection lifecycle only; Portfolio owns payload, event identity, binding and business decision semantics. |
| `feishu_channel_accounts`, `feishu_channel_inbox`, `feishu_channel_logical_claims`, `feishu_channel_outbox` | Retain candidate foundation after schema audit | Preserve account/inbox/deduplicated delivery mechanics if they can carry Portfolio correlation/version semantics. |
| `feishu_conversation_bindings`, `feishu_card_actions` | Replace or migrate as channel-only records, never as Portfolio facts | Existing rows bind a Copilot conversation/resource revision; Portfolio needs tenant identity binding, allowed conversation and opaque signed one-use action references. |
| `packages/gateway/src/services/event-bus.ts` and event WebSocket transport | Retain transport; remove legacy event vocabulary | Replace `copilot_*` projection events with redacted `portfolio.*` events. |
| `packages/gateway/src/services/session-manager.ts`, tmux, adapter discovery, authentication, repository tenant filters, audit log, safe resolve | Retain shared foundations | Portfolio dispatch calls them through a new governed adapter/service seam. |
| `packages/gateway/src/routes/model-providers.ts`, `services/model-provider-readiness.ts`, `services/diagnostics.ts` | Rewrite shared concerns | Remove Copilot-specific readiness/diagnostic entries while retaining provider/diagnostic platform features that remain in scope. |

### 3.2 Gateway and integration test inventory

| Test group | Classification | Cutover action |
| --- | --- | --- |
| `copilot-automation-{policy,repository,runner,scheduler,tools}.test.ts`, `copilot-memory-repository.test.ts`, `copilot-model-client.test.ts`, `copilot-repository.test.ts`, `copilot-routes.test.ts`, `copilot-tools.test.ts`, `integration/copilot-tmux.test.ts` | Remove | Replace with Portfolio transition, authorization, scheduler, bounded observation, and governed dispatch tests. |
| `feishu-copilot-result.test.ts`, `feishu-pending-action-bridge.test.ts` | Remove | Replace with Portfolio Request-only ingress and signed single-use Channel Action tests. |
| `db-schema.test.ts`, `diagnostics{,-routes}.test.ts`, `model-provider-routes.test.ts`, `websocket-events.test.ts` | Rewrite focused assertions | Remove legacy expectations, keep platform behavior where still applicable. |
| `feishu-{channel-routes,conversation-binding,ingress,integration}.test.ts` | Rewrite | Preserve ingress/outbox negative cases; replace Copilot dispatch expectations with Portfolio contract assertions. |
| `project-manager-{repository,routes}.test.ts` | Rewrite | Enforce State Gate ownership and request/acceptance linkage instead of direct status writes. |
| `project-manager-{execution-repository,execution-ledger,execution-backfill}.test.ts` | Retain only as reference coverage, then replace | Port valid CAS/digest/lease cases to Portfolio tables; delete backfill coverage based on `details.taskPacket`. |

### 3.3 Web, scripts, and documentation inventory

| Inventory item | Classification | Cutover action |
| --- | --- | --- |
| `packages/web/src/app/(dashboard)/copilot/page.tsx`, `components/copilot/copilot-chat-panel.tsx`, `copilot-drawer.tsx`, `pixel-robot.tsx`, `robot-widget.tsx`, `lib/copilot.ts`, `lib/copilot-route-context.ts` and their tests | Remove | Portfolio workspace, Request Inbox, Project Dossier, workflow board, authorization queue, and safe event client. |
| `packages/web/e2e/copilot.spec.ts` | Remove | Request-to-Acceptance and Feishu/Web projection E2E. |
| `components/layout/{app-shell,sidebar}.tsx`, `lib/{api,keyboard-shortcuts,i18n}.ts`, dashboard/project/model pages and components, notifications hook, and their listed tests | Rewrite shared surface | Remove Copilot navigation, shortcuts, launch links, provider-only manager controls, API types, copy and event refreshes; do not alter unrelated user changes during this phase. |
| `packages/web/e2e/{models,project-manager,settings}.spec.ts` | Rewrite focused expectations | Retain unrelated coverage; replace Copilot-specific flows. |
| `scripts/smoke-copilot-provider.ts` and test | Remove/replace | Portfolio fixture and safe control-loop smoke; no generic provider loop smoke remains. |
| Trial-feedback/audit scripts and validation scripts that mention Copilot | Rewrite only where behavior/labels are live | Keep trial infrastructure; replace legacy product vocabulary and routes. |
| `docs/API.md`, `TECH-ARCHITECTURE.md`, `DEVELOPMENT-PLAN.md`, `TEST-PLAN.md`, `SMOKE-TEST.md`, `CI-CD-PLAN.md`, support/trial/evidence/open-source docs, `CONTRIBUTING.md`, `SECURITY.md`, issue templates and `package.json` scripts | Rewrite at Cutover | Remove live Copilot contract and test references; preserve historical release context where explicitly marked historical. |
| `docs/adr/0001-replace-legacy-copilot-with-portfolio-operations.md` and this OpenSpec change | Retain | These are the recorded replacement decision and must not be deleted as legacy runtime references. |

### 3.4 Required Cutover scans

The Cutover gate must run and resolve all results from the following scan classes, excluding only the retained ADR, change artifacts, historical backup procedure, and explicitly historical release notes:

```text
rg -n -i '/api/v1/copilot|createCopilotRoutes|CopilotOrchestrator|CopilotRepository' packages scripts docs
rg --files packages/gateway/src/services/copilot packages/web/src/components/copilot
rg -n 'copilot_' packages/gateway/src/db/schema.ts packages/gateway/src/db/migrations
```

## 4. Legacy Backup, Retention, and Disposable Restore Procedure

This procedure is designed now; task 8.3 executes it after new-system acceptance. It is not an authorization to delete any database table or copy production data today.

### Preconditions

1. The release owner explicitly approves the resolved `FORGEBADGER_DB_PATH`, destination directory, and the 30-day encrypted retention window. A different window requires a recorded owner decision.
2. The destination is outside the Gateway state directory, uses owner-only permissions, and is not committed, uploaded, or passed to Portfolio Operations.
3. The backup manifest records source path, release revision, UTC time, table list, SHA-256 digest, operator, and restore result. It contains no copied secret values.

### Procedure

1. Resolve and read-only verify the exact source SQLite database and legacy table presence. Do not accept a user-controlled arbitrary path.
2. Quiesce or use SQLite's online backup mechanism so the file is consistent. Produce a timestamped copy by `sqlite3 "$SOURCE_DB" ".backup '$BACKUP_DB'"`; use fixed, release-owner-approved paths rather than shell-interpolated input.
3. Restrict the backup and manifest permissions to the owner, then calculate `shasum -a 256 "$BACKUP_DB"` and record the digest.
4. Run `PRAGMA integrity_check;` and record table counts for the eleven Legacy Copilot tables only. Never put row content in the manifest or an agent prompt.
5. Restore only into a disposable, owner-only SQLite target. Query integrity and the same table counts directly with `sqlite3`; do not start the Portfolio Gateway against that target and do not invoke a migration/import.
6. Record pass/fail, destroy the disposable restore target, retain the encrypted backup for 30 days, and delete it only through a separate release-owner-approved cleanup action.

### Failure rules

- A checksum, integrity, or count mismatch blocks Cutover and preserves the source database unchanged.
- A backup cannot be used as a data migration source. A legacy completion claim remains legacy data, never Evidence or an Acceptance Decision.
- The running release can roll back only as a whole release plus its verified legacy backup. There is no runtime fallback or dual-read mode.

## 5. Contract Fixtures

`fixtures/portfolio-contract-fixtures.json` supplies non-secret examples for the Phase 2 API/schema tests. It fixes the required distinctions:

- a requirement is an immutable Portfolio Request, not a model message;
- an ActionIntent binds digest, scope, expiry and authorization tier;
- Evidence has provenance/freshness rather than raw terminal text;
- a Feishu Channel Action is an opaque single-use reference, not an executable payload;
- event projections and error envelopes are safe and standardised.

## 6. Security and Architecture Review

The target design passes Gate 1 **only with these non-negotiable implementation controls**.

| Control | Repository rule/evidence | Gate 1 decision |
| --- | --- | --- |
| Tenant isolation | Repository constructors filter `user_id`; security and API rules require tenant/resource authorization. | Every new Portfolio repository must use tenant-scoped lookups and return non-disclosing not-found behavior. |
| Input validation and API envelope | `.claude/rules/api.md` requires zod validation and `{ code, data, message }`. | Every mutation needs strict schema validation, bounded fields, stable error code and idempotency key handling before side effects. |
| Authorization | Security rules require authorization; design has three tiers. | State Gate reevaluates a canonical ActionIntent after every model/channel proposal. Protected Actions never auto-approve. |
| Shell/path safety | Root rules require `safeResolve`; arbitrary raw shell is prohibited. | V1 Git observation is a fixed Platform Tool with declared root/arguments/timeout. Model, Skill and Feishu input cannot create shell text. |
| Sensitive data | Security rules forbid logging credentials; terminal history stays in tmux. | Evidence, audit, WebSocket and Feishu projection contain digest/redacted summaries only. Raw terminal/provider content and card signature material never persist in Portfolio facts. |
| Channel ingress | Feishu requires verified identity, replay resistance and least privilege. | Validate signature/event ID before parsing; bind identity and conversation; signed one-use action consumes only a stored record. Free text creates a Request only. |
| Scheduler concurrency | Design requires lease/CAS/idempotency and bounded budgets. | Every wakeup, command, authorization consumption and outbox delivery must be transactionally claimed before an external effect. No degraded concurrent dispatch is allowed. |
| State integrity | Current Project Manager status update is direct. | New State Gate, not routes or client state, is the sole lifecycle writer; `done` requires an accepted decision. |
| Clean Cutover | New/old authority must not mix. | No new module imports Legacy Copilot repositories/services; the `project_manager_commands.approval_id` Copilot foreign key must not appear in Portfolio persistence. |

### Gate 1 findings carried into Phase 2

1. Use a strict `Idempotency-Key` contract (or verified provider event ID) for every retried external/mutation boundary; scope uniqueness by tenant and operation, not only browser session.
2. Model/provider output must parse into a bounded schema before it can create a recommendation. It may not yield SQL, path, shell, session input, or policy data.
3. Channel Action tokens must be opaque and HMAC/signed server-side, expire, be consumed atomically, and bind identity plus conversation. Do not reuse a broad client-supplied payload.
4. Observation source, timeout, output cap, redaction, freshness and project-root validation must be declarative in persistence. `git` is the only V1 non-platform probe.
5. Extraction of redaction/Outbox/Feishu transport helpers must preserve their existing tests before the Legacy Copilot module is removed.

## 7. Gate 1 Result

Tasks 1.1–1.6 are complete. The design is internally consistent with the repository's Gateway/Web boundary, tenant isolation, API envelope, tmux persistence, and security rules. The implementation baseline is intentionally **not** feature-complete; Phase 2 begins with isolated Portfolio persistence and State Gate work, not with a compatibility adapter or UI rewrite.

## 8. Gate 1 Follow-up: Phase 2 Persistence Contract Amendment

This addendum resolves material implementation ambiguity in tasks 2.1–2.7. It preserves the original Gate 1 evidence and does not report any Phase 2 implementation as complete.

1. `portfolio_work_items` is a new independent canonical projection. `project_manager_work_items`, its ledger, and every prior execution-ledger row are not the authoritative Portfolio work-item store and must not receive a dual write or compatibility read.
2. Phase 2 creates explicit ActionIntent, command-intent, observed dispatch-receipt, Completion Candidate, immutable `portfolio_facts`, and tenant-scoped idempotency operation records. A receipt is evidence of verified dispatch, not a session/tmux/browser inference; a Completion Candidate is not an Acceptance Decision.
3. Every applicable project relationship uses the composite tenant key `(user_id, project_id)` to a parent with `UNIQUE (user_id, id)`, and SQLite foreign-key enforcement is required. Every mutable aggregate uses expected projection-version CAS. Idempotency records are unique by `(user_id, operation, idempotency_key)`, retain the payload digest and stored replay result, and reject payload drift.
4. Projection CAS, immutable fact append, and command/outbox intent creation are one database transaction. This transaction may persist future command/delivery intent in Phase 2, but must not perform the external effect.
5. The State Gate matrix covers all valid edges for Portfolio Request, Work Item, Task Attempt, Execution Authorization, Workflow Wakeup, and Acceptance Decision, identifying actor/owner authority, precondition facts, expected version, idempotency operation, and invalid/terminal outcomes.
6. Required proof includes foreign-key pragma enforcement, rejection of cross-tenant linkage, one-active lease uniqueness for attempts and sessions, fact immutability, idempotency replay, payload-drift rejection, and no partial persistence on transaction failure.

**Phase 2 exclusion:** no scheduler or reconciliation runner, CLI/tmux/adapter dispatch or terminal input, Feishu ingress/card/outbox delivery, Portfolio API/events, or Web workflow is implemented in this phase, even where its future persistence rows exist.

## 9. Gate 1 Follow-up: Phase 5 Observation and Reconciliation Amendment

This approved amendment makes Phase 5 implementable without reporting any Phase 5 task complete. The concrete ownership, forward-migration, startup/shutdown, and fake-only verification plan is [`phase-5-implementation-plan.md`](phase-5-implementation-plan.md).

1. Task Attempt `tracking` is immutable and defaults to `false`; only an Attempt created with `tracking=true` may create a Workflow Wakeup.
2. The V1 observation allowlist is closed to persisted-state `platform_lifecycle_v1` and the fixed server-owned `git_state_v1` recipe. Both use `project_root`, `{}`, per-run root validation, a 5-second timeout, 16 KiB ephemeral capture, 1,024-character redacted persistence, and fixed 5-minute/15-minute freshness windows.
3. Project Dossier display status (`fresh`, `stale`, `unknown`, `timeout`, `failed`) is distinct from the current-fact read. Only current Evidence may satisfy Intake, Task Packet, or Acceptance Decision fact gates.
4. Wakeups and Heartbeats share a durable reconciliation-run ledger with idempotent 60-second leased claims, safe digests/errors only, a 15-second/20-item reconciliation limit, and bounded Wakeup retries (three retries, four claims total, 60s/300s/1800s backoff). Restart records `unknown` before it can reschedule only a fixed read-only observation.
5. Heartbeat remains disabled by default, permits only 5–1,440-minute enabled cadences, and materializes no recurring run when disabled. Phase 5 has no model runtime; a no-change heartbeat emits no notification.
6. Phase 5 collection is persisted-state reconciliation, not generic hook/event triggering. It adds no Phase 6 API, Event Bus, WebSocket, or Web work, and no Feishu/delivery/dispatch/input work. Risk Signals remain advisory and cannot call the State Gate.
7. Phase 5 preserves the existing unrelated `0034_remove_agents` migration and journal entry (`idx: 33`, tag `0034_remove_agents`). Its forward migration is the next append only: `0035_portfolio_observation_scheduler.sql`, journal `idx: 34`, tag `0035_portfolio_observation_scheduler`. The SQL migration and journal are the only forward-migration source of truth; the ignored Drizzle snapshot is not generated or committed.
8. Observation Profile activation is trusted internal startup work only. After session recovery, the provisioner selects active Portfolio enrollments, validates each tenant-scoped project path to a canonical path/device/inode identity, and only then upserts an active profile with the two fixed V1 probes. No route or other client-controlled input may activate a profile or supply a root, executable, probe, or arguments; a failed validation is skipped without an upsert.
9. Phase 5 acceptance cites the actual aggregate Gateway tests: `portfolio-observation-service.test.ts` covers the closed V1 probe/root/capture/redaction contract; `portfolio-reconciliation.test.ts` covers trusted profile activation, scheduler ledger/recovery, bounded Evidence/Risk finalization, Dossier currentness, and Heartbeat; and `portfolio-operations-runtime.test.ts` covers the fake 15-second runtime, bounded claim loop, abort/await shutdown, and the fake-tmux/injected-runtime recovery → profile-provisioning → runtime-start → runtime-stop-before-DB-close lifecycle. `portfolio-repository.test.ts` and `portfolio-state-gate.test.ts` remain the relevant tenant/CAS/idempotency/transition/acceptance regressions. No proof executes real Git, CLI, tmux, adapter, model, Feishu, or delivery code.

## 10. Gate 1 Follow-up: Phase 6/7 Coexistence and Feishu Transport Amendment

This approved amendment authorizes Phase 6 and Phase 7 implementation without reporting either phase as complete. The concrete boundary and deferred-verification contract is [`phase-6-7-implementation-plan.md`](phase-6-7-implementation-plan.md).

1. **Superseded presentation boundary (2026-08-16):** `/portfolio` is the complete primary workspace; `/copilot` is retained as its Portfolio-only alias. The pet opens a Portfolio-only floating companion Dialog. Its text creates a Portfolio Request, and acknowledgement/progress is derived only from persisted, safe Request status rather than a legacy model-chat reply. The retained presentation uses Portfolio i18n; it does not import, read, write, dual-write, or fall back to legacy Copilot state, restore a Copilot provider/runtime loop, receive execution/terminal-write authority, or disclose credential, raw provider/terminal, signed-action, or cross-tenant data. Gateway legacy Copilot API/runtime/data access and the legacy Feishu handler remain removed. Historical Copilot tables/migrations/data remain physically retained with no runtime access; focused browser and integrated verification remain deferred.
2. Phase 7 uses exactly one verified Gateway-owned Feishu transport multiplexer for each configured account. It validates/normalizes an event, then resolves exactly one active tenant-scoped binding for the verified account, identity, and allowed conversation before selecting one isolated handler. Missing, ambiguous, disabled, or cross-tenant bindings fail closed.
3. Portfolio is an isolated handler behind that transport. It MUST NOT create a second Feishu application/long-connection client, competing ingress callback, parallel binding handler, handler race, or a dual delivery path with Legacy Copilot. The shared transport may serve legacy behavior before Cutover, but a canonical Portfolio event is handled and delivered only once through the Portfolio path.
4. Fresh runtime execution, browser E2E, Feishu long-connection/transport tests, and smoke evidence are deferred to one later integrated verification gate. This amendment records no fresh test result, does not check a Phase 6/7 task box, and must not be cited as a passing runtime verification.

## 11. Gate 1 Failure Remediation: Phase 6/7 Ownership, Account, and Facade Amendment

This amendment resolves the Gate 1 failure without reporting implementation or verification evidence. Tasks 6.1–6.7 and 7.1–7.5 remain unchecked, and the later integrated verification gate remains the first permitted runtime/smoke pass claim.

1. Phase 7 owns an append-only forward migration for a verified provider-account registry and Portfolio channel bindings. The registry records provider, immutable provider account identifier/app identity, owner tenant, lifecycle state, and safe audit metadata, and enforces global `UNIQUE (provider, provider_account_id)`. Active Portfolio bindings reference a verified registry row, must have the same owner tenant, and are unique by `(provider_account_id, external_identity, conversation_id)`. Missing/multiple/colliding accounts or bindings and every cross-tenant relationship fail closed in persistence/repository code before handler selection. No applied migration is rewritten.
2. A single Gateway Feishu transport registry/selector owns both WebSocket/long-connection lifecycle and webhook ingress for every configured provider account. It validates/normalizes an event, verifies exactly one registry account, selects exactly one eligible handler (legacy or Portfolio), then requires exactly one active Portfolio binding when the Portfolio handler is selected. A collision, ambiguous/missing account, ambiguous/missing binding, disabled state, or owner mismatch rejects the event without workflow mutation or delivery. No event can be delivered by both handler paths.
3. Phase 6 `ServerDeps`, Portfolio routes, WebSocket publishers, and Web clients receive only a restricted Portfolio API/read/event facade. It may expose authenticated request operations, safe reads, and redacted event projections; it MUST NOT contain `PortfolioExecutionRuntime`, worker ACK/capabilities, worker dispatch ports, `SessionManager` terminal writers, `sendInput`, tmux, node-pty, or any equivalent terminal-write authority. Execution composition stays internal to the Gateway.
4. The single transport/account/binding and restricted-facade requirements are verified only by the later integrated runtime gate. This documentation change provides no test, smoke, connection, or browser pass result.
