# OpenForge Portfolio Operations Clean-Break Rebuild Plan

## 1. Understanding the requirement

### Goal

Replace OpenForge's generic chat Copilot with a **Portfolio Operations Manager**: one durable, tenant-scoped controller that coordinates all explicitly enrolled projects, turns user requirements into traceable work, governs Code CLI sessions and permissions, monitors evidence, and sends controlled updates through Web and Feishu.

### Accepted product decisions

1. The manager uses three-tier execution authorization: preauthorization, manager recommendation plus owner confirmation, and always-owner-confirmed protected actions.
2. Only explicitly enrolled OpenForge projects are in the portfolio. Each has a Project Dossier and evidence-backed Observed State.
3. Global Portfolio Heartbeat is disabled by default and configurable by the user. It combines event ingestion with periodic reconciliation; model reasoning is not invoked on every tick.
4. A Work Item explicitly delegated for tracking owns Workflow Wakeups even when the global Heartbeat is disabled. “No tracking” creates no wakeups.
5. Platform Tools are server-owned and schema-bound. Skills are versioned playbooks over an already-authorized tool subset and cannot create privileges. MCP is out of scope for V1.
6. Web is the Canonical Record. V1 supports Web plus a native Feishu Channel Connector: bound identities, allowed conversations, signed one-use action cards, and idempotent Outbox delivery. Free-form channel text never becomes terminal input or an approval.
7. Every user request becomes a Portfolio Request. Clear, single-project, in-boundary requests may create a `todo` Work Item; ambiguous or scope-changing requests require an Intake Decision and owner confirmation.
8. Project Observation Profiles collect platform facts and project Git state in V1. Optional test/build/CI Probes are declared, bounded, and evidence-producing; model-created arbitrary shell commands are prohibited.
9. Work Item lifecycle is evidence-driven: `todo` → `in_progress` → `ready_for_review` → `done`; `blocked` requires blocker evidence; `cancelled` is owner-only by default. A Risk Signal never changes lifecycle state by itself.
10. This is a Clean Cutover. Legacy Copilot Gateway logic is discarded rather than migrated or kept in a compatibility layer; `/portfolio` is the complete workspace, `/copilot` is its Portfolio-only alias, and the pet opens a floating Portfolio Dialog that creates Requests and reports persisted safe Request status with no legacy data/runtime dependency.

### Constraints

- Local-first Gateway remains the only owner of CLI processes, tmux sessions, authorization, durable facts, and API behavior.
- Every business record remains tenant-scoped by `user_id`; all action payloads are validated at the Gateway boundary.
- Existing terminal safety remains unchanged: no raw shell/host-exec tool, arbitrary file writing, unapproved terminal input, Codex app-server prompt UI, or autonomous unmanaged development loop.
- Existing uncommitted user changes must not be reverted, folded into this work, or deleted.

## 2. Target architecture

```text
Web / bound Feishu request
  -> Portfolio Request
  -> Intake Decision
  -> Project Manager Work Item
  -> Task Attempt + deterministic Task Packet
  -> Session Assignment lease + Execution Authorization
  -> Code CLI session
  -> platform events / Observation Profile / Workflow Wakeup
  -> Evidence + Risk Signal + Acceptance Decision
  -> Work Item / Development Ledger (canonical state)
  -> Outbox -> Web / Feishu projection
```

### Responsibilities

| Component | Owns | Must not own |
|---|---|---|
| Portfolio Operations Manager | Intake decisions, prioritisation recommendations, workflow wakeup decisions, evidence synthesis, governed dispatch | Raw terminal access, arbitrary shell execution, unbounded memory |
| Project Manager domain | Project goal, Work Item, Development Ledger, acceptance projection | Model chat state |
| Execution control | Task Attempt, session assignment lease, idempotent command record, execution state | Product scope decisions |
| Authorization service | Preauthorization matching, recommendation, owner decision, protected-action denial | Fresh client replacement payloads |
| Observation service | Observation Profile execution, evidence freshness, Risk Signals | Lifecycle verdicts without evidence |
| Channel Connector | Identity binding, ingress validation, action-card verification, Outbox delivery | Canonical state or terminal control |

### Reuse and replacement

**Reuse as platform foundations**

- Gateway authentication, repositories, envelope, audit logs, redaction, `OpenForgeEventBus`, notifications, Event WebSocket, Session Manager, tmux, adapter discovery, and CLI lifecycle hooks.
- Project Manager Work Item / Goal / Development Ledger and its Web page, evolved into the work-flow view.
- Existing task-attempt, session-assignment, command, acceptance-result, and wakeup schema concepts; their currently unconnected service code is a design reference, not a compatibility contract.
- Feishu credentials, tenant binding, outbound delivery and Outbox mechanics; adopt OpenClaw's account/channel/identity/ingress separation as a design reference only.

**Replace completely at cutover**

- `packages/gateway/src/services/copilot/**`
- `packages/gateway/src/routes/copilot.ts` and the `/api/v1/copilot/**` contract
- Legacy Copilot conversations, runs, memories, pending actions, provider tool loop, generic automation implementation, and their Web chat/provider clients; the Portfolio-owned `/copilot` alias and pet-triggered floating companion Dialog are retained presentation components
- Legacy Copilot-specific EventBus events, API types, copy, tests, and database tables after an independently confirmed backup

### Reference-project lessons

- **OpenClaw:** retain the local Gateway control-plane boundary, account-aware channel connector shape, inbound identity pairing/allowlists, and isolated channel sessions. Do not copy its broad dynamic tool or channel surface.
- **Hermes Agent:** retain durable scheduler lifecycle, wake-up discipline, delivery records, and channel/platform registry concepts. Do not introduce its unrestricted gateway behavior.
- **DeepSeek Harness:** retain event-sourced approval, permission-policy, and schedule-change audit semantics; each decision is linked to its request and survives process restarts.

## 3. Clean-break implementation plan

### Gate 1 — target contract and removal inventory

- [ ] Write a Portfolio Operations specification that freezes the domain language in `CONTEXT.md`, HTTP contract, event contract, state machines, authorization matrix, and channel action format. → Validate with OpenSpec strict validation and architecture review.
- [ ] Inventory every Legacy Copilot-owned source file, endpoint, table, event, dependency, UI route, i18n key, test, and background scheduler. Classify each as delete, replace, or retained shared foundation. → Review `rg` inventory against route mounts, schema, and Web imports.
- [ ] Define the exact Clean Cutover release boundary and legacy-data backup/export procedure. Legacy records do not migrate into the new Canonical Record. → Dry-run backup and restore against a copy of the local SQLite database.

### Gate 2 — durable Portfolio Operations core

- [ ] Add tenant-scoped persistence and repositories for Portfolio Requests, Intake Decisions, Project Dossiers, Observation Profiles/Probes, Risk Signals, Execution Authorizations, Workflow Wakeups, and channel actions/deliveries. Reuse existing Project Manager Work Items and execution concepts only where their invariants match. → Repository, migration idempotency, tenant-isolation, and foreign-key tests.
- [ ] Implement the explicit state machines: request intake; Work Item lifecycle; Task Attempt desired versus observed state; authorization lifecycle; wakeup lease/claim/retry; acceptance. All transitions must be compare-and-swap/idempotent and emit durable ledger/audit facts. → Transition-table and duplicate/restart concurrency tests.
- [ ] Implement a bounded Portfolio Operations control loop. It claims due Workflow Wakeups, consumes explicit budgets, reads only declared evidence, creates Risk Signals or recommendations, and never directly treats model prose as a state transition. → Deterministic fake-clock tests covering overdue, duplicate wakeup, restart, and budget exhaustion.

### Gate 3 — governed execution and observation

- [ ] Replace Task Packet “create/reuse a Session record” behavior with dispatch orchestration: build deterministic packet, prepare Attempt, take session-assignment lease, evaluate authorization, start the session only when allowed, then send canonical approved input. → Real/fake tmux integration tests plus duplicate-dispatch and lease-conflict tests.
- [ ] Implement three-tier Code CLI permission policy and recommendation context. Protected actions stay owner-confirmed across Web and Feishu. → Security tests for policy bypass, stale decisions, forged action IDs, cross-tenant session IDs, and duplicate approval.
- [ ] Implement Observation Profiles: platform facts and bounded Git state in V1; declared, time-bounded build/test/CI probes later in the same contract. Capture timestamp, source, digest, exit result, redacted summary, and freshness. → Probe allowlist, timeout, path escape, secret redaction, and Unknown/Stale tests.
- [ ] Generate Forecast checkpoints for tracked Task Attempts and route stale/overdue evidence to Risk Signals. Do not mutate `blocked`/`done` merely because a checkpoint elapsed. → Fake-clock workflow tests.

### Gate 4 — Web and Feishu operations surfaces

- [ ] Make `/portfolio` the complete primary Portfolio Operations workspace while retaining `/copilot` as a Portfolio-only alias and the pet-triggered floating companion Dialog as Portfolio experience: the Dialog submits a Portfolio Request and reports only persisted safe Request status using Portfolio i18n, while the workspace provides the portfolio overview, Request Inbox, Project Dossier, workflow-enhanced Project Manager board, Attempt timeline, evidence, risk, forecast, and authorization queue. → Focused UI/browser verification remains deferred.
- [ ] Add settings for per-user Heartbeat enablement/cadence and per-project Observation Profiles. Global Heartbeat starts disabled. → API and UI validation tests.
- [ ] Rebuild Feishu as the first native Channel Connector: authenticated binding, allowlisted conversation scope, durable inbound Request capture, signed single-use action cards, and Outbox delivery. → Ingress auth, replay, invalid signature, tenant isolation, outbox idempotency, and card-approval tests.
- [ ] Publish an event contract for WebSocket clients that contains only safe portfolio projections. → Event sequencing, reconnection, and redaction tests.

### Gate 5 — clean cutover and removal

- [ ] Run the complete new-system acceptance suite against a disposable database and real local CLI evidence where safe. Required path: Request → Intake → Work Item → Attempt → approved dispatch → evidence → review → acceptance → Feishu/Web update. → Fresh Gateway, Web, E2E, and manual evidence reports.
- [ ] Take and verify the legacy-data backup/export. → Restore test proves the backup is readable without loading it into Portfolio Operations.
- [ ] In one reviewed change, unmount `/api/v1/copilot`, remove all Legacy Copilot Gateway services/runtime/data access, provider clients/tests/types/events, and switch navigation plus documentation to Portfolio Operations. Retain only the Portfolio-owned `/copilot` alias and pet-triggered floating companion Dialog; it creates Portfolio Requests, uses persisted safe Request status and Portfolio i18n, and does not receive legacy data/runtime/model-chat or execution/terminal-write authority. Do not leave adapters, dual writes, fallback reads, or a restored legacy runtime. → `rg` proves the retained presentation has no legacy imports/routes/requests; migrations and full typecheck/build pass.
- [ ] Validate first-user safety posture: disabled Heartbeat by default, no direct free-text channel terminal path, protected actions require owner confirmation, and no legacy data appears in new views. → Playwright and negative security E2E evidence.

## 4. API and event direction

New endpoints should live under `/api/v1/portfolio/**`, use the standard envelope, and be organised around domain records rather than generic chat runs:

- `requests`, `intake-decisions`, `dossiers`, `work-items`, `attempts`, `authorizations`, `observations`, `risk-signals`, `wakeups`, and `channels/feishu`.
- All mutations carry server-validated input and idempotency keys where retried.
- Approval action cards contain an opaque signed action reference only; the Gateway reads the canonical stored action before executing.
- The event stream projects records such as `portfolio_request_created`, `portfolio_attempt_updated`, `portfolio_risk_detected`, and `portfolio_authorization_required`; it never sends secret-bearing raw terminal transcript or credential data.

## 5. Validation matrix

| Area | Required evidence |
|---|---|
| Domain correctness | Repository and transition tests for all lifecycle edges and invalid edges |
| Tenant/security | Cross-tenant, stale/duplicate/replay, path, shell, secret-redaction, and authorization-bypass tests |
| Scheduler resilience | Fake-clock, restart, lease expiry, idempotency, budget, timeout, and no-double-delivery tests |
| CLI integration | Session start/stop, permission wait, canonical input, terminal evidence, and real-tmux test where available |
| Observation | Git read boundaries, declared probe timeout, source timestamp, stale state, and evidence digest tests |
| Channel | Feishu binding/allowlist/action-card/outbox tests; WebSocket safe projection/reconnection tests |
| Web | Request-to-acceptance Playwright path, mobile status view, empty/error/loading states, and visual review |
| Cutover | Full typecheck/build/test summary, legacy inventory reaches zero, backup/restore proof, and documentation contract review |

## 6. Risks and mitigation

| Risk | Mitigation |
|---|---|
| Clean break loses useful legacy data | Take and restore-test a backup/export; do not migrate it into the new state model; cleanup needs a separate explicit approval |
| Two systems write project state during development | New code runs in isolated modules; one cutover removes the old route and writer set; no compatibility adapter or dual write |
| Manager presents inference as fact | Require Evidence and freshness for Observed State; uncertain results are Unknown/Stale; model output is advisory |
| Heartbeats create cost/noise | Default disabled; claim/lease/budgeted wakeups; event coalescing and Outbox dedupe |
| CLI dispatch or approval bypass | Canonical stored command, three-tier authorization, project/session ownership checks, protected-action policy, no free-text channel-to-terminal path |
| Feishu abuse/replay | Tenant identity binding, allowlisted chats, signed single-use actions, idempotent records, audited ingress and delivery |
| Existing worktree changes are harmed | Preserve unrelated changes; inventory provenance before the final removal batch; stage explicit paths only |

## 7. Rollback

Before Clean Cutover, rollback means discarding the isolated new implementation and retaining the unchanged Legacy Copilot.

After Clean Cutover, rollback restores the prior release and its verified legacy-data backup together; it must not merge legacy and Portfolio Operations records. This is an operational rollback, not a runtime compatibility mode.
