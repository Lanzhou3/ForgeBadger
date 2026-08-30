## Context

ForgeBadger currently has two adjacent but incompatible control models. The legacy `routes/copilot.ts` exposes a generic provider-backed conversation, run, memory, and pending-action loop. It can create Project Manager mutations after approval, but its run state is not a durable project-execution fact. The current Project Manager routes own goals, work items, a readable ledger, and Task Packet helpers, but a Task Packet start creates or links an idle session rather than forming a durable portfolio workflow.

The accepted product direction is a clean replacement: a local-first Portfolio Operations Manager coordinates explicitly enrolled projects; the Web console and a native Feishu connector are its surfaces; Gateway-owned records are canonical. The existing Project Manager board is retained only as the visual and domain basis for the Work Item workflow when its invariants match. The legacy Copilot is not a data source, compatibility dependency, or fallback.

Constraints:

- Gateway remains the sole owner of REST mutations, durable state, authorization, scheduler claims, tmux sessions, and Code CLI input.
- Every record and query is tenant-scoped by `user_id`; all mutation payloads validate at the Gateway boundary and use idempotency keys when retried.
- Terminal history remains in tmux, not SQLite. Portfolio records retain only structured, redacted evidence and references.
- V1 supports server-owned Platform Tools and one native Feishu connector. MCP Extensions, arbitrary raw shell, dynamic tool discovery, and direct channel-to-terminal input are excluded.
- The optional Portfolio Heartbeat is off by default. Explicitly tracked Task Attempts continue to receive Workflow Wakeups even when it is disabled.

## Goals / Non-Goals

**Goals:**

- Turn every inbound requirement into an immutable Portfolio Request and a traceable project-workflow outcome.
- Make Work Item lifecycle, Task Attempts, permissions, evidence, risk, acceptance, scheduling, and channel delivery durable and auditable.
- Ensure model reasoning can recommend only structured actions; Gateway services make all authoritative decisions and side effects.
- Provide one native Feishu path that is bound, replay-safe, idempotent, and cannot bypass Web/Gateway authority.
- Complete a single clean transition from legacy Copilot to Portfolio Operations without dual writes, fallback reads, or legacy state migration.

**Non-Goals:**

- A general-purpose conversational assistant, long-lived model memory, arbitrary autonomous coding loop, raw shell, or direct host/file-system agent.
- MCP Extensions, a multi-channel marketplace, or a generic external plugin/runtime model in V1.
- Multi-project scheduling optimization, task DAG execution, or unlimited concurrent Code CLI workers.
- Migration of legacy Copilot conversations, runs, memories, pending actions, or model assertions into Portfolio Operations facts.
- Silent automatic lifecycle transitions based solely on timeouts, terminal text, a model claim, or a Risk Signal.

## Decisions

### 1. Canonical records are domain facts, not conversation history

Portfolio Operations stores immutable input, decision, evidence, authorization, execution, and delivery facts. Current state is a server-derived projection of those facts, guarded by an explicit state machine. A model receives a bounded evidence view and returns a structured recommendation; the service validates it against current records before it can create a new fact.

This prevents the legacy mistake of treating a transient Copilot run or a model message as authority. It also borrows DeepSeek Harness's durable event provenance without adopting a generic model-session log as the product source of truth.

**Alternatives considered:**

- Extend legacy Copilot runs and pending actions: rejected because conversation cancellation, memory, and provider lifecycle do not match recoverable portfolio work.
- Store only a mutable workflow row: rejected because approvals, evidence, and outbox outcomes need independently auditable history.

### 2. Evolve Project Manager Work Items, but isolate every new portfolio concern

The Project Manager Work Item and readable ledger are the workflow-facing concepts. New Portfolio Requests, Dossiers, Attempts, Packets, Authorizations, Observation Profiles, Evidence, Risks, Wakeups, Channel Actions, and Outbox records are new, tenant-scoped records with repositories separate from legacy Copilot code.

Existing Project Manager persistence is reused only after an invariant audit confirms it can represent the target lifecycle and request linkage. Otherwise the Portfolio repository becomes authoritative and the board reads it through the new API. No new service may import the legacy Copilot repository or read legacy Copilot records.

**Phase 2 contract resolution:** `portfolio_work_items` is an independent, new canonical Portfolio projection; it is not `project_manager_work_items` renamed, extended, dual-written, or used through a compatibility repository. Existing Project Manager rows and the readable ledger remain historical/reference and board-migration inputs only. The Portfolio board must read `portfolio_work_items` through Portfolio repositories, and all new lifecycle writes go through the State Gate.

### 2a. Phase 2 persistence boundary and transaction contract

Phase 2 persists the State Gate contract only. It creates no scheduler runner or reconciliation loop, no CLI/tmux/adapter dispatch or terminal input, no Feishu ingress/card/outbox-delivery runtime, and no Portfolio HTTP route, event, or Web surface. Wakeup, assignment, channel, command, and delivery records may be introduced solely as durable contract records; later phases are their only permitted runtime producers and consumers.

The Phase 2 schema includes independent canonical records for `portfolio_work_items`, ActionIntents, command intents and observed dispatch receipts, Completion Candidates, `portfolio_facts`, and scoped idempotency operation records, in addition to the records enumerated for this change. A command intent records an intended side effect before any external call; an observed dispatch receipt records verified execution evidence and is never inferred from a session row, tmux existence, or browser connection. A Completion Candidate is distinct from an Acceptance Decision and cannot complete a Work Item by itself.

Every project-scoped Portfolio child stores `user_id` and `project_id`. Where it relates to a project, its foreign key is the composite `(user_id, project_id)` reference to the project parent, whose `(user_id, id)` pair has a unique parent key; the same tenant-and-project composite rule applies to Portfolio parent/child links where both columns define their scope. This prevents a child row from joining a project owned by another tenant even if opaque identifiers are guessed.

Every mutable Portfolio projection has a monotonically increasing `projection_version`. State Gate mutations must require an expected projection version and compare-and-swap it. `portfolio_operation_records` scopes a client idempotency key by `(user_id, operation, idempotency_key)`, stores the canonical payload digest and replay result, and rejects a replay whose key and operation match but payload digest differs. For one accepted mutation, a single database transaction performs projection CAS, appends the immutable `portfolio_facts` entry, and writes any command or outbox intent; no partial projection/fact/intent result is valid. Phase 2 may persist that intent but must not execute or deliver it.

### 3. State transitions are evidence-gated and explicit

The Gateway State Gate owns all lifecycle transitions. A route, scheduler, connector, CLI event handler, model output, or Web component can request a command; it cannot write a state directly. Each accepted transition creates an immutable ledger/audit fact and emits a safe projection event.

| Record | States | Key invariant |
| --- | --- | --- |
| Portfolio Request | `received`, `triaged`, `needs_owner_decision`, `accepted`, `declined`, `cancelled` | Original request text, source, requester, and timestamp never change. |
| Work Item | `todo`, `in_progress`, `blocked`, `ready_for_review`, `done`, `cancelled` | `in_progress` needs an observed dispatch; `blocked` needs blocker evidence; `done` needs Acceptance Decision. |
| Task Attempt | `prepared`, `awaiting_authorization`, `dispatching`, `running`, `awaiting_permission`, `evaluating`, `succeeded`, `blocked`, `failed`, `cancelled` | Identity, Task Packet digest, source Work Item version, and `tracking` are immutable after creation. `tracking` defaults to `false`; only `tracking=true` permits Workflow Wakeup creation. |
| Execution Authorization | `proposed`, `preauthorized`, `awaiting_owner`, `approved`, `rejected`, `expired`, `consumed`, `cancelled` | Every usable grant is bound to one canonical action digest and expiry. |
| Workflow Wakeup | `scheduled`, `claimed`, `completed`, `retry_scheduled`, `cancelled`, `exhausted` | A single durable claim lease owns one reconciliation attempt. |
| Acceptance Decision | `candidate`, `accepted`, `rejected`, `superseded` | A `done` Work Item references an accepted decision. |

Allowed Work Item transitions are deliberately narrow:

| From | To | Required fact |
| --- | --- | --- |
| `todo` | `in_progress` | one Task Attempt has an observed, lease-valid dispatch receipt |
| `todo` | `cancelled` | owner cancellation decision |
| `in_progress` | `blocked` | attributable blocker Evidence |
| `in_progress` | `ready_for_review` | Completion Candidate plus all required verification Evidence |
| `blocked` | `in_progress` | owner or authorised resume decision and a new/recovered observed dispatch |
| `ready_for_review` | `done` | accepted Acceptance Decision or owner confirmation where policy requires it |
| `ready_for_review` | `in_progress` | rejected review creates or selects a further Task Attempt |
| `in_progress`, `blocked`, `ready_for_review` | `cancelled` | owner cancellation decision |

`done` and `cancelled` are terminal in V1. Reopening is a future explicit product operation, not an implicit status mutation.

### 4. Governed execution uses deterministic packets, leases, and three authorization tiers

A Task Attempt is prepared from a canonical Work Item version. A Task Packet is deterministically rebuilt from the project dossier, work-item title and description, acceptance criteria, declared verification requirements, permitted adapter, and selected Skill version. The Gateway stores a version reference and digest rather than terminal transcript content.

Dispatch is a separate action from prepare. Dispatch first acquires a transactionally unique session-assignment lease, verifies adapter availability and session readiness, evaluates authorization, writes an idempotent command record, then asks an adapter/service boundary to start or reuse the Code CLI session and submit the canonical packet exactly once.

**Phase 4 completion boundary:** the first adapter integration is conditional Claude `SessionStart` worker support. A fixed, authenticated readiness-forwarder MUST use a distinct per-command, per-lease-generation worker ACK capability derived by server HMAC and bound to the dispatch command, Task Attempt, session, assignment lease generation, and Task Packet digest. The Gateway persists only that capability's digest. The raw capability MUST never be returned through a connect API, browser terminal attach protocol or WebSocket, or generic hook settings; a valid terminal attach token alone cannot acknowledge readiness. The default runtime state is `unverified_no_input`: Phase 4 must not send real CLI or tmux input. Phase 4 tests MUST use mocked/database integration and MUST perform zero real CLI/tmux input. Only Task 8.2 may provide real Claude/tmux evidence or enable a verified input runtime. A readiness ACK consumes the capability once and proves only that the fixed forwarder accepted the exact binding; it is not a dispatch receipt. Only after that ACK may the valid worker capability submit the one canonical packet, after which the system records a distinct observed dispatch receipt.

**Prepare-dispatch transaction:** `prepareDispatch` performs one database transaction containing source/packet/lease compare-and-swap, the canonical server-created ActionIntent, authorization decision and consumption, idempotent command intent, expected worker signal (including only the ACK-capability digest and binding), Task Attempt transition to `dispatching`, and immutable facts. Worker, CLI, or tmux input occurs strictly after that transaction commits. A crash or timeout after commit but before the distinct receipt is an unknown outcome for reconciliation; recovery MUST NOT blindly resend the packet.

**Active-assignment writer fence:** while a session has an active Portfolio assignment, browser-originated raw terminal input and any direct or non-worker `sendInput` call are rejected. The sole permitted writer is a valid worker capability that validates the tenant, project, attempt, session, current assignment lease generation, packet digest, and authorization binding; an expired, replaced, or otherwise invalid capability cannot write input.

Authorization is evaluated against a canonical `ActionIntent` containing `userId`, `projectId`, `workItemId`, `attemptId`, `sessionId` when applicable, action class, resource scope, packet/payload digest, assignment lease token, policy rule, issued time, and expiry.

| Tier | Result | Examples |
| --- | --- | --- |
| Preauthorization | Gateway consumes an unexpired matching policy grant and may execute | declared read-only observations; explicitly preauthorized low-risk, reversible project actions |
| Manager recommendation + owner confirmation | manager produces a structured recommendation; the owner confirms the stored ActionIntent | an unmatched ordinary dispatch, follow-up, or recoverable session action |
| Protected Action | owner confirmation is always required; no policy or Skill can elevate it | delete, secret access/change, privilege expansion, external publication, cross-project action, arbitrary shell/terminal input |

The manager never writes terminal text directly. Platform Tools expose schema-bound semantic operations; Skills are versioned playbooks that select and sequence an already-authorized subset. A Skill cannot add tools or widen authorization.

### 5. Observation produces facts and Risk Signals, not verdicts by itself

Only an explicitly enrolled Portfolio Project with an active Observation Profile is observable. Phase 5 V1 has a closed observation allowlist: `platform_lifecycle_v1` and `git_state_v1`. Every enabled probe MUST have `rootRef=project_root` and `argumentsJson={}`; any other source, root reference, or arguments are rejected. The project root is resolved and revalidated with the approved path guard on every collection run; a previously stored or previously validated path is not sufficient.

`platform_lifecycle_v1` reads only the tenant-scoped, persisted Portfolio database snapshot. It spawns no process and is reconciler-driven rather than a generic hook or event trigger: Phase 5 has no stable producer-event identity contract to consume. `git_state_v1` is the sole non-platform probe. It uses one server-owned, non-shell Git recipe, `git -C <revalidated-project-root> status --porcelain=v1 --branch`; the recipe, executable, arguments, and working root are not stored as mutable command text and cannot be supplied by a model, Skill, connector, or client. No later test/build/CI probe is included in V1.

Both V1 probes have a fixed 5-second timeout, a combined ephemeral stdout/stderr capture cap of 16 KiB, and a persisted redacted summary cap of 1,024 characters. Raw captured output is discarded after bounded redaction/digest derivation and is never persisted in Evidence, facts, reconciliation runs, logs, or projections. The lifecycle freshness window is 5 minutes; the Git freshness window is 15 minutes. No model-generated or raw shell command is permitted.

Every Evidence record carries its producer, source category, project/attempt scope, observation time, collection time, digest, redacted summary, confidence, and freshness. The Project Dossier has two distinct read semantics. Its display projection retains the latest source status as exactly `fresh`, `stale`, `unknown`, `timeout`, or `failed`, including a timeout or failure after its collection completes. Its current-fact read returns only Evidence designated `current`: Evidence still `fresh` within that source's fixed window. Intake, Task Packet construction, and Acceptance Decision current-fact gates MUST use the current-fact read; a Dossier display row that is stale, unknown, timeout, or failed cannot satisfy those gates. A Risk Signal can request a tracking-eligible Workflow Wakeup or a manager recommendation; it cannot call the State Gate or change a Work Item or Acceptance Decision lifecycle.

### 6. Durable scheduling separates global reconciliation from tracked-work follow-up

Each Task Attempt persists immutable `tracking`, defaulting to `false`; only an attempt created with `tracking=true` may create or coalesce a Workflow Wakeup. The scheduler persists schedule intent and uses a single durable Reconciliation Run ledger shared by Workflow Wakeups and Heartbeats. Each ledger row records its source, source record identity, idempotency slot, state, claim-token digest and 60-second lease, attempt count and budget, plus only a safe result digest or stable error code. It never stores raw observation output. Claim and completion/retry transitions use compare-and-swap so one active claim owns one reconciliation effect.

The reconciler ticks every 15 seconds and atomically claims at most 20 due items per batch. A Workflow Wakeup permits at most 3 retries, therefore at most 4 total claims. Its retry backoff is fixed at 60 seconds, 300 seconds, then 1,800 seconds; the fourth failed claim becomes `exhausted` with a stable error. On restart, recovery records an uncertain active claim as an `unknown` run before any further work. From that unknown state it may schedule only a new fixed read-only V1 observation; it MUST NOT replay or schedule dispatch, terminal input, model work, Feishu ingress/card action, or delivery.

The Portfolio Heartbeat is a per-user optional recurring reconciliation setting, default disabled. When enabled, its cadence is an integer from 5 through 1,440 minutes inclusive; when disabled it materializes no recurring run. Heartbeats share the Reconciliation Run ledger, claim rules, and fixed read-only observations with Workflow Wakeups. A no-change heartbeat makes no model call, creates no notification, and records only bounded operational metadata when needed. Phase 5 includes no model runtime at all, whether state changed or not. A tracking-enabled Workflow Wakeup remains independent of global Heartbeat status.

Phase 5 platform lifecycle collection is reconciler/persisted-state based only. It does not add a generic hook/event trigger or producer-event identity contract, and it does not include Phase 6 Event Bus, HTTP API, WebSocket, or Web work.

This takes the durable job and task-flow discipline from OpenClaw and the lifecycle/ownership emphasis from Hermes Agent, while refusing degraded concurrent claims for Code CLI dispatch.

### 7. Feishu is a bound Channel Connector and a projection, never a control bypass

The Feishu connector separates signed ingress validation, external identity binding, allowed-conversation validation, canonical request capture, signed one-use Channel Action resolution, and durable Outbox delivery. Free-form text may create a Portfolio Request only. It may not supply a session identifier, terminal command, action payload, or approval decision.

An approval/update card references an opaque, signed, single-use action identifier. On action receipt, the Gateway loads the stored canonical record and verifies the signature, binding, tenant, allowed conversation, expiry, and unused state before recording an owner decision. Outbox deliveries are deduplicated by canonical event and target; retries never duplicate a state transition.

**Phase 7 account, binding, and transport boundary:** Phase 7 adds an append-only forward migration for a verified provider-account registry and Portfolio channel bindings. The registry stores the verified provider name, immutable provider account identifier/app identity, owning tenant, lifecycle state, and audit-safe metadata. It enforces a global `UNIQUE (provider, provider_account_id)` owner, so one real Feishu app/account cannot be claimed by more than one tenant. A Portfolio binding references that verified registry row and has one active tenant identity/conversation tuple; it enforces uniqueness for the active `(provider_account_id, external_identity, conversation_id)` tuple. A missing registry account, an account whose owner tenant differs from the candidate binding, or zero/multiple active binding matches is rejected before a handler is selected. The migration is a new forward append in the live journal; it MUST NOT edit applied Portfolio or legacy migrations.

One Gateway-owned Feishu transport registry/selector owns both the configured account's WebSocket/long-connection lifecycle and webhook ingress callback path. It validates and normalizes a provider event, verifies exactly one provider-account registry entry, then resolves exactly one eligible handler for that account and event: legacy **or** Portfolio, never both. The selected Portfolio handler additionally requires exactly one active tenant-scoped binding for the verified account, identity, and allowed conversation. Any account collision, missing/ambiguous account, binding collision, missing binding, disabled state, or cross-tenant mismatch fails closed before a Portfolio workflow mutation or delivery is created. Portfolio is an isolated handler behind this selector; it MUST NOT start a second Feishu application connection, register a competing ingress callback, or cause a legacy Copilot handler and Portfolio handler to process or deliver the same event. The shared transport may remain alive for legacy behavior before Cutover, but it cannot dual-deliver a Portfolio event or treat legacy state as Portfolio input.

### 8. The public contract is domain-oriented and safe to project

All new HTTP operations live below `/api/v1/portfolio/**` and return ForgeBadger's `{ code, data, message }` envelope. Mutations require a server-validated request body and an idempotency key except where a verified external event supplies a stable provider event identity.

The existing event WebSocket stays transport-only. Portfolio events contain IDs, safe state, bounded summaries, timestamps, and correlation IDs; raw provider content, credentials, unredacted terminal output, and signed action material are excluded.

**Phase 6 dependency boundary:** the Portfolio HTTP routes, event projections, WebSocket publisher, and Web query/mutation clients receive only a restricted Portfolio API/read/event facade. That facade can validate/authorize the caller, invoke the State Gate through its public request operations, retrieve safe DTOs, and publish/subscribe to redacted projection events. It MUST NOT expose or receive `PortfolioExecutionRuntime`, worker ACK/capability material, a worker dispatch port, `SessionManager` terminal writers, `sendInput`, tmux, node-pty, or any other terminal-write capability. Runtime construction and capability ownership remain Gateway-internal execution concerns; route/WebSocket/Web code cannot acquire them transitively through a broad dependency container.

### 9. Clean Cutover is one release boundary, not a gradual compatibility layer

Development creates Portfolio Operations in isolated modules and routes. Until Cutover, old and new systems do not co-own a workflow record and no automatic migration copies legacy Copilot state into the new domain. Before Cutover, an independently approved backup/export of legacy Copilot data is created and restore-tested outside Portfolio Operations.

**Web presentation boundary:** `/portfolio` is the complete primary Portfolio workspace. `/copilot` remains as a bookmark-compatible Portfolio-only alias. The pet opens a floating Portfolio-only companion Dialog; submitted text is untrusted requirement text that creates a Portfolio Request, and timely acknowledgement/progress is derived only from the persisted Request's safe status. The alias and Dialog consume only Portfolio clients, i18n, state, and redacted projections; they are not a legacy model-chat surface and do not preserve or reintroduce a Copilot API route, provider/runtime loop, record reader, Feishu handler, compatibility adapter, fallback read, or dual write. They cannot receive execution runtime, worker capabilities, or terminal-write authority; their feedback must exclude credentials, raw provider/terminal content, signed action material, and cross-tenant data.

At Cutover, navigation and API clients point to Portfolio Operations, `/api/v1/copilot/**` is unmounted, and the legacy Copilot services, provider/conversation Web clients, tests, events, and types are removed in a reviewed deletion batch. The Portfolio-owned alias and pet-triggered floating companion Dialog are deliberately retained. Historical Copilot tables, already-applied migrations, and data remain physically retained but unreachable at runtime; they are used only by the separately authorized backup/export and disposable restore procedure and are never imported into Portfolio. If rollback is necessary, the release is rolled back with its verified backup; runtime compatibility is not introduced.

## Risks / Trade-offs

- [The existing Project Manager work-item schema cannot enforce all new invariants] → audit it before reuse; introduce a new authoritative Portfolio projection if necessary instead of weakening State Gate rules.
- [A Gateway crash occurs after dispatch reaches a CLI but before durable receipt] → write an idempotent command intent before the external call; recovery observes session/adapter state before retrying and otherwise blocks for owner review.
- [Events arrive duplicated or out of order] → deduplicate by producer event identity, current projection version, command idempotency key, and assignment lease; all handlers reconcile against canonical state.
- [Heartbeat or wakeups create cost/noise] → default Heartbeat off; use per-attempt budgets, due-time coalescing, no-change suppression, backoff, and bounded Outbox delivery.
- [Prompt injection tries to widen tools or permissions] → server-created ActionIntent, fixed protected-action classification, Platform Tool schemas, no raw shell, and all authority checks after model output.
- [Feishu action is forged, replayed, or taken in an unapproved chat] → signed one-use opaque IDs, identity/conversation binding, expiry, durable consume-once transition, and audit evidence.
- [A second Feishu client or overlapping binding handler duplicates an inbound event or delivery] → a globally unique verified provider-account registry, one Gateway transport registry/selector for both WebSocket and webhook ingress, fail-closed unique active binding resolution, one selected handler, and one Outbox claim per canonical target/version.
- [A Phase 6 route or WebSocket publisher reaches execution authority] → inject only a narrow Portfolio API/read/event facade; keep `PortfolioExecutionRuntime`, worker capabilities, and every terminal writer outside the facade and route dependency graph.
- [Clean removal loses useful historic data] → separate backup/export and restore proof; never silently migrate historic assertions as fresh Evidence.

## Migration Plan

1. Freeze this change's specs, field contracts, state tables, and legacy inventory before code changes.
2. Implement new Portfolio persistence and State Gate in isolated Gateway modules with repository, transition, tenant-isolation, and idempotency tests.
3. Integrate Project Manager board records only through a verified invariant mapping. Route all new workflow writes through Portfolio services.
4. Add dispatcher, authorization, observation, scheduler, and safe event projection; validate restart, duplicate, lease, and no-terminal-transcript invariants.
5. Add the isolated `/portfolio` workspace and native Feishu handler behind the one shared transport multiplexer; make `/portfolio` primary, retain `/copilot` as its Portfolio-only alias, and retain the pet-triggered floating Dialog strictly as Portfolio presentation with no legacy runtime or data dependency.
6. Execute end-to-end acceptance against a disposable database and safe real CLI evidence. Verify a legacy backup can be restored without loading it into Portfolio Operations.
7. Run a reviewed Clean Cutover that unmounts legacy Copilot Gateway logic and removes its complete runtime inventory while retaining the explicit Portfolio presentation exceptions; then run full typecheck, build, targeted tests, E2E, and legacy-reference scans.

**Rollback:** before Cutover, discard the isolated new implementation. After Cutover, restore the prior release and its verified legacy backup as one operational rollback. Do not merge two state models or introduce a fallback reader.

## Open Questions

- No product decision blocks the core design. Before Cutover, the release owner must choose the storage location and retention period for the separately approved legacy backup/export.
- The first adapter with full structured lifecycle evidence will be selected during implementation from the current adapter capability inventory. Any adapter without reliable readiness, permission, and completion evidence remains unable to trigger automatic completion.
- Phase 6/7 implementation may proceed before Cutover under the coexistence and single-transport boundaries above. Fresh runtime tests, browser E2E, Feishu connection smoke, and pass/fail evidence are intentionally deferred to one later integrated verification gate; this decision does not mark any Phase 6 or 7 task complete.
