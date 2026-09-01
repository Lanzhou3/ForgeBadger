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
state; Feishu may be referenced only as bounded collaboration metadata, and
terminal sessions may be referenced only by safe identifiers or evidence
references.

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
tmux, write terminal input, inject secrets, or grant autonomous host execution
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

Phase 12 adds Project Manager traceability on top of the local-first AI CLI
control plane. It does not broaden ForgeBadger into a generic project-management
suite. Copilot-origin Project Manager writes are proposals only: each proposal
must become exactly one pending action, must use the canonical stored
pending-action payload at approval time, and must execute through the
Gateway-owned Project Manager repository transaction. The only Project Manager
write semantics in this contract are `create_work_item`,
`update_work_item_status`, and `attach_evidence`.

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

### Terminal Runtime Dependencies

- `GET /api/v1/gate-a/dependencies`

Returns the current host dependency report. `data.dependencies` includes the
selected required runtime (`tmux` on macOS/Linux/WSL or `psmux` on native
Windows) plus optional AI CLI commands. `data.terminalRuntime` contains:

```json
{
  "persistence": "psmux",
  "mode": "native_psmux",
  "supported": true,
  "message": "bounded readiness detail"
}
```

`persistence` is `tmux` or `psmux`; `mode` is `native_tmux`, `native_psmux`,
`tmux_missing`, `psmux_missing`, or `psmux_outdated`. psmux must be 3.3.8 or
newer. This endpoint and `forgebadger doctor` are
read-only; they do not install a package or initialize local state. CLI
`start`/`init` and direct Gateway startup fail closed while `supported` is
false: CLI commands return non-zero, and Gateway rejects startup before account
recovery, database/session recovery, or listen side effects.

### Adapter Discovery

- `GET /api/v1/adapters/discovery`

Returns local AI CLI command discovery for Claude Code, OpenCode, Codex, and
Kimi Code. All four adapters are launch-supported when the corresponding local
command is available. `launchEnabled` is false when the command check fails, and
session creation/start returns `409` before platform-multiplexer launch in that case. Every
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
- Project create/import never binds a runtime CLI or a template. Legacy
  `aiTool`/`templateId` fields in the request body are ignored, `templateId`
  starts as `null`, and the stored `aiTool` hint is empty until an explicit
  designation exists. Use `PATCH /api/v1/projects/:id` to bind a template.
- Config sync preview/apply, like compliance, returns `404` with
  `TEMPLATE_NOT_TRACKED` when the project tracks no template and the request
  supplies no explicit `templateId`.

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
- These routes are read-only. They do not store file contents, terminal
  scrollback, or evidence blobs in SQLite; later Project Manager evidence uses
  bounded references to these paths rather than copying raw content.

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
- `GET /api/v1/sessions/:id`
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

Provider apply maps a Model Center provider profile (plus a model profile and
credential) onto the adapter's native config format. Preview and apply share
the same body:

```json
{
  "providerProfileId": "provider-profile-id",
  "modelProfileId": "model-profile-id",
  "credentialId": "credential-id"
}
```

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
hooks into `.claude/settings.local.json` before platform-multiplexer launch.

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
- `POST /api/v1/model-providers/:id/readiness`
- `POST /api/v1/model-providers/:id/balance`

Model sync fetches the provider's model list through its OpenAI-compatible
`/v1/models` endpoint (version-segment aware, so bases like
`https://api.z.ai/api/paas/v4` resolve to `/paas/v4/models`). Authentication
follows the provider's API format: Anthropic-format providers send
`x-api-key` + `anthropic-version`, Google-format providers send
`x-goog-api-key`, and everything else sends `Authorization: Bearer`.
Anthropic-format responses are paginated (`has_more`/`last_id` cursors,
bounded at 20 pages) so full model inventories are collected. Sync only adds
missing models; existing model profiles are left untouched.

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

`POST /api/v1/model-providers/:id/readiness` evaluates a Provider Profile,
target adapter, selected model, selected credential, and optional remote
model-list evidence without mutating provider state.

Request body:

```json
{
  "adapter": "claude",
  "modelProfileId": "model-profile-id",
  "credentialId": "credential-id",
  "timeoutMs": 5000,
  "includeRemoteCheck": true
}
```

Response data contains `readiness.status`, `readiness.code`, `checks`,
`steps`, and optional safe `remote` metadata. Readiness codes include:

- `ready`
- `provider_disabled`
- `unsupported_target`
- `missing_model`
- `missing_active_credential`
- `remote_validation_unavailable`
- `remote_model_missing`
- `remote_validation_failed`

When `includeRemoteCheck` is true and the provider has a safe model-list
endpoint, Gateway decrypts the selected credential only in memory and calls the
provider's model-list endpoint through the existing HTTPS/SSRF-safe fetch
helper. Remote failure metadata is categorized as `invalid_credential`,
`timeout`, `provider_outage`, or `endpoint_or_network_failure`. The response
must not include plaintext credentials, authorization headers, provider request
payloads, provider response bodies, tokens, API keys, or other secrets.

Codex readiness uses the common provider/model/auth-source checks; managed
readiness may use the safe remote model-list check when requested.

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
credential generation; a running tmux environment is not mutated.

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

Notifications are tenant-scoped and persisted in SQLite. Gateway stores session
lifecycle events and accepted AI CLI hook notifications from Claude Code,
OpenCode, Codex, and Kimi Code before broadcasting them on
`/ws/events`. The Web console uses these APIs to hydrate notification history
after reload, persist read state, mark all notifications read, and clear the
current user's notification list. AI CLI notification payloads include normalized
`notification_type`, `adapter`, `project_id`, `project_name`, `session_id`, and
`session_name` context.

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
`FORGEBADGER_ATTACH_TOKEN` from the selected multiplexer launch environment. The endpoint also
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
remains in the selected tmux/psmux runtime.

### Session Snapshots

- `GET /api/v1/snapshots`
- `POST /api/v1/snapshots/:id/restore`

Query parameters:

- `sessionId` filters snapshots to a session.
- `projectId` filters snapshots to a project.

Snapshots are tenant-scoped structured metadata records for
multiplexer-backed session state: session, project, multiplexer session name,
selected model, selected Agent, and
optional config version. Snapshot metadata is sanitized and must not contain
terminal scrollback; terminal pane history remains in the selected runtime.

Snapshot restore is explicit and tenant-scoped. When the recorded multiplexer
session still exists, ForgeBadger reattaches the database session to that session and
returns `mode: "attach_tmux"` without rotating the existing session attach
token. `tmux_session` and `attach_tmux` remain historical API/database
compatibility names on both runtimes. When the selected multiplexer no longer
has the recorded session, ForgeBadger recreates a new multiplexer-backed session
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

## 4. WebSocket Contract

### Paths

- `/ws/terminal/:sessionId`
- `/ws/events`

Browser clients cannot set arbitrary WebSocket headers, so terminal access uses:

- `authToken=<jwt>` query parameter for browser clients, or `Authorization:
  Bearer <jwt>` for non-browser clients.
- `attachToken=<session attach token>` query parameter.

The Gateway must verify the JWT before attaching to the selected multiplexer, then require the JWT
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
{ "type": "terminal_output", "payload": { "data": "..." } }
```

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

- JWT authentication before attaching to the selected tmux/psmux runtime.
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
