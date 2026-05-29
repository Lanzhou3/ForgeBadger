---
phase: 11
slug: evidence-ledger-and-acceptance-gates
status: complete
created: 2026-05-22
---

# Phase 11 - Research

Question: what needs to be known to plan bounded evidence attachment, safe
ledger review, tests, and handoff notes without changing the Gateway authority
model?

## Locked Decisions From CONTEXT.md

Evidence attachment:

- D-01: Add evidence attachment inside the existing work item detail Sheet.
- D-02: Do not add evidence attachment buttons directly to table rows.
- D-03: One submission creates exactly one evidence reference.
- D-04: The attachment form exposes only `kind`, `label`, `ref`, and `path`.
- D-05: The attachment form must not include raw evidence, terminal output,
  Feishu body, provider payload, transcript, secret, or note/body paste areas.
- D-06: Web should block obvious unsafe `ref` and `path` values, while Gateway
  remains final authority.
- D-07: A failed evidence attachment keeps the Sheet open and safe entered
  values recoverable.

Ledger review:

- D-08: Replace the current five-row ledger summary with a full in-tab ledger
  timeline.
- D-09: Load 25 ledger events by default with manual `Load more`.
- D-10: User-facing filters are `All`, `Status changes`, `Evidence`,
  `Manual completion`, and `Blockers`.
- D-11: The implementation may map filter groups locally or through the
  existing `eventType` query as long as UX stays stable.
- D-12: Each event shows event type, work item title or ID, status, evidence
  count, Feishu count, and timestamp.
- D-13: Do not expand raw event details or evidence reference lists from ledger
  events.
- D-14: Blocker and manual-completion events use badges plus short explanatory
  copy, not raw manual reason text.

Acceptance and handoff:

- D-15: Add one main Playwright happy path for project page to goal/work item,
  evidence attachment, status/done behavior, and ledger events.
- D-16: Error coverage focuses on evidence attach failure, ledger load failure,
  and the Phase 10 done guard.
- D-17: Extend typed client and strict E2E mock coverage for endpoint drift.
- D-18: Update `docs/TRIAL-CHECKLIST.md`, `docs/SUPPORT-DIAGNOSTICS.md`, and
  add a v1.2 closeout report under `docs/reports/`.
- D-19: Docs must include forbidden-content list and acceptable reference
  examples.

## Existing Implementation Facts

### Gateway Contract

`docs/API.md` already defines the Project Manager API as Gateway-owned under
`/api/v1/projects/:projectId/project-manager`.

Evidence reference fields currently allowed by the backend are:

- `kind`
- `label`
- `status`
- `ref`
- `path`
- `sessionId`
- `copilotRunId`
- `feishuChatId`
- `feishuMessageId`
- `createdAt`

Phase 11 Web UI intentionally exposes only `kind`, `label`, `ref`, and `path`
for post-creation attachment. This is a narrower product surface, not a backend
schema change.

`packages/gateway/src/routes/project-manager.ts` already has:

- `POST /work-items/:workItemId/evidence`
- `GET /ledger`
- zod strict schemas for evidence body and ledger query
- tenant/project lookup before repository mutation

`packages/gateway/src/db/repositories/project-manager-repository.ts` already
has:

- `attachEvidence(projectId, workItemId, input)`
- `listLedgerEvents(projectId, { eventType, limit })`
- user/project scoped SQL
- ledger writes for `evidence_attached`
- redaction of secret-like strings and raw terminal-like evidence strings
- `manual_completion_recorded` behavior from Phase 10 status updates

No Phase 11 database migration or route addition is needed unless execution
finds a bug in the existing contract.

### Web Contract

`packages/web/src/lib/api.ts` already exports:

- `ProjectManagerEvidenceRef`
- `ProjectManagerEvidenceInput`
- `ProjectManagerLedgerEvent`
- `ProjectManagerLedgerEventType`
- `attachProjectManagerWorkItemEvidence(projectId, workItemId, input)`
- `listProjectManagerLedger(projectId, params)`

`ProjectManagerPanel` already owns:

- project-scoped TanStack Query keys under `["project-manager", projectId, ...]`
- goal editing
- work item creation
- status transition mutation
- evidence-free `done` guard
- work item detail `Sheet`
- current five-event ledger table

The evidence attachment entry point should extend the detail Sheet rather than
creating a new route, global dashboard, or table-row action.

### E2E Contract

`packages/web/e2e/project-manager.spec.ts` already has a strict route mock for
`**/api/v1/**`. Unknown API routes are collected and fulfilled as 404. Phase 11
should preserve this pattern and add explicit handlers/assertions for:

- evidence attachment `POST`
- ledger `GET` with `limit=25`, load-more limit growth, and optional filter
  behavior if eventType query is used
- evidence attach failure
- ledger load failure
- done guard regression

## Recommended Implementation Shape

### Evidence Attachment

Add a small evidence draft owned by `ProjectManagerPanel`:

- `kind`
- `label`
- `ref`
- `path`

Build `createSingleEvidenceReference(draft)` by trimming fields and dropping
empty optional fields. It should return no reference if all four fields are
empty, and the UI should require at least one of `ref` or `path` plus a
non-empty `kind`.

Add a Web-side guard for obviously unsafe content in `ref` and `path`.
The guard should block values matching:

- OpenAI-style API key prefix: `sk-...`
- `Bearer ...`
- JWT-like three-part token
- private key block headers
- `OPENFORGE_ATTACH_TOKEN=...`
- key-value secret patterns such as `api_key=...`, `token:...`,
  `password=...`, `secret=...`, `private_key=...`, `credential=...`,
  `event_encrypt_key=...`
- raw terminal indicators such as newline/control characters,
  `terminal transcript`, `raw terminal`, `command output`, `stdout`,
  `stderr`, or shell prompt fragments like `$ pnpm test`
- provider payload-like JSON snippets containing keys such as `messages`,
  `choices`, `model`, `provider`, `authorization`, or `api_key`

The guard is a product UX boundary. Gateway remains the security authority and
may redact or reject data independently.

On success, invalidate work item and ledger queries. On failure, keep the Sheet
open, keep the safe draft values, and show a local mutation error.

### Ledger Timeline

Use a full-width card/section in the existing Project Manager tab. Replace the
current five-row table with a timeline-like list or compact rows. The
recommended approach is a compact row/card hybrid inside the same card:

- event badge
- work item title if available from current work item data, else work item ID
- status badge or `-`
- evidence count
- Feishu count
- timestamp
- short safe explanation only for `manual_completion_recorded`,
  `blocker_recorded`, and `blocker_resolved`

Use `LEDGER_PAGE_SIZE = 25` and `ledgerLimit` state. `Load more` increments the
limit by 25 and refetches through the existing typed client. Because Gateway
currently supports one `eventType` only, the lowest-risk filter design is local
grouping over the fetched event window:

- `All`: all fetched events
- `Status changes`: `work_item_status_changed`
- `Evidence`: `evidence_attached`
- `Manual completion`: `manual_completion_recorded`
- `Blockers`: `blocker_recorded`, `blocker_resolved`

This honors the stable user-facing groups without backend change. If execution
chooses a single eventType query for one-to-one groups, blocker filtering still
needs local grouping or multiple queries; do not add backend scope unless a real
bug is found.

Ledger load failure should be visible inside the ledger area and should not
blank the already-loaded goal and work item surfaces.

## Validation Architecture

### Unit/Client

Use `packages/web/src/lib/api.test.ts` for typed client route assertions:

- evidence attach exact URL, method, and request body
- one-reference post-creation payload uses only `kind`, `label`, `ref`, `path`
  in the Phase 11 UI path
- ledger query uses expected `limit=25` and event query only if implemented

### E2E

Use `packages/web/e2e/project-manager.spec.ts` as the main behavioral gate:

- full happy path from project page to Project Manager tab, goal/work item
  flow, evidence attachment, status/done behavior, and ledger event visibility
- evidence attach failure keeps Sheet/draft recoverable
- ledger load failure is rendered in the ledger area
- Phase 10 evidence-free `done` guard remains in place
- strict mock continues to fail on unknown `/api/v1/*`

### Docs

Docs are part of acceptance because Phase 11 closes the v1.2 workflow. Update:

- `docs/TRIAL-CHECKLIST.md`
- `docs/SUPPORT-DIAGNOSTICS.md`
- `docs/reports/v1.2-project-manager-web-workflow-closeout-2026-05-22.md`

Docs must explicitly say evidence references are pointers, not raw evidence
bodies.

## Risk Notes

- Do not turn Web-side sensitive-content blocking into the only security
  authority.
- Do not expose all backend evidence fields in the post-creation form.
- Do not let ledger failure blank the whole Project Manager workflow.
- Do not display raw manual completion reason or raw ledger details in the
  timeline.
- Do not add a global dashboard, kanban board, separate ledger tab, raw evidence
  storage, or new Gateway write authority.

