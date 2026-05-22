---
status: complete
phase: 10-goal-and-work-item-operations
source:
  - 10-01-SUMMARY.md
  - 10-02-SUMMARY.md
  - 10-03-SUMMARY.md
started: 2026-05-22T03:59:33Z
updated: 2026-05-22T03:59:33Z
---

## Current Test

[testing complete]

## Tests

### 1. Open Project Manager State
expected: |
  Opening a project detail page and selecting the Project Manager tab shows the goal, work items, ledger events, and refresh control without hitting unknown API routes.
result: pass
evidence: `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - `renders populated Project Manager state from exact API routes`

### 2. Save Goal Update
expected: |
  Editing the project goal lets the user update summary, newline-separated constraints, newline-separated acceptance criteria, and status; saving persists through the Gateway route and shows the updated goal.
result: pass
evidence: `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - `saves a Project Manager goal update through the exact API route`

### 3. Filter And Inspect Work Items
expected: |
  Filtering work items by a bounded status sends the status filter, updates the visible list, and opens an in-context details sheet with safe fields and counts.
result: pass
evidence: `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - `filters, inspects, and creates Project Manager work items`

### 4. Create Work Item With Bounded References
expected: |
  Creating a work item accepts title, description, priority, status, acceptance criteria, and optional bounded evidence and Feishu reference fields; the created item appears after save.
result: pass
evidence: `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - `filters, inspects, and creates Project Manager work items`

### 5. Move Status And Guard Evidence-Free Done
expected: |
  Work item status actions show only documented next statuses. A normal status move submits the expected mutation. Marking an item done without evidence opens a manual completion reason prompt, rejects blank input, and submits non-empty manualCompletionReason.
result: pass
evidence: `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - `changes work item status and guards evidence-free done`

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[]

## Verification Commands

- `pnpm --dir packages/web run typecheck` - pass
- `pnpm --dir packages/web exec vitest run src/lib/api.test.ts` - pass, 46/46
- `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - pass, 5/5
- `git diff --check` - pass
- `gsd-sdk query verify.schema-drift 10` - pass, `drift_detected: false`

## Notes

- Playwright required sandbox escalation because the local Next dev server must bind `127.0.0.1:48732`; sandboxed execution fails with `listen EPERM`.
