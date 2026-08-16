# Gate 3 Zero-Trust Acceptance: Portfolio Persistence and State Gate

**Change:** `replace-copilot-with-portfolio-operations`  
**Acceptance scope:** tasks 2.1–2.7 only  
**Reviewed worktree:** `copilot-dev` after Phase 2 remediation  
**Decision:** **passed**

## Accepted Boundary

The acceptance covers isolated Portfolio persistence and the State Gate only. It does not add a Portfolio API, Web workspace, CLI/tmux/adapter dispatch or terminal input, scheduler/reconciliation runner, Feishu ingress/card/outbox delivery, Legacy Copilot removal, or Cutover behavior. Those remain later-phase work; Legacy Copilot remains active.

## Final Security and Correctness Controls

| Control | Acceptance result |
| --- | --- |
| State Gate authority | Mutation callbacks are runtime-private, preventing untrusted callers from using the protected writer capability. |
| Request facts and projections | Request transitions append and project the authoritative fact, preventing unprojected transitions. |
| Acceptance gate | Required verification evidence and authorized decision authority are enforced before acceptance state advances. |
| Fact and project integrity | `portfolio_facts` are immutable; project deletion follows the Portfolio `RESTRICT` policy. |
| Dossier concurrency | Project Dossier mutation requires expected projection-version CAS. |
| Packet schema contract | Task Packet unique indexes are present and match the contract. |
| Existing Phase 2 controls | Tenant composite foreign keys, one-active assignment lease controls, digest-stable idempotency replay, atomic projection/fact/intent writes, and redacted audit serialization remain covered. |

## Validation Evidence

```text
pnpm --dir packages/gateway test test/portfolio-repository.test.ts test/portfolio-state-gate.test.ts  # 24/24 passed (Repository 14, State Gate 10)
pnpm --dir packages/gateway typecheck                                                               # passed
git diff --check                                                                                     # passed
Gateway migration and SQLite foreign-key smoke                                                       # passed
openspec validate replace-copilot-with-portfolio-operations --strict                                # passed
```

The earlier Gate 3 failure and reopened Phase 2 tasks were resolved by this review. Phase 2 is accepted at 7/7; Phase 3–8 remain unchecked.
