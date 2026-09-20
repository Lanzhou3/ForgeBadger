# ForgeBadger API Contract

> Status: MVP-10 local-first release-candidate slice | Date: 2026-05-11

This document summarizes the current REST and WebSocket contract. `docs/TECH-ARCHITECTURE.md` remains the full architecture reference.

## 1. Base Rules

- Base path: `/api/v1`
- Auth: `Authorization: Bearer <jwt>`
- Content type: `application/json`
- Next.js does not serve API routes. All API and WebSocket behavior belongs to the Gateway service.

## 2. Response Envelope

This is the canonical API envelope. Gateway REST endpoints must return
this shape; frontend code should not consume alternate envelope variants.

Success:

```json
{
  "code": 0,
  "data": {},
  "message": ""
}
```

Error:

```json
{
  "code": 1,
  "message": "error description",
  "details": {}
}
```

HTTP status codes still carry transport semantics:

- `200` success
- `201` created
- `400` validation error
- `401` unauthenticated
- `403` unauthorized
- `404` not found
- `409` conflict
- `429` rate limited
- `500` server error
- `503` temporarily unavailable

## 3. REST Surface

### Auth

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/reset-password`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

Auth user payloads include `id`, `email`, `role`, and `status`. The first
registered local user is bootstrapped as `admin`; later registrations default
to `user`. Disabled users cannot log in or refresh `/auth/me`.

`POST /api/v1/auth/register` accepts
`{ email, password, recoveryKey, inviteCode? }`. When the production Gateway
provides local account recovery, registration requires a direct loopback socket
without proxy-forwarding headers and a valid key from
`<FORGEBADGER_STATE_DIR>/account-recovery.key`. Validation does not consume or
rotate the key. Existing `off` and `invite` registration policies still apply;
invite mode requires both the local recovery key and a valid invite for users
after the initial administrator.

`POST /api/v1/auth/reset-password` is an unauthenticated, local-owner recovery
route. It accepts `{ email, recoveryKey, newPassword }`, but only over a direct
loopback socket without `Forwarded`/`X-Forwarded-*` proxy evidence. The key is
read from `<FORGEBADGER_STATE_DIR>/account-recovery.key`; a successful reset
rotates that key, revokes every session for the account, and requires a normal
login with the new password. Unknown users, disabled users, and invalid keys
share the same generic `401` response. Recovery attempts are limited to five
per 15 minutes.

### Admin Users

- `GET /api/v1/admin/users`
- `PATCH /api/v1/admin/users/:id`

These endpoints require an active authenticated admin user. `GET` returns all
local users with role/status metadata. `PATCH` accepts:

```json
{
  "role": "admin",
  "status": "active"
}
```

`role` is `admin` or `user`; `status` is `active` or `disabled`. Admins cannot
demote or disable their own account. PRD-mentioned `editor` and `readonly`
roles are intentionally out of scope for the local-first MVP; see the role
model decision in `docs/TECH-ARCHITECTURE.md`（二、数据模型设计,`users` 表结构与注释）。

### Dashboard

- `GET /api/v1/dashboard/summary`
- `GET /api/v1/dashboard/stats`
- `GET /api/v1/dashboard/health`

Dashboard endpoints are tenant scoped and auth protected. `summary` returns
aggregate counts for projects, sessions, running sessions, Agents, Skills,
models, API Keys, and templates, plus health items for Gateway, database,
project config, models, credentials, sessions, Agents, and Skills.

### Diagnostics

- `GET /api/v1/diagnostics/export`

Diagnostics export is authenticated, tenant scoped, and local-only. It returns a
redacted report with app version, Node/platform metadata, tenant resource
counts, dashboard health, adapter definitions/runtime modes, Copilot capability
metadata, Provider SSOT readiness summaries, Copilot memory entry/note counts,
safe Feishu integration capability state, and selected ForgeBadger environment
values. It never uploads telemetry and redacts key, token, password,
credential, authorization, `sk-*`, and `Bearer ...` values.
Provider SSOT diagnostics include only bounded counts and status metadata:
provider/model/credential totals, active/default counts, api format
distribution, and per-provider readiness summaries. Plaintext secrets, encrypted
secrets, credential previews, default headers, and foreign-tenant providers are
not included.

### Project Manager Ledger

The Project Manager Ledger is Gateway-owned ForgeBadger control-plane state. It
does not make Feishu or terminal sessions an authority for project-manager
state; terminal sessions may be referenced only by safe identifiers or evidence
references. (The legacy `feishuRefs` collaboration-metadata slot was retired in
migration `0083_drop_pm_feishu_refs`.)

Phase 4 introduces migration-backed durable state in
`packages/gateway/src/db/migrations/0022_project_manager_ledger.sql` with these
exact tables:

- `project_manager_goals`
- `project_manager_work_items`
- `project_manager_ledger_events`

Every project-manager table includes `user_id`. Project-scoped rows also
include `project_id`; this includes project goals, work items, and ledger
events. Repository methods must be constructed with the authenticated
`user_id`, must filter by `user_id` internally, and must include `project_id`
for project-scoped reads and mutations. Route handlers must also verify that
`:projectId` is visible to the authenticated user before returning or mutating
project-manager data.

Authenticated REST endpoints are mounted under the project-scoped prefix
`/api/v1/projects/:projectId/project-manager`:

- `GET /api/v1/projects/:projectId/project-manager/goal`
- `PUT /api/v1/projects/:projectId/project-manager/goal`
- `GET /api/v1/projects/:projectId/project-manager/work-items`
- `POST /api/v1/projects/:projectId/project-manager/work-items`
- `POST /api/v1/projects/:projectId/project-manager/work-items/batch/status`
- `GET /api/v1/projects/:projectId/project-manager/task-packets`
- `GET /api/v1/projects/:projectId/project-manager/starter-packs`
- `POST /api/v1/projects/:projectId/project-manager/starter-packs/:packId/task-packet`
- `GET /api/v1/projects/:projectId/project-manager/work-items/:workItemId`
- `GET /api/v1/projects/:projectId/project-manager/work-items/:workItemId/task-packet`
- `POST /api/v1/projects/:projectId/project-manager/work-items/:workItemId/task-packet/session-link`
- `POST /api/v1/projects/:projectId/project-manager/work-items/:workItemId/task-packet/start`
- `PATCH /api/v1/projects/:projectId/project-manager/work-items/:workItemId`
- `PATCH /api/v1/projects/:projectId/project-manager/work-items/:workItemId/status`
- `POST /api/v1/projects/:projectId/project-manager/work-items/:workItemId/evidence`
- `DELETE /api/v1/projects/:projectId/project-manager/work-items/:workItemId`
- `GET /api/v1/projects/:projectId/project-manager/stages`
- `POST /api/v1/projects/:projectId/project-manager/stages`
- `POST /api/v1/projects/:projectId/project-manager/stages/seed-template`
- `POST /api/v1/projects/:projectId/project-manager/stages/reorder`
- `PATCH /api/v1/projects/:projectId/project-manager/stages/:stageId`
- `DELETE /api/v1/projects/:projectId/project-manager/stages/:stageId`
- `GET /api/v1/projects/:projectId/project-manager/work-item-links`
- `POST /api/v1/projects/:projectId/project-manager/work-items/:workItemId/dependencies`
- `DELETE /api/v1/projects/:projectId/project-manager/work-items/:workItemId/dependencies/:blockerWorkItemId`
- `GET /api/v1/projects/:projectId/project-manager/ledger`

Development stages and work-item dependencies are durable state introduced by
`packages/gateway/src/db/migrations/0045_dev_task_stages.sql`:

- `project_manager_stages` — ordered SDLC lanes (`position`, status
  `active` / `completed` / `archived`). `POST /stages/seed-template` creates
  the standard 需求分析 → 架构设计 → 编码实现 → 测试验证 → 发布交付 flow once
  per project; `POST /stages/reorder` requires the exact stage id set and
  rewrites sequential positions; deleting a stage moves its work items back
  to the backlog (`stage_id = NULL`).
- `project_manager_work_items.stage_id` — optional stage assignment settable
  through work-item create/patch (`stageId`, `null` clears).
- `project_manager_work_item_links` — blocked-by edges
  (`blocker_work_item_id` blocks `blocked_work_item_id`) with a unique pair
  index. Self links, duplicates, and direct or transitive cycles are rejected
  (`400`); deleting a work item removes its links. Stage and dependency
  mutations write `stage_created` / `stage_updated` / `stage_deleted` /
  `dependency_added` / `dependency_removed` ledger events.

All Project Manager Ledger REST endpoints use the canonical ForgeBadger response
envelope. Success responses return:

```json
{
  "code": 0,
  "data": {},
  "message": ""
}
```

Error responses return:

```json
{
  "code": 1,
  "message": "error description",
  "details": {}
}
```

Inputs are zod validated at the Gateway boundary. Invalid `projectId`,
`workItemId`, pagination, status, evidence, or goal payloads return `400` with
the error envelope. Missing or cross-tenant projects and work items return
`404` without leaking whether another tenant owns the resource.

`POST /work-items` accepts either an omitted `status` or an explicit `todo`;
any other initial status returns `400`. The repository always persists a new
work item as `todo`. Moving it to another state requires a separate
`PATCH /work-items/:workItemId/status` mutation so the normal transition,
evidence, ledger, and audit guards cannot be bypassed during creation.

The Web create-work-item dialog does not collect or send initial evidence.
Evidence is attached later from the work-item detail and
acceptance flow through `POST /work-items/:workItemId/evidence`. The lower-level
Gateway create contract still accepts bounded `evidenceRefs`
as compatibility metadata for historical records and approved integrations;
their database and DTO fields remain intact. These references are pointers,
not verified evidence bodies. The former `feishuRefs` collaboration-metadata
slot was retired (migration `0083_drop_pm_feishu_refs`): the columns are
dropped and no API, tool, or DTO surface accepts or returns them anymore.

Task packet endpoints derive a bounded operator handoff from a work item:
project id/name, CLI adapter, template id, prompt, acceptance criteria,
expected verification, evidence requirements, a single linked session marker,
and a blocked reason when no running/detached session is linked. The prompt is
derived on read from safe Project Manager fields; the route must not expose or
persist raw work-item `details`, raw terminal output, provider payloads, Feishu
message bodies, attach tokens, API keys, or secret-like values.

`GET /task-packets` returns the bounded task packet list for the work queue.
Each packet includes the original work item status, a derived queue status
(`planned`, `running`, `waiting_for_review`, `blocked`, `completed`, or
`cancelled`), updated timestamp, runtime metadata, session link marker,
blocked reason, and the same bounded prompt/criteria/verification/evidence
fields as the single-packet endpoint. It does not expose raw work-item
`details` or unbounded evidence bodies.

`GET /starter-packs` returns the built-in pack catalog for repeatable AI CLI
work. The current catalog includes code review, bugfix, docs sync, test
generation, release notes, and first-user evidence. Each pack includes a
recommended CLI adapter, prompt frame, acceptance checklist, verification
guidance, and evidence fields.

`POST /starter-packs/:packId/task-packet` creates a normal Project Manager work
item from the selected pack and returns the pack, created work item, and
derived task packet. It stores only bounded pack metadata under
`details.taskPacket`, such as pack id, recommended adapter, prompt frame,
verification guidance, and evidence field names. It does not start a session,
write terminal input, collect provider secrets, store raw terminal output, or
create a parallel workflow outside Project Manager.

`POST /task-packet/session-link` links exactly one same-project session to the
task packet. Cross-project, cross-tenant, or missing sessions return `404`.
`POST /task-packet/start` creates one `idle` task session when no linked session
exists, stores only bounded context metadata such as a context reference,
prompt digest, counts, adapter/template, and session id in the work-item
details, and returns the derived task packet plus the created session. The
optional JSON body `{ "aiTool": "claude" | "opencode" | "codex" | "kimi" }`
selects the CLI for the new session; it falls back to the project's `aiTool`,
and returns `400` when neither is a known adapter. The selected adapter is
gated by adapter discovery (`available` + launch-enabled + terminal support)
and returns `409` with adapter details when unavailable. It does not start
terminal processes, write terminal input, inject secrets, or grant autonomous host execution
authority; the operator still starts/connects the session through the existing
session lifecycle.

The Web session detail page may read `GET /task-packets` for the session's
project and display the task packet linked to the current session as a manual
handoff panel: prompt, acceptance criteria, expected verification, evidence
requirements, runtime metadata, linked session marker, and a link back to the
Project Manager work item. This display remains read-only and must not write
the prompt into terminal input, capture terminal scrollback, or expand the
session execution authority.

The same session detail page can build a local Markdown handoff/evidence pack
from bounded task-packet fields, session runtime metadata, operator notes,
verification notes, and open review items. This is a Web-only manual export
surface, not a Gateway persistence route: it must not upload the packet,
store terminal history, write terminal input, or clear external evidence
gates. Before showing Markdown, the audit blocks empty required notes,
obvious secret-like values, placeholder text, and raw terminal dump patterns.

Copilot can explain project-manager state through these read-only tools:

- `forgebadger.get_project_goal`
- `forgebadger.list_project_work_items`
- `forgebadger.get_project_work_item`
- `forgebadger.get_project_development_ledger`

These tools are tenant-scoped, project-scoped, redacted, and read-only. They
return concise current state plus bounded evidence references only. They must
not return raw terminal transcripts, unbounded ledger details, Feishu webhook
verification material, provider credentials, attach tokens, or cross-tenant
mapping details.

Project Manager remains the task and evidence source of truth. The P1 governed
command contract below supersedes the older proposal-only write path: supported
writes use immutable platform-action intents and receipts. A matching grant can
authorize the action; otherwise an exact owner approval is required. Generic
metadata grants cannot change acceptance criteria, attach completion evidence or
mark work complete. Existing explicit owner routes retain their domain validation.

Work item status is a bounded product state. Allowed statuses are:

- `todo`
- `in_progress`
- `blocked`
- `ready_for_review`
- `done`
- `cancelled`

Allowed Phase 4 transitions are:

| From | To |
|------|----|
| `todo` | `in_progress`, `blocked`, `cancelled` |
| `in_progress` | `blocked`, `ready_for_review`, `done`, `cancelled` |
| `blocked` | `todo`, `in_progress`, `cancelled` |
| `ready_for_review` | `in_progress`, `done`, `cancelled` |
| `done` | terminal |
| `cancelled` | terminal |

Every state mutation updates the current projection and appends a
`project_manager_ledger_events` row atomically. The same mutation also writes
an `audit_logs` row with tenant-scoped, redacted details. Stored event and
audit details must summarize the mutation and counts only; they must not store
raw prompts, raw terminal transcripts, raw CLI stderr, provider request
payloads, or secret-bearing Feishu material.

Ledger event type is also bounded. Allowed event types are:

- `goal_updated`
- `work_item_created`
- `work_item_status_changed`
- `evidence_attached`
- `blocker_recorded`
- `blocker_resolved`
- `copilot_observation_recorded`
- `feishu_reference_linked`
- `next_step_proposed`
- `manual_completion_recorded`

Evidence references are structured references, not raw evidence blobs. A
reference may include only these fields:

- `kind`
- `label`
- `status`
- `ref`
- `path`
- `sessionId`
- `copilotRunId`
- `pendingActionId`
- `feishuChatId`
- `feishuMessageId`
- `createdAt`

Phase 14 workspace/terminal references use the same bounded structure:

- file path evidence uses `kind: "file_path"` plus a project-relative `path`;
- terminal snapshot evidence uses `kind: "terminal_snapshot"`, `sessionId`,
  and a marker-style `ref` such as `terminal-snapshot:<sessionId>:latest`;
- session evidence uses `kind: "session"`, `sessionId`, and optionally
  `ref: "session:<sessionId>"`.

These references are pointers only. They must not contain raw file contents,
terminal scrollback, CLI stdout/stderr, provider payloads, Feishu message
bodies, tokens, API keys, attach tokens, or other secrets.

Ledger route responses expose safe trace markers through
`ProjectManagerLedgerTrace`; raw `details` are never included in REST DTOs.
Trace fields are copied only from this allowlist:

```ts
interface ProjectManagerLedgerTrace {
  copilotRunId?: string;
  pendingActionId?: string;
  actionType?: string;
  targetType?: string;
  targetId?: string;
  evidenceRefCount?: number;
  approvalStatus?: string;
  executionStatus?: string;
}
```

The trace contract intentionally excludes raw prompt text, raw terminal output,
provider payloads, full approval diffs, full execution summaries, tokens, API
keys, JWTs, private keys, stdout, stderr, and other secret-looking fields. If a
future implementation needs a new trace field, it must add that field to the
allowlist and tests before exposing it.

Marking a work item `done` requires at least one evidence reference or a
non-empty manual completion reason. If completion uses the manual reason path,
the mutation must append a `manual_completion_recorded` ledger event and an
`audit_logs` row that records the presence of the manual completion reason
without storing sensitive raw details.

Editing a work item through `PATCH /work-items/:workItemId` may update title,
description, priority, and acceptance criteria only; status and evidence remain
separate operations so board interactions cannot bypass transition and evidence
guards. Deleting a work item requires `{ "confirm": true }`, appends a
`work_item_deleted` ledger event with a bounded `targetId` marker, writes an
audit row, and then deletes the projection row. Batch status updates are limited
to 20 work items, execute in one repository transaction, reject duplicate work
item ids, and use the same transition, completion, evidence, ledger, and audit
rules as single-item status updates.

Project-manager diagnostics expose counts and safe latest status markers only
for Project Manager Ledger state. Diagnostics may include goal, work item,
ledger event, and status totals, plus the latest safe marker timestamps. They
must not include raw ledger details, raw evidence details, raw terminal
transcripts, raw CLI stderr, raw Feishu messages, webhook signatures, event
encrypt keys, Feishu tokens, provider credentials, API keys, JWTs, attach
tokens, private keys, or cross-tenant mapping details.

Feishu free-form text is never an approval or execution channel for governed
work. It cannot approve decisions, send terminal input, mutate ledger records,
or bypass canonical decisions. The former Feishu outbound delivery runtime
(Portfolio bindings, canonical signed actions, and the durable Outbox) is
retired and not mounted; no live code path delivers Feishu channel messages,
and no channel text is routed into an assistant or terminal path.

### Integrations

Feishu account administration remains under `/api/v1/integrations/feishu/**`. Account secrets are write-only and encrypted; status and configuration responses contain only safe capability state.

- `GET /api/v1/integrations/feishu/status`
- `GET|PUT /api/v1/integrations/feishu/account`
- `GET|PUT /api/v1/integrations/feishu/config`
- `GET|PUT /api/v1/integrations/feishu/user-mappings`
- `POST /api/v1/integrations/feishu/emergency-stop`

Portfolio-based message ingress, signed actions, and delivery workers are retired. Feishu configuration never becomes terminal input or an approval decision.

### Copilot and retired runtime APIs

The native Copilot API is mounted at `/api/v1/copilot/**` and uses the Gateway-owned provider, conversation, memory, approval, tool, and event services. The DeepSeek Harness bridge under `/api/internal/v1/copilot-bridge/**` and the former Portfolio API under `/api/v1/portfolio/**` are not mounted.

Applied Portfolio migrations and historical schema declarations remain for migration continuity only. No live repository, route, scheduler, event publisher, or Web client reads or writes those records.

### Native Copilot run continuity (P0, 2026-09-05)

All responses use the standard `{code,data,message}` envelope and authenticated tenant ownership.

| Endpoint | Contract |
|---|---|
| `POST /api/v1/copilot/conversations/:id/messages` | `{content,modelId?,projectId?,grantId?,clientRequestId?}`; returns 201 `{runId}` after durable admission, before model completion. A new request during an active run returns 409 `COPILOT_CONVERSATION_BUSY`. Matching request-key retries return the original run, including after completion; conflicting payloads return 409 `COPILOT_REQUEST_CONFLICT`. |
| `GET /api/v1/copilot/conversations/:id/runs` | `{runs,activeRun}`; latest 50 runs and current active run, or null. |
| `GET /api/v1/copilot/runs/:id` | `{run,pendingActions,steps}`; run includes revision and stopReason, actions include full inputJson/inputDigest, stepId and toolCallId. Steps retain execution receipts. |
| `POST /api/v1/copilot/runs/:id/pending-actions/:actionId/decide` | `{approved}`; persists a single decision and returns `{resumed,runId}`. The original run continues asynchronously, including after rejection. |
| `POST /api/v1/copilot/runs/:id/cancel` | Awaits durable cancellation; returns `{cancelled,runId}`. It does not undo effects already sent to a CLI. |
| `POST /api/v1/copilot/conversations/:id/edit-message` | Validates that messageId is a user text in the URL conversation. Active or unresolved writes return 409. Clears summary, preserves run/step receipts and admits an edited turn atomically. |
| `DELETE /api/v1/copilot/conversations/:id` | Hides an inactive conversation while retaining execution evidence; unresolved executions return 409. Repeated deletion returns 404. |

Run terminal states are `completed`, `failed`, `cancelled`, `stopped` (for example `step_budget_exhausted`) and `indeterminate` (unconfirmed side effects). `pending`, `running` and `awaiting_approval` remain active. Cancellation may retain an indeterminate write step; a later receipt records the outcome without reviving the run. There is no automatic retry endpoint for unknown writes.

`copilot_run_updated` includes `revision` and is a refresh hint; REST is authoritative. Memory endpoints accept `conversationId` for session scope. Global memory rejects project/conversation association; project/session writes require owned scope IDs. Unbound historical session memories are excluded from recall. `write_memory` is an operation, not a scheduled read.

### Governed platform actions and mixed-project management (P1, 2026-09-05)

All paths below are under `/api/v1`, require an active authenticated user and
return the standard `{code,data,message}` envelope. Grant and action handlers
return 400 for schema errors and 409 for rejected actions. Unknown fields and
unsupported grant capabilities are rejected.

| Method/path | Input and returned `data` |
|---|---|
| `GET /copilot/grants` | `{grants,capabilities}`; capabilities contain `id`, `capability`, `effect`. |
| `POST /copilot/grants` | `{name,projectIds,allOperations?,capabilities?,allowedRoots?,expiresAt,maxActions,maxConcurrency?}` → `{grant}`. Expiry is Unix milliseconds; concurrency defaults to 1. |
| `POST /copilot/grants/:id/revoke` | `{grant}`; advances the revision and cancels active bound runs. |
| `DELETE /copilot/grants/:id` | `{deleted:true}`; only revoked grants can be removed from lists. Repeated deletion is idempotent; active grants return 409. Historical bindings and audit references remain. |
| `POST /platform-actions/preview` | `{commandId,input,idempotencyKey,grantId?}` → `{intent}`. No effect is executed. |
| `GET /platform-actions/:id` | `{intent,receipt}`; receipt is null before an outcome exists. |
| `POST /platform-actions/:id/decide` | `{digest,approved}` → `{intent}`. Digest must match the immutable preview. |
| `POST /platform-actions/:id/execute` | `{receipt}`; requires a currently valid approved intent. Duplicate confirmed execution returns the stored receipt. |
| `GET /project-manager/overview?grantId=...` | `{projects,observedAt}`; an unavailable, revoked or expired requested grant returns 403. Omitted grant lists the owner's projects. |
| `PATCH /projects/:id/project-manager/management` | `{expectedRevision,mode?,ownerLabel?,nextAction?,freshnessHours?}` → `{management}`. Mode is `manual` or `cli`; stale revisions conflict. |
| `GET /sessions/:id/writer` | `{sessionId,mode,autonomy}`; mode is `manual` or `automated`, autonomy is currently `manual_only`. |
| `POST /sessions/:id/takeover` | `{sessionId,takenOver}`; invalidates the old automatic writer before manual input resumes. |

Grant scope contains explicit project IDs, capabilities and canonical allowed
roots. Empty project lists mean no existing projects; `project.create` separately
requires a permitted root and does not add the created project to the grant.
Budgets count actions and simultaneous executions, not tokens or money. Delegation
is currently to the same authenticated owner, with no remote actor mapping.

`POST /copilot/conversations` accepts `{title?,grantId?}`; conversation list and
creation responses include `grantId` or null. Message admission may bind a grant
only to an empty unbound conversation. Subsequent turns inherit the immutable
binding, including when `grantId` is omitted; revoked bindings cannot become
unrestricted conversations. Bound model tools, reads and memory recall are
restricted to that scope; global reads and global memory are excluded.

Intents expose snake-case storage fields including `command_id`, `input_json`,
`resources_json`, `grant_revision`, `authority`, `expires_at`, and `digest`.
Authority is `owner_action` or `delegated_grant`; previews expire after at most
15 minutes and no later than grant expiry. Receipts use
`{intentId,outcome,result,createdAt}`, with outcome `confirmed`, `no_effect` or
`unknown`. Unknown external effects remain indeterminate and are not replayed. External
execution claims expire after 30 seconds without their 10-second renewal; expired
claims recover conservatively, while late confirmed receipts retain actual outcomes.
Copilot pending approvals reference this same intent and resume the original run.

The first delegatable commands are `project.create`, `project.metadata.update`,
`pm.work_item.create`, `pm.work_item.metadata`, `pm.task.prepare`,
`pm.management.update`, `memory.write`, `session.start`, and `session.stop`.
Task preparation creates/links an idle session and never launches or submits a
prompt. `pm.task.execute` and `session.dispatch` reject with
`CLI_AUTONOMY_MANUAL_ONLY` before an effect; all four adapters remain manual-only.
Explicit owner lifecycle actions remain available. Persistent Copilot memory
writes use `memory.write`, including the memory-entry HTTP creation endpoint;
automatic post-turn memory curation is disabled.

Overview projects contain `id`, `name`, `management`, `counts`, `goal`,
`evidenceFreshness`, and `autonomy`. Management defaults are manual mode, empty
owner/next action, 72-hour freshness and revision 0 before the first update.
Freshness uses declared evidence timestamps (`source=declared_evidence_timestamp`),
with fresh/stale/unknown counts and nullable `lastObservedAt`; it does not verify
evidence content or infer completion. Selecting CLI planning mode grants no CLI
execution permission. Feishu/Telegram integration and autonomous PM scheduling
remain later phases.


### Terminal Runtime Dependencies

- `GET /api/v1/gate-a/dependencies`

Returns the current host dependency report. Optional AI CLI commands appear in
`data.dependencies`; there is no tmux/psmux dependency probe. `data.terminalRuntime` contains:

```json
{
  "persistence": "session-server",
  "mode": "ready",
  "supported": true,
  "message": "bounded readiness detail"
}
```

`mode` is `ready` or `unavailable`. Readiness checks the bundled terminal
capability; it does not prove a physical-host browser lifecycle. This endpoint
and `forgebadger doctor` remain read-only and install no system software.

### Adapter Discovery

- `GET /api/v1/adapters/discovery`

Returns local AI CLI command discovery for Claude Code, OpenCode, Codex, and
Kimi Code. All four adapters are launch-supported when the corresponding local
command is available. `launchEnabled` is false when the command check fails, and
session creation/start returns `409` before Session Server launch in that case. Every
adapter reports the `terminal` runtime mode; the former Codex
`app-server-stdio`/`app-server-websocket` prototype modes were removed on
2026-08-14.

### Projects

- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/projects/:id`
- `DELETE /api/v1/projects/:id`
- `PATCH /api/v1/projects/:id`
- `POST /api/v1/projects/scan`
- `POST /api/v1/projects/import`
- `POST /api/v1/projects/:id/templates`
- `POST /api/v1/projects/:id/config/preview`
- `POST /api/v1/projects/:id/config/write`
- `POST /api/v1/projects/:id/config/sync/preview`
- `POST /api/v1/projects/:id/config/sync/apply`
- `GET /api/v1/projects/:id/config/compliance`
- `GET /api/v1/projects/:id/ai-config`
- `GET /api/v1/projects/:id/ai-config/global`
- `PUT /api/v1/projects/:id/ai-config/files`
- `GET /api/v1/projects/:id/workspace/tree`
- `GET /api/v1/projects/:id/workspace/file`
- `GET /api/v1/projects/:id/git-changes`
- `GET /api/v1/projects/:id/git-diff`
- `GET /api/v1/projects/:id/git-branches`
- `POST /api/v1/projects/:id/git-checkout`
- `POST /api/v1/projects/:id/generate-config`
- `GET /api/v1/projects/:id/agent-sequence`
- `PUT /api/v1/projects/:id/agent-sequence`
- `POST /api/v1/projects/:id/agents/default-pack`
- `GET /api/v1/projects/:id/skills`
- `POST /api/v1/projects/:id/skills/:skillId`
- `GET /api/v1/projects/:id/graph/overview`
- `GET /api/v1/projects/:id/graph/search`
- `GET /api/v1/projects/:id/graph/symbols/:symbolId`
- `GET /api/v1/projects/:id/graph/symbols/:symbolId/impact`
- `GET /api/v1/projects/:id/graph/file-graph`
- `POST /api/v1/projects/:id/graph/affected`

Import behavior:

- `POST /api/v1/projects/import` registers an existing server directory as a
  project record. It does not delete, move, or rewrite the directory.
- Project create/import is CLI-agnostic: the stored `aiTool` hint stays empty
  until an explicit designation exists. An optional `templateId` in the
  request body binds a tenant template at create/import time; it must exist
  in the tenant or the request fails with `404` `Template not found`. When
  omitted, `templateId` starts as `null`. `PATCH /api/v1/projects/:id` can
  still bind or unbind a template later.
- Config sync preview/apply, like compliance, returns `404` with
  `TEMPLATE_NOT_TRACKED` when the project tracks no template and the request
  supplies no explicit `templateId`.

Template extraction:

- `POST /api/v1/projects/:id/templates` reads the project's AI CLI config
  files — according to the stored `aiTool` hint, or an explicit `adapter` in
  the body (`claude` | `opencode` | `codex` | `kimi`) — and creates a new
  tenant-owned custom template from them. CLI-agnostic projects must pass an
  explicit `adapter`; the request fails with `400` otherwise. Body:
  `{ name, description?, adapter?, bind? }`. On success (201) the response
  carries the created `template`, the `extracted` files (`filePath` +
  `sizeBytes`), and the `skipped` files that were ignored. `bind` defaults to
  `true`, so the project starts tracking the new template; pass
  `bind: false` to create the template without binding it. The request fails
  with `400` when no extractable AI config files exist in the project.

Project graph (read-only CodeGraph index):

- All five endpoints are read-only. The Gateway opens the project's local
  `{projectPath}/.codegraph/codegraph.db` with SQLite `readonly`; it never
  triggers indexing or writes to the index. Indexing stays owned by the user's
  CodeGraph CLI/daemon.
- Degraded states return `200` with
  `{ "available": false, "reason": "not_initialized" | "schema_unsupported" |
  "error" }` so clients can render setup guidance; the Gateway never treats a
  missing third-party index as a server error.
- A configured project path that resolves to a denied system root returns
  `400` ("Invalid project path configuration").
- `GET .../graph/search` accepts `q` (required, 1..100 chars), optional `kind`,
  and optional `limit` (<=50). Queries run through FTS5 phrase escaping plus a
  substring fallback; injection payloads are neutralized into literal text.
- `GET .../graph/symbols/:symbolId/impact` walks reverse call/reference edges
  as a recursive CTE bounded to `depth <= 3` and 500 affected nodes.
- `GET .../graph/file-graph?limit=` aggregates cross-file imports/references
  into file-level dependency pairs, keeping the top-N highest-degree files
  (`limit <= 200`) and flagging truncation. Each edge carries a per-kind
  weight breakdown so clients can filter by relation type.
- `POST .../graph/affected` takes `{ paths: string[1..50], depth?: 1..3 }`
  (project-relative changed paths, typically from git status), seeds with every
  symbol defined in those files, and returns the reverse call/reference closure
  plus `seededFiles`/`seededSymbols` counters. Traversal segments (`..`) and
  absolute paths are rejected with 400. This powers the Web "Change impact"
  view.
- Symbol ids are opaque CodeGraph node identifiers (`<kind>:<hash>`); clients
  must treat them as opaque strings and URL-encode them.
- Responses carry project-relative file paths only.

Project template binding:

- `PATCH /api/v1/projects/:id` updates the project's template tracking
  relationship. The body accepts an optional `templateId` field with three
  states: omitted (leave the binding unchanged), explicit `null` (untrack the
  project — the record keeps its files untouched and becomes "independent
  config"), or a non-empty template id (switch/bind to that template; the
  template must exist and belong to the same user, otherwise `404`).
- Untracking is a platform-level relationship change only: it never deletes,
  overwrites, or rolls back any project file. Untracked projects are excluded
  from the template usage list and from template bulk sync (preview/apply).
- `GET /api/v1/projects/:id/config/compliance` returns `404` with a
  `TEMPLATE_NOT_TRACKED` error code in `details` when the project tracks no
  template and no explicit `templateId` query parameter is supplied.

Config conflict behavior:

- `conflictType: "exists"` means the existing file content is byte-identical to
  the generated file. Config writes auto-skip this case when no explicit
  decision is supplied.
- `conflictType: "modified"` means the target file differs. Gateway returns
  `409` until the caller supplies an explicit `skip` or `overwrite` decision.
- `conflictType: "unsafe_path"` is always blocking and cannot be overridden.

Config generation uses the project adapter:

- Claude Code projects write `.claude/CLAUDE.md`, `.claude/agents/*`, and
  `.claude/skills/<skill-name>/SKILL.md`.
- OpenCode projects adapt the shared instructions into root `AGENTS.md`,
  `.opencode/agents/*`, `.opencode/commands/*`, and
  `.opencode/skills/<skill-name>/SKILL.md`.
- Codex projects adapt the shared instructions into root `AGENTS.md`,
  `.codex/config.toml`, `.codex/agents/*`, and
  `.agents/skills/<skill-name>/SKILL.md`.

Project config sync endpoints reuse the same render plan, conflict detection,
backup, rollback, and skip/overwrite semantics as config write. Sync preview
can use the project's saved `templateId` when no explicit template is provided
and returns a summary of missing, identical, modified, unsafe, and
decision-required files. Sync apply records a `config_sync` activity.
Sync apply also writes a tenant-scoped `project.config_sync` audit row with the
template id and file outcome counts.

Project config compliance:

- `GET /api/v1/projects/:id/config/compliance` is a read-only report intended
  for the Web project detail page and CI scripts.
- Query parameters are optional: `templateId` overrides the project's saved
  template and `credentialMode` defaults to `host_environment`.
- When the project tracks no template and no explicit `templateId` query is
  given, Gateway returns `404` with `message` describing the untracked state
  and `details.code: "TEMPLATE_NOT_TRACKED"` so clients can render the
  "independent config" state instead of a generic error.
- The response includes `compliance`, `conflicts`, and generated file hashes.
  `compliance.status` is `compliant` only when there are no missing, modified,
  unsafe, or stale generated files.
- `staleFiles` are generated config files that exist locally but differ from
  the current render plan. They are also listed in `modifiedFiles` and require
  an explicit sync decision before Gateway will overwrite them.

Project AI config management:

- `GET /api/v1/projects/:id/ai-config` returns editable project-level config
  files for the selected adapter. Only common root-level files are managed:
  `CLAUDE.md`, `AGENTS.md`, `AGENTS.override.md`, `opencode.json`,
  and `opencode.jsonc`. Files under `.claude`, `.opencode`, `.codex`, and
  `.kimi-code` directories are not discovered, listed, or writable through this
  API.
- All three endpoints accept an optional `aiTool` query parameter (body field
  for the write route) with values `claude` | `opencode` | `codex` | `kimi`.
  For CLI-agnostic projects (the default for new records) the parameter is
  required and Gateway returns `400` when it is missing.
- `GET /api/v1/projects/:id/ai-config/global` returns read-only global config
  files from the matching local tool config root. Sensitive values are redacted
  before the response leaves Gateway.
- `PUT /api/v1/projects/:id/ai-config/files` writes one approved project config
  file by safe relative path. Only root-level files listed above are accepted;
  any other path (including traversal attempts and files under the CLI config
  directories) is rejected with `400`. It never writes outside the project root
  and does not modify global user config.
- The response contains only the file list; it carries no form/field metadata.
  The Web console renders each file with its raw content editor only.

Project workspace context:

- `GET /api/v1/projects/:id/workspace/tree` returns a read-only file tree
  rooted at the tenant-scoped project path. Optional query parameters are
  `path`, `depth` (1-3), and `limit` (1-500). The response includes safe
  project-relative POSIX paths, file sizes, update timestamps, and a `truncated`
  marker when the limit is reached.
- `GET /api/v1/projects/:id/workspace/file?path=<relative-path>` returns a
  bounded UTF-8 preview for one regular text file under the project root. The
  response includes `content`, `sizeBytes`, `truncated`, and `binary: false`.
- Workspace context routes reuse the same safe path boundary as config writes:
  project roots under sensitive system roots are rejected, absolute paths and
  traversal are rejected, and symbolic-link targets are not followed for tree
  traversal or file reads.
- `GET /api/v1/projects/:id/git-changes` returns the project's git state for
  the session side panel: `{ isGitRepo, branch?, changed, commits }` with
  working-tree entries (porcelain status + staged flag, capped at 200) and up
  to 15 recent commits. Git is invoked via `execFile` with the tenant-scoped
  project path as cwd (no shell interpolation, 5 s timeout, optional locks
  disabled); non-git directories return `isGitRepo: false` instead of an error.
- `GET /api/v1/projects/:id/git-diff?path=<relative-path>&untracked=0|1`
  returns the unified diff (`git diff HEAD -- <path>`, falling back to staged +
  unstaged diffs when the repo has no commits) for one tracked file, capped at
  200 KB with a `truncated` flag. With `untracked=1` it returns the file
  preview through the workspace safe-path boundary instead (git has no diff
  for untracked files). Paths are validated segment-by-segment; absolute paths
  and `..` traversal are rejected.
- `GET /api/v1/projects/:id/git-branches` returns
  `{ isGitRepo, current, branches, workingTree }`: the current branch (`null`
  on detached HEAD), local branches with an `isCurrent` marker, and a
  working-tree summary `{ clean, changedCount, sample }` (up to 5 changed
  paths) so clients can warn before a checkout.
- `POST /api/v1/projects/:id/git-checkout` switches the working tree to a
  branch, body `{ branch, create? }`. With `create: true` the branch is
  created from HEAD first (`git switch -c`). The project root is re-validated
  (`validateProjectRoot`) and branch names are checked with
  `git check-ref-format --branch` (leading `-` rejected up front). Switching
  is refused when the working tree has any uncommitted change (tracked or
  untracked): `409` with `details: { changedCount, sample }`. Other failures:
  `400` invalid name / not a git repository, `404` branch not found, `409`
  branch already exists on `create: true`. Success returns
  `{ projectId, current, created }`.
- These routes are read-only except `git-checkout`. They do not store file
  contents, terminal scrollback, or evidence blobs in SQLite; later Project
  Manager evidence uses bounded references to these paths rather than copying
  raw content.

CI usage example:

```bash
curl -fsS \
  -H "Authorization: Bearer $FORGEBADGER_TOKEN" \
  "http://127.0.0.1:48731/api/v1/projects/$PROJECT_ID/config/compliance" \
  | jq -e '.data.compliance.status == "compliant"'
```

Project Agent orchestration:

- `GET /api/v1/projects/:id/agent-sequence` returns the tenant-scoped ordered
  Agent sequence for a project.
- `PUT /api/v1/projects/:id/agent-sequence` accepts:

```json
{
  "agentIds": ["agent-id-1", "agent-id-2"]
}
```

- The Gateway rejects duplicate Agent ids, Agents owned by another user, and
  Agents attached to another project.
- This is a planning and visibility primitive only. It stores display order for
  a project's Agents; it does not automate multi-Agent execution.
- `POST /api/v1/projects/:id/agents/default-pack` creates the default
  six-Agent project pack from built-in Agent templates and stores the default
  orchestration order. Re-running the endpoint is idempotent by Agent name and
  returns skipped existing Agents instead of duplicating them.

### Sessions

- `GET /api/v1/sessions`
- `POST /api/v1/sessions`
- `GET /api/v1/sessions/board`
- `GET /api/v1/sessions/:id`
- `PUT /api/v1/sessions/:id/last-prompt`
- `POST /api/v1/sessions/:id/connect`
- `POST /api/v1/sessions/:id/start`
- `POST /api/v1/sessions/:id/stop`
- `DELETE /api/v1/sessions/:id`

Create body:

```json
{
  "projectId": "project-id",
  "aiTool": "codex"
}
```

Sessions launch an explicitly selected runtime CLI: the request body carries
`aiTool` (`claude` | `opencode` | `codex` | `kimi`), and projects without a
stored adapter hint reject creation with `400` when `aiTool` is omitted.

Session launch is model-agnostic: sessions always run with host-environment
credentials, and ForgeBadger injects no provider, model, or credential
environment at launch. Model/provider setup is per-CLI and user-global
(cc-switch style) through the CLI Config API below; each CLI process reads its
own global config files when it starts. `POST /:id/start` re-launches the
adapter the same way and never restores a ForgeBadger-managed provider
environment.

`PUT /api/v1/sessions/:id/last-prompt` persists the last prompt submitted to a
session so read-only surfaces (session lists, board) can label it. Body:

```json
{ "prompt": "修一下登录页" }
```

The prompt is trimmed and must be non-empty (`400` otherwise); values longer
than 500 characters are truncated to 500. The session must belong to the
caller (`404` otherwise). The response is `{ code: 0, data: { session } }`
with the stored `lastPrompt` on the session payload; repeated writes are
idempotent.

`GET /api/v1/sessions/board` returns the session board aggregation in one
request: `{ code: 0, data: { board } }` where `board` contains the caller's
`projects` (project repository shape), all `sessions` (standard session
payload including `projectName` and `lastPrompt`), and `sessionTasks`, a map
from session id to at most 10 linked Project Manager work item summaries
(`{ id, title, status, priority, projectId, updatedAt }`, ordered by
`updatedAt` descending). A work item is linked when its task-packet details
embed `taskPacket.sessionId`; only links to the caller's own sessions are
returned, and work items with unparseable details are skipped.

### CLI Config and Provider Apply

cc-switch style management of each code CLI's global config files
(Kimi `~/.kimi-code/config.toml`, Claude `~/.claude/settings.json`,
Codex `~/.codex/config.toml` + `~/.codex/auth.json`,
OpenCode `$XDG_CONFIG_HOME/opencode/opencode.json`;
`KIMI_CODE_HOME` / `CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `OPENCODE_CONFIG_DIR`
overrides are honored):

- `GET /api/v1/cli-config/adapters`
- `GET /api/v1/cli-config/:adapter`
- `GET /api/v1/cli-config/:adapter/file?path=<name>`
- `PUT /api/v1/cli-config/:adapter/file` — raw file write (whitelisted file names, 128 KB cap, atomic write, mode `0600`)
- `GET /api/v1/cli-config/:adapter/fields` — static curated field schema
- `GET /api/v1/cli-config/:adapter/field-values` — current values with secrets redacted
- `PATCH /api/v1/cli-config/:adapter/fields` — body `{ "updates": { "<fieldKey>": value | null } }`; `null` deletes the key, unknown keys / enum / type mismatches are rejected before any write, and an empty `updates` object is a no-op that does not rewrite (and reformat) the file
- `PUT /api/v1/cli-config/:adapter/providers/:providerId`
- `DELETE /api/v1/cli-config/:adapter/providers/:providerId`
- `PUT /api/v1/cli-config/:adapter/models` — body carries `alias` (Kimi only; aliases may contain `/`)
- `DELETE /api/v1/cli-config/:adapter/models` — body carries `alias`
- `PUT /api/v1/cli-config/:adapter/default-model`
- `POST /api/v1/cli-config/:adapter/apply-provider/preview`
- `POST /api/v1/cli-config/:adapter/apply-provider`
- `POST /api/v1/cli-config/:adapter/rollback`

`/adapters` and `/:adapter/fields` expose only static non-sensitive metadata.
Every other operation reads or writes the shared host-global CLI config root
and therefore requires instance-admin authority. Raw file reads are always
redacted and `reveal=1` is removed/rejected.

For Claude Code, a configured `anthropicBaseUrl` takes precedence and is
applied directly, without requiring Gateway routing to be enabled, even when
an older client sends `routeThroughGateway: true`. Legacy providers with
`apiFormat: "anthropic"` and `baseUrl` also connect directly. Providers with
only an OpenAI / OpenAI-compatible endpoint require Gateway routing. A
successful direct apply clears the previous Claude routing assignment while
preserving the user's routing-enabled preference.

Provider apply maps a Model Center provider profile (plus a model profile and
credential) onto the adapter's native config format. Preview and apply share
the same body:

```json
{
  "providerProfileId": "provider-profile-id",
  "modelProfileId": "model-profile-id",
  "credentialId": "credential-id",
  "modelMapping": { "opus": "model-profile-id", "sonnet": "...", "haiku": "...", "fable": "...", "subagent": "..." },
  "reasoningEffort": "high"
}
```

Model selection is adapter-specific (cc-switch parity):

- **Claude**: `modelProfileId` is the primary model (`ANTHROPIC_MODEL`).
  `modelMapping` pins the alias roles `opus` / `sonnet` / `haiku` (unset roles
  fall back to the primary model) plus the optional `fable` / `subagent` slots;
  every value must be a model profile owned by the provider. The deprecated
  `ANTHROPIC_SMALL_FAST_MODEL` is removed, never written, and the official
  `ANTHROPIC_DEFAULT_<ROLE>_MODEL_NAME` display names are maintained alongside.
- **Codex**: `modelProfileId` selects `model`; `reasoningEffort`
  (`minimal|low|medium|high`) is written as `model_reasoning_effort` and
  removed when omitted. `modelMapping` is rejected.
- **OpenCode**: apply is additive — the provider entry is upserted with all
  active models of the provider, and the user-owned top-level `model` key is
  never touched. `modelProfileId` is ignored.
- **Kimi**: `modelProfileId` selects `default_model`.

`modelProfileId` defaults to the provider's default model and `credentialId`
to its first active credential. Preview returns `{ preview }` with per-file
`targetPath`, redacted `current`/`proposed` content, `changedFields`, and
`warnings`, without touching disk; per-file `operation` is one of
`create | update | delete | none` (`delete` applies to a Codex `auth.json`
whose last managed field was removed — Codex errors on an empty `auth.json`
but shows the login screen when the file is missing). Apply validates the
provider base URL
through the SSRF guard, takes an exclusive cross-process target lock, writes
an AES-256-GCM-encrypted backup under the state directory, then atomically
writes each target file with mode `0600` — including the plaintext credential,
matching each CLI's native config format. Unsafe targets (for example
symlinks) are rejected
before any write, and a multi-file failure rolls back the files already
written. Apply returns `{ result: { adapter, backupId, changed, files } }`.
Rollback accepts an optional `{ "backupId": "..." }` and restores the given (or
latest) backup, returning `{ result: { adapter, backupId, restoredFiles } }`.

### Codex Provider Notes

For Claude Code sessions, both create and restart paths merge ForgeBadger command
hooks into `.claude/settings.local.json` before Session Server launch.

OpenAI is a normal verified provider. Applying a provider to Codex writes
`model`, `model_provider`, and a `model_providers.<id>` entry with `base_url`,
`wire_api = "responses"`, and `experimental_bearer_token` (the API key) into
`~/.codex/config.toml` — the cc-switch Codex 0.149+ layout, where third-party
credentials live in the provider table. The legacy `OPENAI_API_KEY` slot is
removed from `~/.codex/auth.json` (other existing `auth.json` fields such as
ChatGPT login tokens are preserved); an `auth.json` left empty by that removal
is deleted outright. Provider/model configuration is user-global because
Codex does not permit those keys to be overridden by project configuration.
The retired `/api/v1/codex/subscription/**` route is not mounted and returns the
normal 404 behavior.

### Models

The legacy `/api/v1/models` endpoint and its flat `models` table were removed
in the two-model-system unification. `model_profiles` (owned by a provider
profile) is now the single source of truth for models, and every table that
references a model (`sessions.model_id`, `user_settings.model_id`,
`model_cost_rates.model_id`) points at `model_profiles.id`. Manage models
through the Model Providers API below; `GET /api/v1/model-providers` returns
the full provider/profile/model/credential inventory.

### Model Providers

- `GET /api/v1/model-providers/capabilities`
- `GET /api/v1/model-providers`
- `POST /api/v1/model-providers`
- `PATCH /api/v1/model-providers/:id`
- `DELETE /api/v1/model-providers/:id` — typed `409
  PROVIDER_IN_USE_BY_SESSION` takes precedence over
  `PROVIDER_IN_USE_BY_BINDING`; active and revoked references remain intact.
- `GET /api/v1/model-providers/:id/models`
- `POST /api/v1/model-providers/:id/models`
- `PATCH /api/v1/model-providers/:id/models/:modelId`
- `DELETE /api/v1/model-providers/:id/models/:modelId` — typed `409
  MODEL_IN_USE_BY_SESSION` takes precedence over `MODEL_IN_USE_BY_BINDING`.
- `POST /api/v1/model-providers/:id/models/sync`
- `GET /api/v1/model-providers/applied`
- `GET /api/v1/model-providers/applied/:adapter`
- `GET /api/v1/model-providers/:id/balance`
- `POST /api/v1/model-providers/:id/balance`

Model sync fetches the provider's model list through its OpenAI-compatible
`/v1/models` endpoint (version-segment aware, so bases like
`https://api.z.ai/api/paas/v4` resolve to `/paas/v4/models`). Authentication
follows the provider's API format: Anthropic-format providers send
`x-api-key` + `anthropic-version`, Google-format providers send
`x-goog-api-key`, and everything else sends `Authorization: Bearer`.
Anthropic-format responses are paginated (`has_more`/`last_id` cursors,
bounded at 20 pages) so full model inventories are collected. Sync only adds
missing models; existing model profiles are left untouched. When the
provider's model list reports a context size (`context_length`,
`context_window`, `max_context_length`, or `max_input_tokens`), sync fills it
into the created model profile's `contextWindow` — Claude applies then inject
it as `CLAUDE_CODE_MAX_CONTEXT_TOKENS`/`CLAUDE_CODE_AUTO_COMPACT_WINDOW`.

`POST /api/v1/model-providers/:id/balance` checks the remaining balance or
subscription quota for providers with a known endpoint, detected from the
provider base URL host. Balance endpoints: DeepSeek, StepFun, SiliconFlow,
OpenRouter, Novita AI. Coding-plan quota windows: Kimi For Coding
(`limits[].detail` 5-hour window + `usage` weekly window) and MiniMax
(`coding_plan/remains`, general bucket 5-hour/weekly remaining percentages).
Quota entries may carry `limit` and `resetsAt`. The request body accepts an
optional `credentialId` and `timeoutMs`; the credential is decrypted only in
memory. The response is `{ supported, detectedProvider?, balances: [{ label,
remaining, unit, isAvailable?, limit?, resetsAt? }], checkedAt }`;
unsupported providers return `supported: false` with an empty list, and
upstream failures return `502` with a redacted message.

`GET /api/v1/model-providers/:id/balance` is the polling-friendly read twin:
it serves a 60-second in-memory cache per user and provider (marked
`cached: true` on a hit), while `POST` always queries upstream and repopulates
the cache. Both share the balance probe rate limit.

`GET /api/v1/model-providers/applied/:adapter` returns the provider last
applied to that adapter's global CLI config via
`/api/v1/cli-config/:adapter/apply-provider`, read from the per-user
`cli_config_applied_providers` pointer (written on apply, cleared on rollback,
cascade-deleted with the provider). The response is `{ appliedProvider:
{ providerProfileId, providerName, providerStatus, modelProfileId, appliedAt }
| null }`; it requires only authentication (not instance admin) so the session
sidebar can render the provider quota module.

`GET /api/v1/model-providers/applied` is the aggregate read twin: it returns
all four adapters (`claude`/`opencode`/`codex`/`kimi`) in one call as
`{ adapters: [{ adapter, applied, configDefaultModel, stale }] }`, where
`applied` extends the single-adapter payload with `modelId`/`modelName`
(nullable when the pointer references a deleted provider or model, which also
forces `stale: true`). For instance admins the response additionally compares
each adapter's CLI config `defaultModel` against the pointer (Kimi's
`<providerKey>/<modelId>` form is compared by its model segment) and sets
`stale: true` on mismatch; non-admins always receive `configDefaultModel: null`
and `stale: false`. Authentication only; never fails on unreadable CLI configs.

The retired provider-level `preview-apply`/`apply` routes are no longer
mounted and return the normal 404 behavior.

Provider profiles own metadata, models, and encrypted credentials. Applying a
provider to a CLI's global config files goes through
`/api/v1/cli-config/:adapter/apply-provider` (see above). The capabilities
endpoint is the server source of truth for adapter compatibility across all
four CLIs. Historical `PROVIDER_IN_USE_BY_BINDING` /
`MODEL_IN_USE_BY_BINDING` conflicts can still be returned for rows referenced
by pre-decoupling records; those references remain intact.

The web console ships a static, client-side list of provider presets
(endpoints, auth type, API format) that prefill the add-provider form,
cc-switch style. Presets never carry model lists, there is no server-side
preset catalog API, and no models are seeded at creation — the model list is
always synced live from the configured provider endpoint.

Creating a Provider Profile:

```json
{
  "name": "Local Gateway",
  "providerKey": "local-gateway",
  "baseUrl": "https://gateway.example.com/v1",
  "authType": "api_key",
  "apiFormat": "anthropic",
  "supportedAdapters": ["claude"]
}
```

`name`, `providerKey`, `authType`, and `apiFormat` are required; at least one
of `baseUrl` / `openaiBaseUrl` / `anthropicBaseUrl` should be supplied for
model sync to work.

Model sync uses the selected Provider Profile's OpenAI-compatible base URL; an
Anthropic-format provider uses its Anthropic base URL instead. It uses the
saved credential and fails with an error instead of falling back to built-in
defaults when the model-list endpoint cannot be fetched.
Plaintext credentials are decrypted only inside Gateway memory for the
outbound provider request.

### API Keys And Credential Mode

- `GET /api/v1/api-keys`
- `POST /api/v1/api-keys`
- `POST /api/v1/api-keys/:id/rotate`
- `DELETE /api/v1/api-keys/:id`

Create body:

```json
{
  "provider": "anthropic",
  "name": "Claude Key",
  "plaintextKey": "sk-..."
}
```

Rotate body:

```json
{
  "plaintextKey": "sk-..."
}
```

API key responses must never include `plaintextKey` or encrypted ciphertext.
Plaintext is accepted only on create/rotate requests, encrypted with
AES-256-GCM at rest, and discarded after use.

Sessions always launch with host-environment credentials; no credential mode is
recorded or selectable at launch. Deleting a referenced provider
credential returns a disposition. Unreferenced credentials are physically
`deleted`; session-referenced credentials are `revoked`, remain addressable for
provenance, and make future start/recovery fail before decryption until the
credential is explicitly rotated/reactivated. Rotation increments the
credential generation; a running CLI environment is not mutated.

### Templates

- `GET /api/v1/templates`
- `GET /api/v1/templates/builtins`
- `GET /api/v1/templates/:id`
- `POST /api/v1/templates`
- `POST /api/v1/templates/:id/clone`
- `PUT /api/v1/templates/:id`
- `PUT /api/v1/templates/:id/files/*`
- `GET /api/v1/templates/:id/export`
- `POST /api/v1/templates/import`
- `POST /api/v1/templates/import/git`
- `GET /api/v1/templates/:id/versions`
- `POST /api/v1/templates/:id/versions/:versionId/restore`
- `GET /api/v1/templates/:id/usage`
- `POST /api/v1/templates/:id/sync/preview`
- `POST /api/v1/templates/:id/sync/apply`
- `DELETE /api/v1/templates/:id`

Built-in templates are read-only. Clone creates a tenant-owned custom template
that can be edited and applied to projects. Template file writes use the same
path safety and conflict pipeline as project config generation.
Custom templates may carry `visibility: "private" | "shared" | "admin"`.
Private remains the default; shared templates are readable by other users; admin
templates are readable by their owner and users with `role = "admin"`. Mutation
and deletion remain owner-scoped.
Version restore is owner-scoped, rejects built-in templates, snapshots the
current custom template state as `template.restore`, then replaces metadata and
files from the selected history record.
`usageCount` on template responses is derived in real time from the tenant's
projects referencing the template (`COUNT(projects WHERE template_id)`) rather
than a stored counter.
`GET /api/v1/templates/:id/usage` returns the projects using a template with a
per-project config status: `compliant`, `stale` (files differ from the
template), or `missing` (no generated files).
`POST /api/v1/templates/:id/sync/preview` dry-runs rendering the template for
one or more projects (optional `projectIds`, max 20) and reports missing,
identical, modified, and unsafe files per project without writing to disk.
`POST /api/v1/templates/:id/sync/apply` writes the template files into the
selected projects, applying per-project `decisions` (`skip`/`overwrite`) for
conflicting paths; each project is applied independently and failures are
reported per project. Results are recorded in the audit log and a
`template.config_sync` activity.
`POST /api/v1/templates/import/git` imports a template from a public Git
repository. The Gateway shallow-clones the `url` (optional `branch`, default
branch when omitted) into a temporary directory, reads every text file from
it, infers the `adapter` from well-known config filenames, and creates a
tenant-owned custom template. The template is named after the repository
unless a `name` is supplied; `description` is optional. Body:
`{ url, branch?, name?, description? }`. Files that are binary, larger than
512 KiB, beyond a 5 MiB total, or past the 500-file cap are skipped rather
than failed. On success (201) the response carries `{ templateId, name,
adapter, fileCount, skippedFiles }`. Clone or URL errors return `400`; a
repository that contains no importable files returns `404`.

### Agents

- `GET /api/v1/agents`
- `GET /api/v1/agents/templates`
- `POST /api/v1/agents`
- `GET /api/v1/agents/:id`
- `PUT /api/v1/agents/:id`
- `DELETE /api/v1/agents/:id`

`GET /api/v1/agents/templates` returns static quick-create templates for
planner, backend, frontend, reviewer, and test-writer roles. Templates are
form seeds only; creating an Agent still uses `POST /api/v1/agents` and the
caller may edit all generated fields before saving.

Agent rows are tenant scoped. `projectId` and `modelId` references are validated
against the current user. Active project Agents are rendered into the adapter
agent directory during project config generation: `.claude/agents/*.md`,
`.opencode/agents/*.md`, or `.codex/agents/*.md`.

### Skills

- `GET /api/v1/skills`
- `GET /api/v1/skills/sources`
- `GET /api/v1/skills/templates`
- `POST /api/v1/skills/local-sync`
- `POST /api/v1/skills`
- `POST /api/v1/skills/install/preview`
- `POST /api/v1/skills/install`
- `GET /api/v1/skills/:id`
- `PUT /api/v1/skills/:id`
- `DELETE /api/v1/skills/:id`
- `POST /api/v1/skills/:id/toggle`
- `GET /api/v1/projects/:id/skills`
- `POST /api/v1/projects/:id/skills/:skillId`

Global Skill enablement controls whether the Skill is generally active.
Project Skill enablement controls whether it is rendered into the adapter skill
directory during config generation. Claude Code uses
`.claude/skills/<skill-name>/SKILL.md`; OpenCode uses
`.opencode/skills/<skill-name>/SKILL.md`; Codex uses the agent-compatible
`.agents/skills/<skill-name>/SKILL.md` location. Skill content is treated as
text when rendered by React and when written to config files.
Skills may carry `visibility: "private" | "shared" | "admin"`. Shared Skills
are readable by other users; admin Skills are readable by their owner and users
with `role = "admin"`. Owner-scoped write checks remain unchanged.

Skill source management currently exposes Local, ClawHub, and GitHub source
definitions. Install creates a tenant-owned Skill row using either supplied
content, source-specific starter content, or a previewed remote source.
Remote preview accepts `{ sourceId, url, skillId?, timeoutMs? }`, fetches either
a ClawHub/GitHub-style manifest or raw `SKILL.md` with timeout and size limits,
validates the Skill name, and returns content plus provenance. Remote and
catalog-installed Skills are stored disabled by default; users must explicitly
enable them before project rendering or session use.

`GET /api/v1/skills/templates` returns static quick-create templates for plan,
review, verify, debug, and release workflows. Each template includes a Skill
name, title, description, source, version, and full `SKILL.md` content. The Web
console uses these records only to prefill the create form; it does not create a
Skill until the user saves.

`GET /api/v1/skills` also performs a best-effort local discovery pass before
returning the tenant Skill list. Discovery scans user-level Claude Code Skills
from `${CLAUDE_CONFIG_DIR:-~/.claude}/skills` and agent-compatible Skills from
`${AGENTS_HOME:-~/.agents}/skills`. ForgeBadger does not scan project ancestors,
command directories, OpenCode directories, Codex directories, plugin caches, or
plugin marketplace checkouts by default; use `FORGEBADGER_SKILL_DIRS` with a
platform path-delimited list when additional roots should be imported explicitly. Discovered
`SKILL.md` files are synced as `source: "local"`. Existing local Skills with
the same name have description, version, and content refreshed while preserving
enablement state; non-local Skills with the same name are left untouched. The
response includes a `discovery` summary with scanned roots and
created/updated/skipped counts.
`POST /api/v1/skills/local-sync` runs the same discovery explicitly for the Web
console rescan action.

### Remote Catalogs

- `GET /api/v1/catalog/sources`
- `GET /api/v1/catalog/items`
- `POST /api/v1/catalog/refresh`
- `POST /api/v1/catalog/items/:id/install`

Catalog refresh accepts `{ type, sourceId, label, url, timeoutMs? }`, fetches a
remote manifest with timeout and size limits, stores source refresh metadata,
and stores Skill or template catalog item metadata separately from installed
local content. Refresh never installs a Skill or imports a template; install
remains an explicit user action.

Template catalog items use `itemType: "template"` and carry a `templatePackage`
metadata object with the same shape as template export/import packages.
`POST /api/v1/catalog/items/:id/install` imports a tenant-owned custom template
from a template catalog item. Catalog item reads and installs are tenant
scoped.

Skill catalog items use `itemType: "skill"` and carry a `skillPackage`
metadata object with name, description, version, and content. Install creates a
tenant-owned Skill row with `source: "catalog:<sourceId>"`.

### Audit Logs

- `GET /api/v1/audit-logs`

Query parameters:

- `action` filters to one action.
- `resourceType` filters to one resource type.
- `resourceId` filters to one resource id.
- `limit` returns 1 to 200 rows, defaulting to 50.

Audit logs are tenant scoped. Current audited actions include
`template.restore`, `project.config_sync`, `copilot.pending_action.approve`, and
`copilot.pending_action.reject`.
Template version audit rows are sanitized on read: ForgeBadger returns template
metadata, `fileCount`, and file paths, but not raw template file contents.
Copilot pending-action audit rows store redacted action input, the acting user
id, and bounded result details under `resourceType=copilot_run`.

### Notifications

- `GET /api/v1/notifications`
- `POST /api/v1/notifications/:id/read`
- `POST /api/v1/notifications/read-all`
- `DELETE /api/v1/notifications`

Query parameters:

- `category` filters the list to `session_event` (session lifecycle and AI CLI
  hook notifications) or `app_action` (user-initiated app action results such
  as apply-provider and provider model sync). Omit it to return all
  notifications.

Notifications are tenant-scoped and persisted in SQLite. Gateway stores session
lifecycle events, accepted AI CLI hook notifications from Claude Code,
OpenCode, Codex, and Kimi Code (permission prompts and denials, task
completion/interruption/failure, session end), and app action results before
broadcasting them on
`/ws/events`. The Web console uses these APIs to hydrate notification history
after reload, persist read state, mark all notifications read, and clear the
current user's notification list. AI CLI notification payloads include normalized
`notification_type`, `adapter`, `project_id`, `project_name`, `session_id`, and
`session_name` context. App action notifications carry `category=app_action`,
no session context (`sessionId` is null), and an `action`
(`apply_provider`/`model_sync`), `status`, `title_key`, and message in their
payload; they are also pushed live as `app_action_notification` events on
`/ws/events`.

The built-in Claude Code template writes `.claude/settings.json` hooks for
`PermissionRequest`, `PermissionDenied`, and `Notification(permission_prompt)`.
Session create and restart merge ForgeBadger hooks into
`.claude/settings.local.json` before starting Claude Code, so imported projects
can receive permission, `Stop`, and `SessionEnd` notifications even before a
manual template sync. OpenCode project plugins subscribe to `permission.asked`,
`session.idle`, and `session.error`. Codex project hooks subscribe to
`PermissionRequest`, `Stop`, and `SessionEnd`; Codex may require one-time hook
trust approval through `/hooks`. Kimi project hooks subscribe to
`PermissionRequest`, `Stop`, `Interrupt`, `StopFailure`, `SessionEnd`, and
`Notification(task.completed)`.
ForgeBadger bounds generated Codex `SessionEnd` handlers to Codex's three-second
maximum and aborts their local Gateway forwarding request after 2.5 seconds;
other generated Codex handlers retain a five-second timeout.
Claude hooks use `http` handlers and send the raw Claude hook payload as JSON
to ForgeBadger; Codex and Kimi use managed command scripts, while OpenCode uses a
managed plugin whose Gateway request aborts after 4.5 seconds. Headers interpolate
`FORGEBADGER_SESSION_ID` and
`FORGEBADGER_ATTACH_TOKEN` from the Session Server launch environment. The endpoint also
accepts the legacy wrapper payload used by older command-hook templates.

### Activities

- `GET /api/v1/activities`

Query parameters:

- `sessionId` filters to a single session.
- `projectId` filters to a single project.
- `agentId` filters to activities from sessions currently linked to an Agent.
- `limit` returns 1 to 200 rows, defaulting to 50.

Activities are tenant-scoped structured operation rows for session launch,
start, stop, reconnect, delete, model switch, config write, permission prompt,
permission denial, and adapter error events.
They intentionally do not store terminal scrollback; terminal pane history
remains in the Session Server.

### Session Snapshots

- `GET /api/v1/snapshots`
- `POST /api/v1/snapshots/:id/restore`

Query parameters:

- `sessionId` filters snapshots to a session.
- `projectId` filters snapshots to a project.

Snapshots are tenant-scoped structured metadata records for
Session Server-backed session state: session, project, daemon session name,
selected model, selected Agent, and
optional config version. Snapshot metadata is sanitized and must not contain
terminal scrollback; terminal pane history remains in the selected runtime.

Snapshot restore is explicit and tenant-scoped. When the recorded daemon
session still exists, ForgeBadger reattaches the database session to that session and
returns `mode: "attach_runtime"` without rotating the existing session attach
token. API responses use `runtimeSessionName`; storage uses
`runtime_session_name`. Old field aliases are not returned. When the Session Server no longer
has the recorded session, ForgeBadger recreates a new Session Server-backed session
from the snapshot's project/model/Agent metadata plus any credential and API key
metadata still available on the original session record. If the original session record is unavailable, restore falls back to the
snapshot metadata and `host_environment` credentials. Restore returns
`mode: "recreate_session"` and never writes terminal scrollback to SQLite.

### Usage Analytics

- `GET /api/v1/usage/summary`
- `GET /api/v1/usage/rates`
- `PUT /api/v1/usage/rates/:modelId`

Usage summary aggregates tenant-owned session duration by adapter, project, and
model. Optional per-model rates are user-configured hourly rates. Cost fields
are labeled `estimated` and are duration-based only; ForgeBadger does not claim
provider token billing accuracy from this endpoint.

### Session Hooks

- `POST /api/v1/session-hooks/claude-notification`
- `POST /api/v1/session-hooks/claude-notification/:sessionId`

This unauthenticated endpoint is for ForgeBadger-generated AI CLI hooks: Claude
Code HTTP hooks, the OpenCode notification plugin, Codex hooks, and Kimi hooks.
All integrations are materialized by the Gateway on session create/restart. It requires
`X-ForgeBadger-Session-Token` to match the session attach token and accepts
either legacy `{ sessionId, event }` payloads or raw Claude Code hook JSON sent
by Claude Code HTTP hooks / the OpenCode plugin. The session id may be supplied
in the path or `X-ForgeBadger-Session-Id`. The payload may carry an optional
`adapter` field (`"claude"` by default; other integrations send `"opencode"`,
`"codex"`, or `"kimi"`). Accepted hook payloads are normalized to
`permission_prompt`, `permission_denied`, `task_completed`, `task_interrupted`,
`task_failed`, or `session_ended` and emit a user-scoped `claude_notification` event on
`/ws/events`.

### External MCP Endpoint

- `POST /mcp` (MCP Streamable HTTP, JSON-RPC; not part of `/api/v1`)
- `POST /api/v1/mcp/tokens`
- `GET /api/v1/mcp/tokens`
- `DELETE /api/v1/mcp/tokens/:id`

The Gateway can expose a Model Context Protocol server for external AI agents
(Claude Code, Kimi Code, Cursor, …). It is mounted only when
`FORGEBADGER_MCP_ENABLED=true`; otherwise `/mcp` and the token routes return
`404`. The transport is Streamable HTTP in stateless mode: every `POST` is
independent, no SSE streams or session state are kept, and `GET`/`DELETE`
return `405`. The endpoint speaks MCP/JSON-RPC semantics, not the project
response envelope.

Authentication uses long-lived access tokens managed through the REST routes
above (standard JWT/session auth + envelope). `POST /api/v1/mcp/tokens` accepts
`{ name, scopes? }` (`scopes ⊆ ["read","operate"]`, default `["read"]`) and
returns the plaintext token (`fbmcp_…`) exactly once; only its SHA-256 hash is
stored. `GET` lists the caller's tokens without any secret material; `DELETE`
revokes immediately. MCP requests present the token as
`Authorization: Bearer fbmcp_…`; the owning user's status is re-read on every
request and revocation takes effect at once.

The tool surface reuses the native Copilot platform tools
(`services/agent/tools`): read tools (`list_projects`, `get_project`,
`list_sessions`, `get_session`, `get_session_output`, `list_skills`,
`load_skill`, `search_memory`, `list_memory`, `get_usage_summary`,
`pm_overview`, `pm_list_task_packets`, `pm_get_task_packet`,
`project_graph_*`) are available to every token; operate tools
(`create_project`, `update_project`, `start_session`, `stop_session`,
`dispatch_task_to_session`, `pm_create_work_item`, `pm_update_work_item`,
`pm_update_management`, `pm_start_task_packet`, `write_memory`) require the
`operate` scope and are hidden from `tools/list` without it. The `operate`
scope is the owner's standing authorization: platform command intents are
previewed and approved inline with `owner_action` authority (the interactive
approval loop does not exist for MCP callers), and every call still passes zod
input validation, the security policy engine, the owner's per-tool enable
settings, and the 48KB output cap. Operations the security policy marks as
high-risk approval-gated (for example `create_project` with a path outside the
home directory) are refused rather than auto-approved, and `write_memory` with
`scope: "session"` is rejected because session memory is bound to a Copilot
conversation. Error responses on this endpoint use JSON-RPC error envelopes
(`-32700` parse error, `-32603` internal error), never the project REST
envelope. Tenant isolation is unchanged — all tools
execute with the token owner's `userId`.

Client configuration example (Claude Code):

```bash
claude mcp add --transport http forgebadger http://127.0.0.1:48731/mcp \
  --header "Authorization: Bearer fbmcp_…"
```

## 4. WebSocket Contract

### Paths

- `/ws/terminal/:sessionId`
- `/ws/events`

Browser clients cannot set arbitrary WebSocket headers, so terminal access uses:

- `authToken=<jwt>` query parameter for browser clients, or `Authorization:
  Bearer <jwt>` for non-browser clients.
- `attachToken=<session attach token>` query parameter.

The Gateway must verify the JWT before attaching to Session Server, then require the JWT
subject to match the stored session owner and require the attach token to match
the session attach token.

The events channel uses `token=<jwt>` query authentication and currently emits
session lifecycle, Claude Code notification, and structured activity events.
The Web console consumes these events globally for cache invalidation, live
activity rows, and the notification center.

```json
{ "type": "session_created", "payload": { "session_id": "...", "project_id": "...", "name": "..." } }
{ "type": "session_status_changed", "payload": { "session_id": "...", "old_status": "starting", "new_status": "running" } }
{ "type": "session_deleted", "payload": { "session_id": "..." } }
{ "type": "claude_notification", "payload": { "session_id": "...", "hook_event_name": "Notification", "notification_type": "permission_prompt", "message": "Claude needs your permission to use Bash", "tool_name": "Bash", "notification_id": "...", "created_at": "2026-05-02T00:00:00.000Z", "read": false } }
{ "type": "activity_created", "payload": { "activity_id": "...", "session_id": "...", "project_id": "...", "activity_type": "permission_prompt", "status": "warning", "message": "Permission prompt: Bash", "created_at": "2026-05-02T00:00:00.000Z" } }
```

### Message Envelope

```typescript
interface WSMessage {
  type: string;
  payload: Record<string, unknown>;
  id?: string;
}
```

### Terminal Messages

Client to server:

```json
{ "type": "terminal_input", "payload": { "data": "..." } }
```

Server to client:

```json
{ "type": "terminal_output", "payload": { "data": "...", "sequence": 1 } }
```

Acknowledge output only after the browser xterm `write` callback completes:

```json
{ "type": "terminal_ack", "payload": { "sequence": 1 } }
```

Sequence is connection-local. The Gateway bounds unacknowledged output and
WebSocket send buffering. Reconnect is allowed for temporary 1011/4001 closes;
1000 (normal), 4000 (replaced), 4403 and 4404 do not auto-reconnect.

Resize:

```json
{ "type": "terminal_resize", "payload": { "cols": 120, "rows": 40 } }
```

Process exit:

```json
{ "type": "terminal_exit", "payload": { "code": 0 } }
```

Error:

```json
{ "type": "terminal_error", "payload": { "message": "error description" } }
```

## 5. WebSocket Safety Baseline

MVP-0 must enforce:

- JWT authentication before attaching to the Session Server.
- Session ownership check before terminal access.
- One active terminal WebSocket per session; new connection replaces old connection.
- 30 second ping/pong heartbeat.
- 90 second timeout disconnect.
- Message size limit.
- Malformed message rejection.
- Basic input rate limit: 50 terminal input messages per second per connection.

## 6. API Shape Gate

Before frontend implementation begins, `.claude/rules/api.md`, `CLAUDE.md`, `docs/TECH-ARCHITECTURE.md`, and this file must agree on the response envelope.

## 7. Retired Legacy Internal APIs

The former DeepSeek Harness bridge under `/api/internal/v1/copilot-bridge/**` and the former Portfolio API under `/api/v1/portfolio/**` are retired and not mounted. Programmatic terminal submission remains an internal, approval-gated Project Manager/Copilot tool path with the standard session, tenant, and runtime authorization checks.

### Copilot channel identity and route management (P2a backend)

All endpoints below live under `/api/v1/copilot/channels`, require the normal
active-user authentication, return the standard API envelope, and set
`Cache-Control: no-store`. This backend supports Feishu private chats only.
The default Gateway runtime connects enabled/configured accounts; these management
endpoints do not themselves expose a public inbound relay.

| Method | Path | Body / result |
|---|---|---|
| POST | `/pairings` | `{ channel: "feishu", accountId }` → `{ pairing, token }`; 201, token returned once, expires in 10 minutes |
| GET | `/pairings` | `{ pairings }`; latest 100, excludes token and hash |
| POST | `/pairings/:id/confirm` | `{ revision, externalUserId, chatId }` matching the claimed record → `{ identity }` |
| POST | `/pairings/:id/cancel` | `{}` → `{ cancelled: true }` |
| GET | `/identities` | `{ identities }`; latest 100 |
| POST | `/identities/:id/revoke` | `{}` → `{ revoked: true }`; also revokes identity routes and outstanding account pairings |
| POST | `/routes` | `{ identityId, grantId }` → `{ route }`; 201, creates a fresh native grant-bound conversation atomically |
| GET | `/routes` | `{ routes }`; latest 100 |
| POST | `/routes/:id/revoke` | `{}` → `{ revoked: true }` |

A trusted SDK transport must first claim a pairing using the private sender/chat
and current account revision; there is deliberately no public claim/admission
HTTP endpoint. The owner then confirms the exact claimed identifiers and
revision. Pairing alone grants no project authority. One pending/claimed pairing
per account is retained as actionable; issuing another cancels its predecessor.

Routes are immutable and one may be active per identity. Replacement uses a new
conversation. Admission rechecks active user, identity, route, account revision,
account/config enabled flags, emergency stop, chat allowlist, grant status,
revision/expiry, project ownership and conversation grant binding. Native run admission, recovery, approval resumption, model output and platform
action effect fences recheck this authority. Result access also rechecks it; a
future delivery worker must check again immediately before sending. Resource
resolution and action budgets remain enforced by native platform commands.
Identity/account/grant mismatch does not fall back to unrestricted owner access.

Invalid input returns 400 (`CHANNEL_INPUT_INVALID`); authority mismatch returns
403 and database conflict returns 409 (`CHANNEL_AUTHORITY_REJECTED`). Responses
never echo raw SQL errors, pairing tokens from previous calls, or credentials.
The owner UI is `/copilot/channels`; the default runtime supplies authenticated SDK ingress.

### Native channel inbox (internal service)

`createFeishuNativeIngress` accepts normalized private SDK events using the
account and revision captured by its authenticated connection. It separates
`/pair` claims from conversation messages. It is an internal handler, not an
HTTP relay. The default Gateway composes it under supervisor generation fences.

`NativeChannelInbox.receive` checks the current route before storing an encrypted
payload. Account-scoped message IDs and event aliases prevent duplicate runs and
reject conflicting replay. A tenant can have at most 1000 pending messages;
valid duplicate receipts remain available at this limit. Encryption applies to
the inbox payload; the existing native transcript retains its current storage
contract.

`adoptNext` atomically binds one pending message to one native run, in receipt
order per route, skipping busy conversations so other routes can progress. The
native runtime owns execution and recovery after adoption. Channel ownership and
action provenance persist independently of route/step joins; missing authority
fails closed. Revocation prevents later outputs and authorized effects, but
cannot undo an external effect that has already started.

`result` returns an authorized snapshot from the native run ledger. This slice
adds no public inbound endpoints, remote approval cards or Telegram transport.

### Default native Feishu runtime and result delivery

`createGatewayApp` now constructs a native Feishu runtime by default, while
retaining runtime injection for tests. Only active users with enabled accounts,
enabled integration config and emergency stop cleared can connect. SDK handlers
capture the account revision of their connection. Four bounded scheduler lanes
adopt pending input and project results fairly across tenants. The existing
native recovery pump starts adopted tasks (currently on its five-second scan).

Results use `channel_deliveries`, never the historical Feishu inbox/outbox.
Completed tasks return only the final assistant text, excluding inline `<think>`
reasoning blocks (including an unclosed tail). Empty answers use a fixed Web
notice. Filtering also applies to older pending payloads without modifying the
native transcript. Other terminal states use a fixed status notice. Each pending approval receives a deduplicated text notice
directing the owner to Web Copilot; this does not authorize a remote decision.
Encoded JSON text is capped at 12 KB with a continuation notice. Payloads are
encrypted, and uniqueness is scoped by tenant, input message and phase.

Sending requires current route/grant/account/chat authority, matching native
phase, an unexpired owned claim and a live runtime. Checks run again after token
and DNS awaits. Confirmed receipts are `delivered`; provider rejection or token
failure is `failed`; ambiguous message responses/network failures and expired
in-flight claims are `unknown`. Obsolete/unauthorized notices are `cancelled`.
Only `pending` records are sent. Neither failed nor unknown records are retried
automatically. Late receipts cannot overwrite an expired/replaced claim.

The sender uses the official [Feishu message creation API](https://open.feishu.cn/document/server-docs/im-v1/message/create)
with fixed domestic HTTPS endpoints, redirects disabled and a bounded request
timeout. Provider UUID is included, but recovery does not assume an unlimited
provider deduplication window. This change does not replay historical queues.
Live activation and an actual recipient-visible send require separate operator
verification; local composition tests use external I/O substitutes.

### Owner channel management UI and delivery diagnostics

`/copilot/channels` is linked from Copilot settings. Owners configure a write-only
App Secret, check connection status, stop the channel, create a short-lived
pairing, explicitly acknowledge the exact claimed private sender/chat and confirm
the current revision. Candidate changes invalidate previous acknowledgement.
Secrets and one-time pairing tokens stay out of query/mutation cache, URL and
local storage. Saving account configuration increments its revision and requires
new pairing/binding; the page states this before submission.

The page reuses project/action grant management, previews projects, capabilities,
allowed roots, expiry, action budget and concurrency, then creates a separate
channel-bound conversation. Invalid grants/identities are not selectable. Route
status reflects associated authority invalidation even when the stored route is
still active. Owners can revoke identities/routes or open the bound Copilot
conversation using its existing `?c=` navigation for Web approvals.

`GET /api/v1/copilot/channels/deliveries` requires active-user authentication and
returns `{ deliveries }` (standard envelope, `Cache-Control: no-store`). It lists
at most 100 newest records for that tenant, explicitly selecting only `id`,
`inboxId`, `phase`, `status`, `createdAt`, and boolean `receiptRecorded`. Payload,
claim token, peer IDs and provider message IDs are never returned. The UI labels
unknown outcomes as uncertain and offers no resend action.

### Copilot request identity and context

`clientRequestId` is optional, nonempty, and at most 128 characters. Its unique
scope is `(userId, conversationId, clientRequestId)`. Use a fresh key for each
intentional message; preserve it when retrying an uncertain response. The digest
covers content, explicit model/project, effective Grant, source, and admission
mode. Current user, conversation, project, channel and Grant scope are rechecked
before any cached run is returned. The key deduplicates message admission, not
conversation creation. Legacy callers without a key retain existing behavior.

The full Copilot chat offers explicit project context. The Gateway verifies
ownership and any bound Grant, then includes the selected ID/name in the model
context. Selection grants no additional tool authority. JSON/SSE model replies
must be structurally valid; partial or unsuccessful tool batches are not committed.
Text deltas may be tentative until the durable run reaches a terminal state.

The model-only `read_tool_result({messageId,offset?,length?})` tool returns up to
6,000 UTF-16 characters of a persisted redacted receipt in the current conversation.
It verifies the source run/step, current/original authority, current source-tool
visibility and referenced resources. Deleted, unrelated, legacy unassociated,
external MCP, Skill and nested readback receipts are rejected. This retrieves only
saved content; it cannot recover output already discarded by the original 48 KiB
receipt cap. `nextOffset`, `totalChars` and `originalOutputTruncated` describe paging
and retained evidence. No additional HTTP endpoint is introduced.

### Persistent Copilot grants

`POST /api/v1/copilot/grants` requires explicit `expiresAt` and `maxActions`.
Each accepts a positive integer or `null`; `null` means no time expiry or no
cumulative action limit respectively. Omitted, zero and negative values are
rejected. `projectIds` selects existing owned projects. With `allOperations: true`,
at least one project is required; the server snapshots all currently delegatable
capabilities and derives canonical allowed roots from those projects' paths.
Supplying `capabilities` or nonempty `allowedRoots` with this mode is rejected.
Future capabilities and newly created projects do not automatically enter the grant.
Otherwise, `capabilities` must explicitly select at least one operation and
`allowedRoots` retains its custom-scope meaning. Permanence does not widen scope. Existing numeric
grants retain their expiry and budgets. `usedActions` continues increasing, and
`maxConcurrency` remains enforced. Action intents still expire within15minutes.

The owner form defaults to all operations and long-lived/unlimited cumulative
use. Owners select projects; the name is generated automatically. Advanced settings
allow a custom name, operations, roots and finite limits. Creation displays inline
validation, request errors and success feedback, and prevents duplicate submissions.
The channel page selects the newly created grant; creating its route remains explicit. A
revoked grant is rejected on subsequent admission/execution, including after
awaited external-operation preparation. Pairing codes retain their10minute TTL.

Storage uses zero only as an internal sentinel in the existing non-null columns;
repository reads expose null and writes encode null as zero. No migration was
needed; preactivation inspection found no historical zero-bound grants.


### Grant list cleanup and channel activation

Deleted grants retain a non-active tombstone for immutable conversation, action and
channel references; they never restore owner authority. Tenant-scoped grant lists
exclude deleted records. The UI collapses revoked grants by default and exposes
individual deletion after expanding the revoked count. Deletion preserves audit
history and is not a physical purge of historical records.

Channel connection alone does not authorize remote operations. The channel page
shows whether a current, valid identity/grant route exists and provides an explicit
“启用飞书远程操作” action after selection. Creating a project grant alone does not
bind it to Feishu. Previously rejected messages are not replayed on activation;
send a new message after binding.

### Copilot Playbooks and CLI Skills (2026-09-17)

Copilot operating guides are managed as Skills at `/api/v1/copilot/skills`.
The legacy `/api/v1/copilot/playbooks` bridge uses the same versioned service; `/api/v1/skills` and
project Skill selection are exclusively for CLI packages. Both retain the normal
API envelope. A UUID from one runtime target cannot read or mutate the other.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/api/v1/copilot/playbooks` | `{ playbooks }`: ID, name, description, content, stored `version`, `currentVersion`, `isEnabled`, `requiredTools`, `available`, `unavailableReason`, `reviewRequired`, `editable` |
| PUT | `/api/v1/copilot/playbooks/:id` | `{ content, version }`, where `version` is the current bundled version explicitly reviewed by the owner; returns `{ playbook }`; stale version is 409 |
| PUT | `/api/v1/copilot/playbooks/:id/enabled` | `{ enabled }`; returns `{ playbook }`; enabling an unreviewed version is 409 |

`list_playbooks` and `load_playbook({ id })` list/load only enabled, reviewed
playbooks whose required tools are currently available. Grant-bound turns may
load only exact canonical bundled names, descriptions and bodies; edited or
shared global instructions cannot acquire Grant trust. `/playbooks` uses the
same query policy, including owner tool switches and scheduled read-only limits.
The old `/skills` chat command returns an explanation pointing to the separate
surfaces. `list_skills` and `load_skill` are retired native Copilot tool names.

`pm_prepare_task_packet` replaces `pm_start_task_packet` and only prepares a task
packet/linked idle session. It does not start a CLI or submit instructions.
`dispatch_task_to_session` is not advertised by Copilot or MCP because autonomous
CLI dispatch remains unavailable. The capability settings list reports it with
`available: false`, `unavailableReason: "ADAPTER_AUTONOMY_UNVERIFIED"` and
`effectiveEnabled: false`; attempts to toggle retired/unavailable names return
404. `enabled` is a configured preference, `available` is runtime availability,
and `authorization` describes `read`, `approval_or_grant`, or `unavailable`.
Actual resource authorization is always checked again during execution.

CLI Skill rows expose `runtimeTarget: "cli"` and nullable `resourceManifest`.
A null manifest denotes Markdown-only content, including remote Markdown imports;
it does not assert that referenced scripts/assets were installed. Local supported
packages snapshot up to 64 additional UTF-8 text files, 128 KiB per file, 1 MiB
combined, at most eight nested directory levels. Binary files, resource symlinks,
escapes and oversized packages are rejected whole and reported in
`discovery.rejectedSkills` (`path`, `reason`). Export preserves frontmatter and
literal template syntax, copies supported text resources, rejects path collisions,
and records `.forgebadger-skill.json` for obsolete-file review. Script execution,
executable-bit installation and binary asset packaging are outside this text
resource contract. Rejected refreshes block export of affected enabled snapshots.

### Copilot extension management (2026-09-18)

All routes below use JWT active-owner authentication and the standard API envelope.
IDs and revisions are tenant-scoped; stale updates fail rather than overwrite.
The Web entrypoint `/copilot/extensions` contains Skills and Connections tabs.

| Method | Path below `/api/v1/copilot` | Request / response data |
| --- | --- | --- |
| GET | `/skills` | `{ skills }` summaries, without full bundle content |
| POST | `/skills/imports` | `{ source: { kind: "paste" or "upload", label? }, files: [{ path, content }] }` or `{ source: { kind: "url", url } }`; returns `{ skill }`, initially disabled |
| GET | `/skills/:id` | `{ skill }` with current revision and all files |
| PUT | `/skills/:id` | `{ expectedRevisionId, files, reviewedVersion? }`; returns `{ skill }` |
| PUT | `/skills/:id/enabled` | `{ expectedRevisionId, enabled }`; returns `{ skill }` |
| GET | `/skills/:id/revisions` | `{ revisions }`, newest 100 retained revision summaries |
| GET | `/skills/:id/revisions/:revisionId` | `{ revision }`, including files |
| POST | `/skills/:id/rollback` | `{ expectedRevisionId, revisionId }`; appends a new revision and returns `{ skill }` |
| GET | `/connections` | `{ connections }`, builtin `forgebadger` plus owner MCP connections |
| POST | `/connections` | `{ name, endpoint, bearerToken? }`; `{ connection }`, initially disabled with no selected tools |
| PUT | `/connections/:id` | `{ revision, name?, endpoint?, bearerToken?, enabled?, enabledTools? }`; `{ connection }` |
| POST | `/connections/:id/discover` | `{ revision }`; atomically refreshed `{ connection }` |
| DELETE | `/connections/:id?revision=N` | `{ deleted: true }`; stale existing revision is 409 |

Skill summaries include `revisionId`, `source`, `kind`, `isEnabled`, `available`,
`unavailableReason`, `compatible`, `incompatibilityReasons`, `requiredTools`,
`reviewRequired`, `version` and `currentVersion`. Installation accepts up to 65
UTF-8 files, 128 KiB per file and 1 MiB combined, including root `SKILL.md`.
Paths, YAML and UTF-8 are validated; a rejected import writes nothing. Up to 32
non-builtin packages may be installed per owner. URL imports retrieve only the
single public HTTPS raw Markdown file; references must be supplied in a file bundle.
Unsupported executable packages remain disabled and report their incompatibility.
`read_skill_resource({ skillId, revisionId, relativePath, offset?, length? })` reads bounded
current-revision resources under the same availability and Grant policy as
`load_playbook`. Old function names and historical approval digests are preserved.

Connections expose `hasCredential`, never a credential value. Omitting
`bearerToken` retains it, a string replaces it, and `null` explicitly removes it.
Public HTTPS endpoints cannot include credentials, query parameters or fragments.
There are at most 20 connections and 100 discovered tools per connection.
Unsupported JSON Schemas are marked incompatible and cannot be selected.
Discovery alone does not enable tools; changed definitions are deselected.
External execution always requires exact interactive owner approval, regardless
of server annotations. Grants, scheduled and reactive turns cannot use these tools.
Indeterminate external writes are not replayed automatically.

The builtin connection is managed through existing `/capabilities` APIs. Those APIs
list platform tools only. Gateway `/mcp` token management remains the outward
platform integration surface and is separate from these outbound connections.
