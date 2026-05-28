---
phase: 12
slug: copilot-project-manager-traceability
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-22
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Backend `node:test` via `node --test --import tsx`; Web Vitest; E2E Playwright |
| **Config file** | `packages/gateway/package.json`, `packages/web/vitest.config.ts`, `packages/web/e2e/*.spec.ts` |
| **Quick run command** | `pnpm --dir packages/gateway test test/copilot-tools.test.ts test/copilot-routes.test.ts test/project-manager-repository.test.ts test/project-manager-routes.test.ts && pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts` |
| **Full suite command** | `pnpm -r typecheck && pnpm -r test` |
| **Estimated runtime** | ~180 seconds for quick targeted tests; full suite depends on E2E scope |

---

## Sampling Rate

- **After every backend task commit:** Run the focused gateway test command for touched Copilot/Project Manager files.
- **After every Web task commit:** Run `pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts`.
- **After every plan wave:** Run both focused backend and Web quick commands.
- **Before `$gsd-verify-work`:** Run `pnpm -r typecheck`, `pnpm -r test`, and focused Playwright specs when UI surfaces changed.
- **Max feedback latency:** One task or one plan wave, whichever comes first.

---

## Requirement Verification Map

| Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|-----------------|-----------|-------------------|-------------|--------|
| POS-01 | PM traceability strengthens local-first AI CLI control plane and does not introduce generic PM breadth or direct AI execution. | backend contract | `pnpm --dir packages/gateway test test/copilot-tools.test.ts` | yes | pending |
| POS-02 | PM state remains Gateway-owned, tenant-scoped, audited, and bounded to structured refs. | repository + route | `pnpm --dir packages/gateway test test/project-manager-repository.test.ts test/project-manager-routes.test.ts` | yes | pending |
| POS-03 | PM writes execute only through explicit Copilot pending-action approval using canonical stored payloads. | Copilot route/tool | `pnpm --dir packages/gateway test test/copilot-tools.test.ts test/copilot-routes.test.ts` | yes | pending |
| TRACE-01 | Copilot run/action references link to PM work item evidence refs without raw blobs. | route + Web API | `pnpm --dir packages/gateway test test/project-manager-routes.test.ts && pnpm --dir packages/web test src/lib/api.test.ts` | yes | pending |
| TRACE-02 | Exactly three PM proposal types create pending actions and never mutate directly: create work item, update status, attach evidence. | Copilot tool | `pnpm --dir packages/gateway test test/copilot-tools.test.ts` | yes | pending |
| TRACE-03 | Ledger events expose safe trace markers and omit raw prompt, terminal, provider, and secret content. | repository + route | `pnpm --dir packages/gateway test test/project-manager-repository.test.ts test/project-manager-routes.test.ts test/copilot-routes.test.ts` | yes | pending |
| TRACE-04 | Web shows prompt -> approval -> execution evidence through PM approval cards, PM anchors, detail markers, and ledger markers. | Web unit + E2E | `pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts && pnpm --dir packages/web exec playwright test e2e/copilot.spec.ts e2e/project-manager.spec.ts` | yes | pending |

---

## Wave 0 Requirements

- [ ] `packages/gateway/test/copilot-tools.test.ts` — PM prepare-tool cases for exactly three proposal types and no direct mutation.
- [ ] `packages/gateway/test/copilot-routes.test.ts` — PM approval success, invalid stored payload, cross-tenant ids, terminal failed status, no restore-to-pending, and Copilot `done` trusted-evidence gate.
- [ ] `packages/gateway/test/project-manager-repository.test.ts` — `pendingActionId` evidence refs and safe trace marker transaction behavior.
- [ ] `packages/gateway/test/project-manager-routes.test.ts` — evidence schema/DTO and safe ledger trace marker route output.
- [ ] `packages/web/src/lib/api.test.ts` — Project Manager evidence and ledger trace DTOs.
- [ ] `packages/web/src/lib/copilot.test.ts` — PM action labels, fixed summaries, result summaries, and failed-action copy.
- [ ] `packages/web/e2e/copilot.spec.ts` and `packages/web/e2e/project-manager.spec.ts` — PM approval card, approved result, `View in Project Manager` anchor, PM detail marker, and ledger marker.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual polish of PM approval card and PM trace markers | TRACE-04 | Automated tests prove routing and markers; visual density and readability need human review. | Open Copilot pending action card and Project Manager detail/ledger view; verify fixed templates are readable and no text overlaps. |

---

## Validation Sign-Off

- [ ] All planned tasks include automated verification or explicit Wave 0 dependencies.
- [ ] Sampling continuity: no three consecutive implementation tasks without an automated verify command.
- [ ] Wave 0 covers all missing automated references above.
- [ ] No watch-mode flags in verification commands.
- [ ] Feedback latency stays within one task or one plan wave.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
