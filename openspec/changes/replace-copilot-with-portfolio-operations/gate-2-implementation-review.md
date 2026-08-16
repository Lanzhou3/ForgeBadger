# Gate 2 Implementation Review: Portfolio Persistence and State Gate

**Change:** `replace-copilot-with-portfolio-operations`  
**Review scope:** tasks 2.1–2.7 only  
**Reviewed worktree:** `copilot-dev` Phase 2 implementation  
**Decision:** **passed**

## Contract Alignment and Scope

Phase 2 implements an isolated Portfolio persistence foundation and State Gate. It introduces canonical Portfolio records, including independent `portfolio_work_items`, rather than using Legacy Copilot or `project_manager_work_items` as authoritative state. The implementation remains persistence-only: no scheduler/reconciliation runner, CLI/tmux/adapter dispatch or terminal input, Feishu ingress/card/outbox delivery, Portfolio API/events/Web behavior, or Legacy Copilot removal is included.

## Reviewed Controls

| Control | Review result |
| --- | --- |
| Tenant scoping | Portfolio records use tenant and project scope with composite foreign-key relationships; test setup enables `PRAGMA foreign_keys = ON` and exercises cross-tenant/cross-project rejection. |
| Idempotency and CAS | Operation records bind `(user_id, operation, idempotency_key)` to a payload digest and stored replay result; mutable projections require expected-version CAS. |
| Atomic audit trail | State Gate commits keep projection CAS, typed immutable fact append, and related intent writes in one transaction; failure does not partially commit. |
| Facts and redaction | `portfolio_facts` are append-only and audit payloads are redacted before storage; facts cannot be updated or deleted through Portfolio repositories. |
| State Gate | The matrix governs Request, Work Item, Task Attempt, Execution Authorization, Workflow Wakeup, and Acceptance Decision transitions, rejecting invalid and terminal edges. |
| Fact-backed lifecycle | Work Item transitions require an observed lease-valid dispatch receipt, blocker Evidence, verified Completion Candidate plus verification Evidence, accepted decision, or owner-only cancellation as applicable. |
| Lease control | Assignment persistence enforces one active lease for an Attempt and for a session; it does not itself schedule or dispatch work. |

## Validation

```text
pnpm --dir packages/gateway test test/portfolio-repository.test.ts test/portfolio-state-gate.test.ts  # 20/20 passed
pnpm --dir packages/gateway typecheck                                                               # passed
git diff --check                                                                                     # passed
openspec validate replace-copilot-with-portfolio-operations --strict                                # passed
```

## Remaining Work

Only Phase 2 is approved by this review. Phase 3–8 remain unchecked: intake/dossier workflow, governed runtime dispatch and authorization, observations/scheduling, Portfolio API/events/Web, native Feishu, and final Legacy Copilot backup/removal/cutover. Legacy Copilot stays active until that later Cutover work has independent acceptance evidence.

## Superseded by Gate 3

This Gate 2 decision is superseded. Gate 3 subsequently failed on validated Phase 2 defects: a writer capability leak, unprojected Request transitions, acceptance evidence/authority bypass, missing Dossier CAS, and schema index drift. Phase 2 tasks 2.1–2.7 are reopened pending remediation and a new Gate 2/Gate 3 review cycle.
