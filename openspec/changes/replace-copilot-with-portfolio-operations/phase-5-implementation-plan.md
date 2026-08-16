# Phase 5 Implementation Plan — Observation and Reconciliation

> Gate 1 remediation plan. This is an implementation contract, not implementation evidence: Tasks 5.1–5.7 remain unchecked and no runtime, API, Event Bus, Web, Feishu, or model behavior is introduced by this document.

## 1. Forward persistence migration and ownership

Phase 5 MUST add the new forward migration `packages/gateway/src/db/migrations/0035_portfolio_observation_scheduler.sql`. It MUST NOT rewrite already-applied `0032_portfolio_operations_foundation.sql` or `0033_portfolio_execution_fence.sql`. The implementation owner also updates the matching Drizzle migration journal (`packages/gateway/src/db/migrations/meta/_journal.json`) and `packages/gateway/src/db/schema.ts` in the same change. The journal and SQL migration are the forward-migration source of truth; the ignored Drizzle snapshot is neither generated nor committed for this change.

**Preservation and ordering:** `0034_remove_agents.sql` is an existing unrelated untracked/user change and the journal already owns it at `idx: 33`, tag `0034_remove_agents`. Phase 5 MUST NOT modify, rename, replace, or reassign that file or entry. It owns the next append only: journal `idx: 34`, tag `0035_portfolio_observation_scheduler`, paired only with `0035_portfolio_observation_scheduler.sql`. No generated snapshot is required, generated, or committed. This preserves the established forward order and prevents a duplicate ordinal or journal tag.

### 1.1 Immutable Attempt tracking

The migration adds `portfolio_task_attempts.tracking_enabled INTEGER NOT NULL DEFAULT 0`. Existing attempts therefore read as `false`; new attempts default to `false`. A database-level update guard rejects a change to `tracking_enabled` after insert, and `PortfolioRepository` exposes it only on Task Attempt creation. The request/service DTOs and repository update methods MUST NOT offer a later enable/disable operation. Only an Attempt created with `tracking_enabled=true` may create or coalesce a Workflow Wakeup.

### 1.2 Shared durable reconciliation ledger

The migration adds `portfolio_reconciliation_runs`, owned by a dedicated scheduler repository. Its minimum durable fields and constraints are:

| Field | Contract |
| --- | --- |
| `id`, `user_id` | Opaque primary key; tenant owner. `user_id` FK references `users(id)`. |
| `source` | Non-null closed enum/check: `wakeup` or `heartbeat`. |
| `source_record_id` | Non-null opaque source identity; never inferred from an event payload. |
| `idempotency_slot` | Non-null deterministic slot for the source reconciliation attempt. |
| `state`, `projection_version` | Non-null state (`scheduled`, `claimed`, `completed`, `retry_scheduled`, `exhausted`, `cancelled`, or `unknown`) and monotonic CAS version. |
| `claim_token_digest`, `claim_lease_expires_at` | Digest only, never the raw claim token; a claimed row has a 60-second lease. |
| `attempt_count`, `retry_budget` | Non-null total claim count and retry budget. Wakeups use `retry_budget=3`, so they permit at most four total claims. |
| `result_digest`, `error_code`, `error_digest` | Only a safe result digest and stable error code/digest. No raw probe output, terminal text, model text, or delivery response is stored. |
| `wakeup_id`, `heartbeat_user_id` | Nullable typed source references used solely to enforce the source-record foreign keys below. |
| timestamps | Creation, update, claim, and completion timestamps for recovery and audit. |

The ledger MUST have `UNIQUE (user_id, source, source_record_id, idempotency_slot)` and an index on `(user_id, state, claim_lease_expires_at)` for lease recovery. It MUST also retain the source schedules' due-time indexes; the run ledger is claim authority, not a substitute for Wakeup due-time state.

The migration adds `UNIQUE (user_id, id)` to `portfolio_workflow_wakeups` so the ledger can have `FOREIGN KEY (user_id, wakeup_id) REFERENCES portfolio_workflow_wakeups(user_id, id)`. `heartbeat_user_id` has `FOREIGN KEY (heartbeat_user_id) REFERENCES portfolio_heartbeat_settings(user_id)`. A row-level check binds the polymorphic shape without trusting application code:

- for `source='wakeup'`, `wakeup_id` is non-null, `source_record_id=wakeup_id`, and `heartbeat_user_id` is null;
- for `source='heartbeat'`, `heartbeat_user_id=user_id`, `source_record_id=heartbeat_user_id`, and `wakeup_id` is null.

Those are the only source-reference forms. The repository validates the matching tenant/source record in the same transaction before insert because SQLite cannot express one polymorphic foreign key directly.

`portfolio_workflow_wakeups.claim_token` is legacy/obsolete after this migration. The Phase 5 runtime MUST leave it null, MUST NOT read it, and MUST NOT return it in any DTO or projection. Claim authority, token-digest comparison, lease expiry, and recovery all live exclusively in `portfolio_reconciliation_runs`.

### 1.3 Wakeup state, coalescing, and transaction rules

Wakeup state remains `scheduled → claimed → completed`, `claimed → retry_scheduled → claimed`, or a terminal `cancelled`/`exhausted` state. A failed first, second, or third claim gets the fixed retry delays 60 seconds, 300 seconds, and 1,800 seconds respectively. A fourth failed claim changes both the Wakeup and its run to `exhausted` with a stable error; no automatic retry is created.

Only a compatible non-terminal `scheduled` or `retry_scheduled` Wakeup may coalesce: same tenant, Attempt, reason class, and coalescing key. Coalescing retains the existing budget/count, takes the earlier due time, and reuses the existing source record rather than creating a new concurrent active Wakeup. A `claimed`, `completed`, `cancelled`, or `exhausted` Wakeup never accepts a coalescing write.

The scheduler repository defines these transaction boundaries:

1. **Schedule/coalesce:** validate `tracking_enabled=true`; insert or CAS-update the Wakeup and create/read its ledger source slot atomically. A false-tracking Attempt leaves no Wakeup or run row.
2. **Due claim:** select at most 20 due source records; in one transaction per record, CAS the ledger from claimable state to `claimed`, increment the count, write only a new token digest and 60-second expiry, and update the Wakeup projection to `claimed`. A lost CAS performs no probe.
3. **Result:** in one transaction, persist bounded Evidence and any advisory Risk Signal, append the safe reconciliation result, and transition the ledger plus Wakeup to `completed`, `retry_scheduled`, or `exhausted`. This operation never invokes the State Gate.
4. **Recovery:** on startup, first persist an `unknown` ledger run/transition for every expired or interrupted claim. A later transaction may schedule a new fixed read-only observation only; it cannot recover by dispatching, terminal input, model work, Feishu work, or delivery.

## 2. Dossier evidence reads

`PortfolioRepository` owns two explicit Dossier methods:

- `getDossierDisplay(...)` always projects the latest Evidence for each V1 source and preserves the explicit display status `fresh`, `stale`, `unknown`, `timeout`, or `failed`.
- `getCurrentDossier(...)` is the sole current-fact admission method. At query/run time it computes currentness from `observed_at + source window` using the injected Clock: 5 minutes for `platform_lifecycle_v1` and 15 minutes for `git_state_v1`. It does not accept caller-supplied freshness text as authority.

`intake-service.ts`, `task-packet-service.ts`, and the new Phase 5 `acceptance-service.ts` integration MUST replace any direct Evidence/Dossier freshness checks with `getCurrentDossier(...)`. Only Evidence returned by that method is `current` and may meet Intake, Task Packet, or Acceptance Decision current-fact gates. Every other status remains displayable through `getDossierDisplay(...)` but is insufficient for those gates.

## 3. Fixed probe contract and safe execution

`observation-contract.ts` validates the closed V1 tuple: exactly `platform_lifecycle_v1` or `git_state_v1`, `rootRef='project_root'`, and `argumentsJson={}`. It rejects any mutable executable, argv, working-directory override, model suggestion, Skill selection, connector payload, or caller-supplied command text.

`observation-service.ts` calls `validateProjectRoot` on every collection, before either source is read. It does not cache a prior realpath. `platform_lifecycle_v1` receives only a tenant-scoped persisted-state reader and spawns no process. `git-state-probe.ts` receives a fixed-argv, non-shell executor and may invoke only:

```text
git -C <revalidated-project-root> status --porcelain=v1 --branch
```

The executor enforces one 5-second abortable timeout and a **combined** stdout/stderr cap of 16 KiB. A cap breach, timeout, abort, denied root, symlink escape, or project-path replacement produces explicit bounded failure Evidence; it persists no partial raw capture. Redaction and digest derivation occur before a summary of at most 1,024 characters is persisted, and raw capture is discarded.

## 4. Phase 5 component ownership and dependency boundary

| Area | Owned implementation target |
| --- | --- |
| Schema and migration metadata | `src/db/schema.ts`, `src/db/migrations/0035_portfolio_observation_scheduler.sql`, and the matching migration journal entry (`idx: 34`, tag `0035_portfolio_observation_scheduler`). The SQL migration and journal are authoritative; do not generate or commit an ignored Drizzle snapshot. |
| Portfolio data and Dossier reads | `src/db/repositories/portfolio-repository.ts`: Attempt creation tracking value, Evidence/Risk persistence, `getDossierDisplay`, and `getCurrentDossier`. |
| Scheduler persistence | New `src/db/repositories/portfolio-scheduler-repository.ts`: Wakeup/Heartbeat source lookup, ledger creation, CAS claim/result/recovery, leases, retry budget, and coalescing. |
| Observation contracts and collection | New `src/services/portfolio/observation-contract.ts`, `git-state-probe.ts`, and `observation-service.ts`. |
| Advisory risk and reconciliation | New `src/services/portfolio/risk-signal-service.ts` and `reconciliation-service.ts`; their interfaces intentionally have no State Gate dependency. |
| Runtime lifecycle | New `src/services/portfolio/operations-runtime.ts`, wired only by `src/services/startup.ts`, `src/runtime/start-gateway.ts`, and `src/server.ts`. |

`OperationsRuntime` is separately injectable and exposes `start`, `stop`, and `recover`. Startup constructs and starts it only after database and session recovery. Its constructor receives only Clock/Timer, Portfolio/scheduler repository factories, and fixed read-only probe ports. It MUST NOT receive `StateGate`, a worker, `SessionManager`, adapter, `EventBus`, Feishu connector, model/Copilot service, dispatch port, terminal/tmux port, or delivery/Outbox port. Server close aborts/stops `OperationsRuntime` before it closes the Gateway/server resources, so no new claim or probe can outlive shutdown.

**Trusted internal profile activation:** startup is the only production provisioner. After session recovery and before `OperationsRuntime.start`, it selects only active `portfolio_projects` enrollments joined to their tenant-scoped `projects.path`. `ApprovedProjectRootValidator` must validate that project-owned path, reject symlinks/denied roots, and derive the canonical path plus device/inode identity. Only that internal result may call `PortfolioRepository.activateObservationProfile(...)`, using a root-identity-derived idempotency key. Activation upserts an `active` profile and only the two fixed enabled V1 probes (`platform_lifecycle_v1` and `git_state_v1`) with the closed `project_root`/`{}` contract; no HTTP DTO, model, Skill, connector, or client may select a root, executable, probe, or arguments. A validation failure is recorded only as a skipped provisioning row for that startup pass and performs no profile/probe upsert.

Phase 5 explicitly excludes routes, API DTOs, Event Bus/WebSocket projection, Web, Feishu/Outbox, dispatch, `SessionManager`, tmux, worker/adapter, model/Copilot, and legacy Copilot changes.

## 5. Required tests and acceptance evidence

Phase 5 acceptance cites the existing aggregate Gateway tests below. Their observation, reconciliation, and runtime paths use fake Clock/root-validator/Git-probe seams; the `NodeFixedGitExecutor` unit case rejects a noncanonical argv before any process spawn. No listed Phase 5 proof executes real Git, CLI, tmux, adapter, worker, model, Feishu, or delivery code.

| Test file | Required proof |
| --- | --- |
| `test/portfolio-observation-service.test.ts` | Closed V1 source/root/argument tuple; fixed non-shell Git argv; per-run canonical root/device/inode validation; inactive/denied/symlink/replaced-root failures; timeout/abort; combined 16 KiB capture cap; no partial raw capture; redaction/1,024-character summary cap; and the 5-minute/15-minute freshness constants. |
| `test/portfolio-reconciliation.test.ts` | Trusted fixed-profile activation; immutable creation-time tracking; Wakeup/ledger source and idempotency constraints; 60-second exclusive claims; compatible coalescing; 20-item claim cap; unknown-first recovery; fixed retry/backoff/exhaustion; atomic Evidence/Risk/fact/run finalization; display-versus-current Dossier reads; and disabled/cadence-bounded Heartbeat behavior. Its reconciliation cases assert no Work Item lifecycle mutation, command, or delivery effect. |
| `test/portfolio-operations-runtime.test.ts` | Fake timer/probe runtime coverage for the 15-second loop, cross-tenant 20-claim cap, replacement-root durable Evidence/Risk, stop-aborts-and-awaits-active-probe behavior, and Heartbeat no-command/no-delivery boundaries. Its `createGatewayRuntime` lifecycle case uses fake tmux and an injected fake `OperationsRuntime` factory to assert the recovery → profile-provisioning → runtime start sequence and runtime stop before database close. |
| `test/portfolio-repository.test.ts` and `test/portfolio-state-gate.test.ts` | Relevant Portfolio regression coverage for tenant-scoped foreign keys/non-disclosure, Dossier CAS and idempotency/atomic rollback, State Gate transition closure, owner authorization, and trusted fresh attempt-scoped acceptance evidence. These regressions do not expand Phase 5 into API, event, terminal, model, Feishu, or delivery behavior. |

The evidence gate for Tasks 5.1–5.7 requires the named tests plus the existing relevant repository/typecheck validation. Passing tests must not be described as enabling Phase 6 or any excluded runtime behavior.
