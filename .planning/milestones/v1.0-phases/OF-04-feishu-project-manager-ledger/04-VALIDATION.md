---
phase: 04
slug: feishu-project-manager-ledger
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-20
---

# Phase 04 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Gateway `node:test` through `tsx` |
| **Config file** | `packages/gateway/package.json`, `packages/gateway/tsconfig.json`; no separate node:test config |
| **Quick run command** | `pnpm --dir packages/gateway test test/db-schema.test.ts test/project-manager-repository.test.ts` |
| **Full suite command** | `pnpm --dir packages/gateway test test/db-schema.test.ts test/project-manager-repository.test.ts test/copilot-tools.test.ts test/copilot-routes.test.ts test/diagnostics.test.ts && pnpm --dir packages/gateway typecheck` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run the narrowest changed-area command.
- **After every plan wave:** Run the full suite command.
- **Before `$gsd-verify-work`:** Full suite, `pnpm --dir packages/gateway test test/feishu-integration.test.ts`, and `git diff --check` must be green.
- **Max feedback latency:** 120 seconds for narrow checks; 240 seconds for full wave checks.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 04-01 | 1 | PM-01, PM-02, PM-03 | T-04-01 / T-04-02 / T-04-03 | Ledger contract names exact tables/statuses/event types and excludes Feishu approval or terminal authority. | docs review | `rg -n "project_manager_goals|project_manager_work_items|project_manager_ledger_events|Feishu" .planning/phases/OF-04-feishu-project-manager-ledger/04-01-PLAN.md` | existing | green |
| 04-02-01 | 04-02 | 2 | PM-01 | T-04-01 | Migration and Drizzle schema create tenant-scoped project-manager tables after accepted Feishu bridge safety. | schema | `pnpm --dir packages/gateway test test/db-schema.test.ts test/feishu-integration.test.ts` | existing | green |
| 04-02-02 | 04-02 | 2 | PM-02 | T-04-01 / T-04-04 | Repository filters by `user_id` and `project_id`, appends ledger events atomically, writes audit rows, and rejects done status without evidence or manual reason. | repository | `pnpm --dir packages/gateway test test/project-manager-repository.test.ts` | existing | green |
| 04-02-03 | 04-02 | 2 | PM-02 | T-04-01 / T-04-03 | REST and Copilot read tools expose only tenant-scoped, redacted, bounded project-manager state. | route/tool | `pnpm --dir packages/gateway test test/copilot-tools.test.ts test/copilot-routes.test.ts` | existing | green |
| 04-02-04 | 04-02 | 2 | PM-02, PM-03 | T-04-02 / T-04-03 | Diagnostics expose counts/status markers only and no secret-bearing ledger/audit/Feishu details. | diagnostics | `pnpm --dir packages/gateway test test/diagnostics.test.ts` | existing | green |

*Status values: pending, green, red, flaky.*

---

## Wave 0 Requirements

- [x] `packages/gateway/test/project-manager-repository.test.ts` - stubs and fixtures for PM-01/PM-02 repository coverage.
- [x] `packages/gateway/src/db/repositories/project-manager-repository.ts` - repository under test.
- [x] `packages/gateway/src/routes/project-manager.ts` - project-scoped API route if not mounted inside an existing project route.
- [x] `packages/gateway/test/db-schema.test.ts` - expected project-manager tables.
- [x] `packages/gateway/test/copilot-tools.test.ts` - project-manager read tool coverage.
- [x] `packages/gateway/test/diagnostics.test.ts` - diagnostics count/redaction coverage.

---

## Manual-Only Verifications

All phase behaviors have automated verification. External Feishu live behavior is not required because Phase 4 must not add new Feishu execution authority.

---

## Threat References

| Threat | Category | Required Mitigation |
|--------|----------|---------------------|
| T-04-01 Cross-tenant ledger/work-item read | Information disclosure | Repository `user_id` filters, project visibility checks, owner/other-user tests. |
| T-04-02 Feishu text becomes approval or terminal authority | Elevation of privilege | Feishu inbound remains Copilot source only; pending-action approval route remains the only approval path. |
| T-04-03 Secret leakage in ledger/audit/diagnostics | Information disclosure | Store evidence references, not raw blobs; diagnostics expose counts/status markers only. |
| T-04-04 Work item completion without evidence | Repudiation | Done status requires evidence reference or explicit manual completion reason plus ledger event. |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target is under 240 seconds for full checks.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-20
