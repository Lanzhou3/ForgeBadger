# Implementation Status Against Portfolio Operations Design

**Snapshot:** `copilot-dev` working tree after source-level Copilot-to-Portfolio cutover and Gate 2 static review
**Compared documents:** `proposal.md`, `design.md`, five capability specs, and `tasks.md`

## Overall Result

Phases 2–4 retain their previously accepted evidence. The working tree now also
contains the source-level Portfolio implementation and Gateway removal batch:
the Legacy Copilot route, runtime, data access, and legacy Feishu handler are
removed. `/portfolio` remains the complete primary workspace and `/copilot` its
Portfolio-only alias. The pet opens a Portfolio-only floating companion Dialog:
submitted text creates a Portfolio Request, and timely acknowledgement/progress
is read from persisted, safe Request status rather than a legacy model-chat
reply. The alias and Dialog use Portfolio clients, projections, and i18n;
neither may access legacy Copilot data/runtime or receive execution or
terminal-write authority. Their feedback excludes credentials, raw provider or
terminal content, signed action material, and cross-tenant data. Portfolio
Operations is the sole source-level API/runtime/data control plane. Gate 2
static implementation review passed with no blocking or high findings.

This is deliberately not a verified runtime or Clean Cutover acceptance. The
default runtime state remains `unverified_no_input`; no real CLI or tmux input
was run for this cutover, and only Task 8.2 may enable verified input after
accepted real Claude/tmux evidence. Historic Copilot database tables,
already-applied migrations, and data remain physically present, but the new
source has no runtime access, fallback read, compatibility adapter, or dual
write to them. They are retained only for the approved Task 8.3 backup/export
and disposable restore procedure, and must never be imported into Portfolio.

## Phase 3 Intake, Dossiers, and Project Manager Workflow

- Portfolio Project enrollment creates an active enrollment and Dossier with the project owner, objective, intended outcome, optional scope, and materially populated Observed State backed by current trusted Evidence. Dossier updates use expected-projection-version CAS and require scoped trusted Evidence when Observed State changes.
- Web-originated request records are immutable, user-scoped, and correlation-ID carrying. The pet-triggered companion Dialog is a Portfolio Request intake surface, not a model-chat surface: it shows prompt acknowledgement and progress only from the persisted Request's safe status. The safe request timeline returns request, Intake Decision, Work Item, and fact metadata while excluding request text, source metadata, idempotency keys, and fact payloads.
- A clear, single-project, in-boundary route with a Dossier and trusted request Evidence records an accepted Intake Decision, routes and accepts the Request through the State Gate, and creates exactly one Portfolio-owned `todo` Work Item. Ambiguous, multi-project, missing-Dossier, or scope-changing routes record an awaiting-owner Intake Decision and move the Request to `needs_owner_decision`; only the Dossier owner may resolve it.
- The Phase 3 workflow uses the independent canonical `portfolio_work_items` projection, not `project_manager_work_items`. Request-to-work-item and request-fact queries provide deterministic traceability without importing or treating Legacy Copilot or Project Manager records as authority.
- The completed test scope covers enrollment and Dossier validation/CAS, immutable requests and safe timelines, clear and owner-decision intake paths, Work Item lifecycle and traceability invariants, idempotent replay and payload-drift rejection, and tenant isolation.

## Phase 4 Governed Task Execution and Authorization

- Deterministic Task Packets record their source version and digest, and immutable Task Attempt preparation rejects packet or source drift.
- Session-assignment leases enforce one active Attempt/session relationship, reject stale generations, and provide renewal and release controls.
- The adapter-facing semantic worker interface defines readiness, dispatch, follow-up, interrupt, permission, completion-candidate, and bounded-observation signals without exposing a raw terminal-input capability.
- The conditional Claude `SessionStart` worker integration uses a fixed authenticated readiness-forwarder. Its per-command, per-lease-generation HMAC worker ACK capability is persisted only as a digest; browser connect, terminal attach/WebSocket, and generic hook settings cannot receive or use it. Unsupported adapters remain explicitly degraded.
- `prepareDispatch` atomically records source/packet/lease CAS, the canonical ActionIntent, authorization decision or consumption, command intent, expected worker signal, `dispatching`, and immutable facts. A valid bound ACK is one-time, and only then can the worker submit one canonical packet and persist a distinct observed dispatch receipt. Unknown outcomes reconcile without blind resend.
- The active-assignment writer fence rejects browser raw terminal input and direct or non-worker `sendInput`; only a capability validated against the tenant, project, Attempt, session, lease generation, packet digest, and authorization binding can write.
- Three-tier Execution Authorization protects sensitive actions; versioned Skills can select only server-owned Platform Tools and cannot widen authority, introduce unknown tools, or carry raw shell text.
- Completion Candidates remain distinct from trusted Evidence, and Acceptance Decisions apply the required evidence threshold.
- Mocked/database integration coverage includes duplicate dispatch, packet drift, lease and approval failures, capability binding and forgery attempts, stale/out-of-order ACKs, writer-fence bypass attempts, receipt-persistence failures, and no-second-write recovery behavior. No test performs real CLI or tmux input.

## Retained Phase 2 Controls

- State Gate mutation callbacks are runtime-private, closing the writer-capability leak.
- Portfolio Request transitions append and project their facts, so state cannot advance as an unprojected ledger-only mutation.
- Acceptance transitions require the required evidence and authorized decision authority.
- `portfolio_facts` remain immutable, and project deletion uses the required `RESTRICT` policy rather than orphaning Portfolio records.
- Project Dossier mutation requires expected-version CAS.
- Task Packet persistence has the required unique indexes; schema indexes now match the Phase 2 contract.
- Tenant composite foreign keys, lease constraints, digest-stable idempotency replay, atomic projection/fact/intent transactions, and redacted audit payloads remain enforced.

## Task Progress

| Task group | Status after source cutover review |
| --- | --- |
| 1. Gate 1 Contract and Cutover Preparation | **6/6 complete** |
| 2. Portfolio Persistence and State Gate | **7/7 complete** |
| 3. Intake, Dossiers, and Project Manager Workflow | **6/6 complete** |
| 4. Governed Task Execution and Authorization | **9/9 complete** |
| 5. Evidence, Observations, and Durable Scheduling | 0/7 complete |
| 6. Portfolio API, Events, and Web Workflow | 0/7 complete |
| 7. Native Feishu Channel Connector | 0/5 complete |
| 8. Acceptance, Clean Cutover, and Removal | **0/7 accepted**; Task 8.4 Gateway removal complete only; Portfolio presentation exceptions retained |

## Current Evidence Boundary

```text
Phase 4 targeted Gateway Portfolio suite (11 suites)                                       # historical 101/101 passed
Phase 4 Gateway typecheck and git diff --check                                              # historical passed
Phase 4 Gate 1, Gate 2, and Gate 3                                                         # historical passed
Current source-cutover Gate 2 static implementation review                                 # passed; no blocking/high finding
Focused Portfolio presentation browser verification, full test/smoke/E2E, real Claude/tmux, backup restore, and integrated acceptance # not run in this pass
openspec validate replace-copilot-with-portfolio-operations --strict                        # run after this documentation update
```

The Phase 2–4 Gate records remain historical evidence. This status records the
new source-cutover state without promoting deferred validation to a pass.

## Required Integrated Acceptance and Rollback

Tasks 8.1, 8.2, 8.3, 8.5, 8.6, and 8.7 remain incomplete. Before calling
Clean Cutover accepted, run the disposable-database Request-to-Acceptance
path; safe real Claude/tmux evidence; the approved legacy backup/export,
checksum, and isolated restore; legacy-reference scans; migration verification;
Gateway/Web tests, typechecks, builds, and relevant authenticated browser E2E;
and Feishu transport/Outbox checks. Then complete Gate 2 and Gate 3 acceptance
with fresh evidence and record operational handoff/commit details.

Rollback is an operational release rollback: restore the prior release and its
verified legacy-data backup together. It is not permission to restore a live
Copilot compatibility route, fallback reader, dual write, or a merge of
historic Copilot records into Portfolio.
