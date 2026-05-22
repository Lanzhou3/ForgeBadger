---
phase: 11
slug: evidence-ledger-and-acceptance-gates
status: verified
threats_open: 0
asvs_level: default
created: 2026-05-22T15:09:54+08:00
updated: 2026-05-22T15:09:54+08:00
auditor: gsd-security-auditor
auditor_agent_id: 019e4e82-452d-7cf3-bd8e-43b6f5aafd00
---

# Phase 11 - Security

Per-phase security contract: threat register, accepted risks, and audit trail.

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser Project Manager UI -> Gateway Project Manager API | Users attach evidence references and mutate work-item state through the existing typed Web client and Gateway authority. | Work item IDs, status changes, bounded evidence reference pointers. |
| Gateway ledger response -> Browser ledger timeline | Existing ledger events are rendered as safe timeline markers. | Event type, work item title or ID, status, evidence count, Feishu count, timestamp. |
| Trial/support/closeout docs -> Maintainers and first users | Docs explain evidence handling and diagnostics without asking users to paste raw sensitive content. | Acceptable reference examples, forbidden-content categories, redacted diagnostics guidance. |

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-11-01 | Information disclosure | Evidence attach form | mitigate | Evidence draft and form expose only `kind`, `label`, `ref`, and `path`; no raw evidence body, terminal transcript, Feishu body, provider payload, or note paste field is added. Evidence: `packages/web/src/components/projects/ProjectManagerPanel.tsx:106`, `packages/web/src/components/projects/ProjectManagerPanel.tsx:888`. | closed |
| T-11-02 | Information disclosure | Web-side evidence validation | mitigate | Local guard blocks obvious API keys, bearer/JWT tokens, private keys, attach tokens, secret key-value strings, raw terminal or command output markers, control characters, and provider-payload-like JSON before submission. Evidence: `packages/web/src/components/projects/ProjectManagerPanel.tsx:357`, `packages/web/src/components/projects/ProjectManagerPanel.tsx:1538`. | closed |
| T-11-03 | Availability | Evidence mutation failure | mitigate | Failure only sets local error; safe draft values and Sheet state remain recoverable, and draft clearing happens only on success. Evidence: `packages/web/src/components/projects/ProjectManagerPanel.tsx:256`, `packages/web/src/components/projects/ProjectManagerPanel.tsx:267`, `packages/web/e2e/project-manager.spec.ts:150`. | closed |
| T-11-04 | Information disclosure | Ledger timeline | mitigate | Ledger rows render safe markers only: event label, work item title or ID, status, counts, timestamp, and static notes. Raw details, manual reasons, and evidence ref lists are not rendered in timeline rows. Evidence: `packages/web/src/components/projects/ProjectManagerPanel.tsx:1375`, `packages/web/src/components/projects/ProjectManagerPanel.tsx:1571`. | closed |
| T-11-05 | Integrity | Ledger filter mapping | mitigate | Local filters map stable user-facing groups to existing Gateway event types without adding backend semantics. Evidence: `packages/web/src/components/projects/ProjectManagerPanel.tsx:124`, `packages/web/src/components/projects/ProjectManagerPanel.tsx:134`. | closed |
| T-11-06 | Availability | Ledger query failure | mitigate | Global panel error excludes ledger load failure, while the ledger card renders its own retryable error state; E2E verifies goal and work-item surfaces remain visible. Evidence: `packages/web/src/components/projects/ProjectManagerPanel.tsx:272`, `packages/web/src/components/projects/ProjectManagerPanel.tsx:1309`, `packages/web/e2e/project-manager.spec.ts:249`. | closed |
| T-11-07 | Integrity | E2E route contract | mitigate | Strict unknown `/api/v1/*` mock fallback records unhandled routes and returns 404; happy path and regressions assert no unhandled API routes. Evidence: `packages/web/e2e/project-manager.spec.ts:177`, `packages/web/e2e/project-manager.spec.ts:209`, `packages/web/e2e/project-manager.spec.ts:659`. | closed |
| T-11-08 | Information disclosure | Trial/support/closeout docs | mitigate | Trial and support docs define acceptable evidence references and forbidden raw/sensitive content; closeout includes redaction scan classification with no real secret values intentionally included. Evidence: `docs/TRIAL-CHECKLIST.md:84`, `docs/TRIAL-CHECKLIST.md:94`, `docs/SUPPORT-DIAGNOSTICS.md:70`, `docs/SUPPORT-DIAGNOSTICS.md:83`, `docs/reports/v1.2-project-manager-web-workflow-closeout-2026-05-22.md:98`. | closed |
| T-11-09 | Product trust | v1.2 closeout claims | mitigate | Closeout preserves unresolved v1.1 caveats for live provider, physical Windows/WSL terminal, Feishu console callback, and first-user feedback because Phase 11 did not add new real external evidence. Evidence: `docs/reports/v1.2-project-manager-web-workflow-closeout-2026-05-22.md:132`, `docs/reports/v1.2-project-manager-web-workflow-closeout-2026-05-22.md:137`. | closed |

## Accepted Risks Log

No accepted risks.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-22 | 9 | 9 | 0 | gsd-security-auditor |

## Verification Evidence

- `gsd-security-auditor` returned `## SECURED` with `threats_open: 0`.
- Plan-time threat model source: `11-01-PLAN.md`, `11-02-PLAN.md`, and `11-03-PLAN.md`.
- Execution evidence source: `11-01-SUMMARY.md`, `11-02-SUMMARY.md`, `11-03-SUMMARY.md`, and `11-UAT.md`.
- Phase 11 validation evidence already recorded in UAT: `pnpm --dir packages/web run typecheck`, `pnpm --dir packages/web exec vitest run src/lib/api.test.ts`, `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium`, `git diff --check`, `gsd-sdk query verify.schema-drift 11`, and targeted docs redaction scan.

## Sign-Off

- [x] All threats have a disposition.
- [x] Accepted risks documented in Accepted Risks Log.
- [x] `threats_open: 0` confirmed.
- [x] `status: verified` set in frontmatter.

**Approval:** verified 2026-05-22
