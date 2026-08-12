# OpenForge API Contract

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
- `500` server error

## 3. REST Surface

### Auth

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

Auth user payloads include `id`, `email`, `role`, and `status`. The first
registered local user is bootstrapped as `admin`; later registrations default
to `user`. Disabled users cannot log in or refresh `/auth/me`.

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
safe Feishu integration capability state, and selected OpenForge environment
values. It never uploads telemetry and redacts key, token, password,
credential, authorization, `sk-*`, and `Bearer ...` values.
Provider SSOT diagnostics include only bounded counts and status metadata:
provider/model/credential totals, active/default counts, api format
distribution, and per-provider readiness summaries. Plaintext secrets, encrypted
secrets, credential previews, default headers, and foreign-tenant providers are
not included.

### Project Manager Ledger

The Project Manager Ledger is Gateway-owned OpenForge control-plane state. It
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
- `GET /api/v1/projects/:projectId/project-manager/ledger`

All Project Manager Ledger REST endpoints use the canonical OpenForge response
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
details, and returns the derived task packet plus the created session. It does
not start tmux, write terminal input, inject secrets, or grant autonomous host
execution authority; the operator still starts/connects the session through
the existing session lifecycle.

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

- `openforge.get_project_goal`
- `openforge.list_project_work_items`
- `openforge.get_project_work_item`
- `openforge.get_project_development_ledger`

These tools are tenant-scoped, project-scoped, redacted, and read-only. They
return concise current state plus bounded evidence references only. They must
not return raw terminal transcripts, unbounded ledger details, Feishu webhook
verification material, provider credentials, attach tokens, or cross-tenant
mapping details.

Phase 12 adds Project Manager traceability on top of the local-first AI CLI
control plane. It does not broaden OpenForge into a generic project-management
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

Feishu free-form text is never an approval or execution channel for the Project
Manager Ledger. Feishu free-form text cannot approve pending actions, cannot
send terminal input, cannot mutate ledger records directly, and cannot bypass
the existing pending-action approval routes. Feishu outbound updates remain
approval gated through the existing Copilot prepare-tool and pending-action
policy checks, including chat allowlists, identity mode, user mapping, and
tenant configuration. Ledger events may link a bounded Feishu reference, but
they do not execute Feishu writes.

### Integrations

- `GET /api/v1/integrations/feishu/status`
- `GET /api/v1/integrations/feishu/config`
- `PATCH /api/v1/integrations/feishu/config`
- `GET /api/v1/integrations/feishu/user-mappings`
- `PUT /api/v1/integrations/feishu/user-mappings`
- `POST /api/v1/integrations/feishu/bot-websocket/events`
- `POST /api/v1/integrations/feishu/bot-websocket/connection-events`
- `POST /api/v1/integrations/feishu/inbound`
- `POST /api/v1/integrations/feishu/webhook/:publicId`

Feishu integration endpoints are authenticated, tenant scoped, and
Gateway-owned. Status discovers the local `lark-cli` binary, reports version
and structured auth status when available, and overlays the tenant's persisted
enabled/emergency-disabled state. Configuration and user mappings are persisted
without Feishu tokens, cookies, credentials, raw CLI stderr, or secret-like
fields.

These endpoints do not execute Feishu writes, accept model-generated command
strings, send terminal input, approve actions from Feishu text, or start
unattended development loops. Outbound Feishu writes are only available through
Copilot prepare tools plus explicit OpenForge pending-action approval.

`POST /api/v1/integrations/feishu/bot-websocket/events` is the authenticated
Gateway-side receive path for a local Feishu bot long-connection worker. It
accepts the SDK-style `im.message.receive_v1` event object, normalizes only text
messages, applies the tenant Feishu policy, and returns a bounded `replyPlan`
for commands such as `/openforge status`, `/openforge sessions`, and
`/openforge task <id>`. The reply plan uses `receiveIdType=chat_id` and
contains only safe status/session/task summaries; it does not include attach
tokens, tmux names, raw work-item details, raw event bodies, or terminal
scrollback. Free-form terminal control such as `/openforge terminal`,
`/openforge input`, shell commands, or approval text is rejected and audited.

`POST /api/v1/integrations/feishu/bot-websocket/connection-events` records
sanitized local long-connection lifecycle evidence such as
`connected`, `reconnecting`, and `reconnected`. It is intended for the
Gateway-side worker or smoke harness to attach reconnect evidence to the
`FEISHU-BOT-WS` gate. It records `publicCallbackRequired=false` and does not
mark the external gate as passing by itself.

`pnpm smoke:feishu-bot-websocket` exercises these two authenticated Gateway
fixture paths and emits `gateClearingEvidence=false`. It is useful before a real
Feishu bot persistent-connection run, but it does not replace real Feishu
receive/reply/reconnect evidence.

`pnpm smoke:feishu-bot-live -- --require-gate-evidence --output
<report.json>` starts the official `@larksuiteoapi/node-sdk` long-connection
client with `FEISHU_APP_ID`/`FEISHU_APP_SECRET`, forwards real
`im.message.receive_v1` events through the authenticated Gateway receive path,
sends only bounded `replyPlan` text replies through the SDK, and writes a
redacted 0600 JSON report while still printing JSON to stdout. The report is
gate-clearing only when it includes real receive, bounded reply, reconnect, and
terminal-input rejection evidence.

`pnpm evidence:feishu-bot-live-audit -- <report.json>` validates a saved live
smoke report for mode, event subscription, real receive, bounded reply,
reconnect, terminal-input rejection, all-ok checks, and obvious secret-like or
raw Feishu identifier content. It returns `readyForHumanReview=true` only for a
complete redacted report and always emits `gateClearingEvidence=false` because
the audit is not itself an external event.

`pnpm evidence:feishu-bot-live-report -- --report <report.json> --output
<report.md>` formats an audit-passing saved report into a Markdown maintainer
review artifact. The generated report preserves `FEISHU-BOT-WS=Caveat` until a
maintainer links the real external evidence and updates the registry.

The inbound endpoint is an authenticated OpenForge test adapter, not a public
Feishu webhook. The public callback contract below uses a separate route and
auth boundary. Event listener consumption, approval links, direct terminal
input, batch authorization, and unattended loops remain separate non-goals for
this slice.

`POST /api/v1/integrations/feishu/webhook/:publicId` is the public Feishu
event callback route. It is separate from the authenticated `/inbound` test
adapter and does not use the OpenForge REST envelope because Feishu expects
protocol-compatible webhook responses. The `publicId` resolves the tenant
integration before verification, but it is not a secret or an auth factor.
Public webhook handling is disabled by default and remains inert until a tenant
explicitly enables it and stores the required encrypted verification token and
encrypted event encrypt key for that integration.

For current release evidence, the primary Feishu gate is the bot
long-connection/WebSocket path recorded in `docs/EXTERNAL-EVIDENCE-GATES.md`.
This public webhook route is a compatibility path for deployments that
deliberately expose Gateway over HTTPS. Local signed-route tests and `lark-cli`
preflight are regression evidence only; public developer-console URL
verification does not replace primary bot receive/reply/reconnect evidence.

Ordinary public webhook events must include
`X-Lark-Request-Timestamp`, `X-Lark-Request-Nonce`, and `X-Lark-Signature`.
Gateway verifies the signature against the raw request body, checks timestamp
freshness with a narrow five-minute default window, and rejects missing,
malformed, stale, far-future, or mismatched requests before event
normalization and before Copilot execution. URL verification is setup-only:
`url_verification` returns only `{"challenge":"..."}` and does not create a
Copilot run, mutate policy, dispatch Feishu commands, or write terminal input.
Encrypted event payloads with a top-level `encrypt` field are explicitly
unsupported in this slice and fail closed with
`feishu_webhook_encrypted_payload_unsupported`. Tenants that require encrypted
Feishu app mode must leave public webhook enablement off until decrypt support
is added and tested. Unencrypted public events still validate the configured
Feishu verification token after signature and timestamp checks.

Replay protection and public webhook rate limits use dedicated persistent
repository state, not audit-log search and not in-memory maps. Replay keys
include tenant/integration identity plus Feishu event id or message id; the
same nonce/signature replay is also rejected within the timestamp window. Rate
limits apply per tenant/integration, per chat, and, once resolved, per mapped
OpenForge user. SQLite-backed replay and rate storage are supported only for
the local single-Gateway deployment. Multi-instance public webhook deployment
requires a shared replay and shared rate-limit store before webhook enablement;
without that shared store the public webhook route must fail closed or remain
disabled for that deployment mode.

After signature, timestamp, replay, and rate checks pass, public events
normalize into the same bounded inbound command policy used by `/inbound`:
the integration must be enabled, not emergency-disabled, configured with
identity mode `user` or `bot`, constrained by explicit `allowedChatIds`, mapped
to the current tenant through a mapped Feishu user, and, when a `projectId` is
present, scoped to a project visible to that user. A current
`queued`, `running`, or `waiting_for_approval` Copilot run blocks a new public
webhook run. Only the minimum supported Feishu message events for the command
bridge are actionable; unknown authentic event types are acknowledged without
side effects.

Public webhook text such as `approve`, `批准`, or `/approve <id>` is not an
approval channel and must not approve pending actions. Public webhook events
also cannot send direct terminal input, run shell commands, create unattended
development loops, or execute model-generated Feishu command strings. Accepted
events may create a Copilot conversation/run with `source: "feishu"` only after
all boundary checks pass.

Failure responses are minimal. Signature, timestamp, decrypt, token, disabled
route, and unknown-tenant failures return non-2xx responses and create no
Copilot run. Once an authentic tenant event has been resolved, non-actionable
or policy-rejected events may return a minimal 2xx acknowledgement when retrying
would amplify load or leak policy state. Logs, audit rows, model context, and
API-visible metadata must not include raw request bodies, signatures, Feishu
tokens, event encrypt keys, credentials, raw Feishu message text, `Bearer ...`
values, or `sk-*` style secrets.

Implemented public webhook response examples:

```json
{ "challenge": "challenge-value" }
```

```json
{ "msg": "ok" }
```

```json
{ "msg": "ignored" }
```

```json
{ "msg": "feishu_webhook_signature_invalid" }
```

Public webhook audit rows use bounded metadata only. Accepted rows include the
public id or integration id, Feishu event id or message id, chat id, mapped
OpenForge user id, optional project id, run id, conversation id, pending action
count, and redacted text summary. Policy rejection rows include a reason code
and redacted metadata sufficient for diagnostics without exposing request
secrets or private message content.

Successful status response:

```json
{
  "code": 0,
  "data": {
    "status": {
      "available": true,
      "version": "lark-cli 1.2.3",
      "authState": "authenticated",
      "identityMode": "user",
      "enabled": false
    }
  },
  "message": ""
}
```

Successful config response:

```json
{
  "code": 0,
  "data": {
    "config": {
      "enabled": false,
      "emergencyDisabled": false,
      "identityMode": "unknown",
      "allowedChatIds": [],
      "commandPrefix": "/openforge",
      "publicWebhookId": null,
      "publicWebhookEnabled": false,
      "webhookConfiguredAt": null
    }
  },
  "message": ""
}
```

`PATCH /config` accepts any subset of:

```json
{
  "enabled": true,
  "emergencyDisabled": false,
  "identityMode": "bot",
  "allowedChatIds": ["oc_abc"],
  "commandPrefix": "/openforge"
}
```

`allowedChatIds` is trimmed, deduplicated, limited to 50 entries, and each id is
limited to 128 characters. Config updates write a tenant-scoped audit log with
safe metadata only.

Successful user mapping response:

```json
{
  "code": 0,
  "data": {
    "mappings": [
      {
        "id": "mapping-id",
        "feishuUserId": "ou_abc",
        "openforgeUserId": "user-id",
        "displayName": "Alice",
        "createdAt": "2026-05-17T00:00:00.000Z",
        "updatedAt": "2026-05-17T00:00:00.000Z"
      }
    ]
  },
  "message": ""
}
```

`PUT /user-mappings` replaces the authenticated tenant's mapping set:

```json
{
  "mappings": [
    {
      "feishuUserId": "ou_abc",
      "openforgeUserId": "user-id",
      "displayName": "Alice"
    }
  ]
}
```

Mappings are limited to 100 entries and are automatically scoped by
`user_id`; replacement writes a tenant-scoped audit log with mapping count
only.

`POST /inbound` accepts an OpenForge JWT, then validates a strict inbound
command payload:

```json
{
  "chatId": "oc_abc",
  "feishuUserId": "ou_abc",
  "text": "status",
  "messageId": "om_optional",
  "projectId": "optional-openforge-project-id"
}
```

The route fails closed before Copilot execution when the Feishu integration is
disabled, emergency-disabled, `identityMode` is still `unknown`, no explicit
`allowedChatIds` allowlist exists, the chat is outside that allowlist, the
Feishu user is not mapped to the authenticated OpenForge user, the optional
`projectId` is not visible to that user, an accepted `messageId` is replayed,
or the per-chat inbound rate limit is exceeded. Accepted commands create a
Copilot conversation and run with `source: "feishu"`; optional project context
is used only after tenant-scoped ownership validation. Inbound text is redacted
before run persistence, conversation message persistence, provider request
context, audit details, and API response metadata. Free-form approval text such
as `approve`, `批准`, or `/approve <id>` never approves pending actions; pending
actions remain controlled by the OpenForge approval routes.

### Platform AI Copilot

- `GET /api/v1/copilot/capabilities`
- `GET /api/v1/copilot/conversations`
- `POST /api/v1/copilot/conversations`
- `PATCH /api/v1/copilot/conversations/:id`
- `DELETE /api/v1/copilot/conversations/:id`
- `GET /api/v1/copilot/conversations/:id/messages`
- `POST /api/v1/copilot/conversations/:id/messages`
- `DELETE /api/v1/copilot/messages/:id`
- `GET /api/v1/copilot/runs`
- `POST /api/v1/copilot/runs`
- `GET /api/v1/copilot/runs/:id`
- `POST /api/v1/copilot/runs/:id/cancel`
- `POST /api/v1/copilot/runs/:id/pending-actions/:actionId/approve`
- `POST /api/v1/copilot/runs/:id/pending-actions/:actionId/reject`
- `GET /api/v1/copilot/memory/entries`
- `GET /api/v1/copilot/memory/notes`
- `GET /api/v1/copilot/memory/search`
- `GET /api/v1/copilot/memory/:type/:id`
- `DELETE /api/v1/copilot/memory/:type/:id`

Copilot endpoints are authenticated, tenant scoped, and provider backed. The
first release supports OpenAI Responses-style, OpenAI-compatible opt-in, and
Anthropic Messages-style providers through the existing Provider SSOT and
encrypted provider credentials.
Conversation endpoints persist the platform chat history separately from run
execution records. Sending a conversation message stores the user message,
creates a Copilot run with the same bounded source context rules, and stores
assistant response events back into the conversation. Conversation and message
deletes are soft deletes scoped to the authenticated user.
Prompt text is redacted before run persistence, active recall, and provider
model requests so secret-looking values such as API keys, bearer tokens, and
OpenForge attach tokens, and PEM private-key blocks are not stored or sent
onward in plaintext.
If active memory recall fails, Copilot records a non-blocking
`memory_recall_skipped` timeline event and continues the model request without
injecting memory context.
For `source: "project"` and `source: "session"` runs, `sourceRefId` is resolved
through tenant-scoped Gateway repositories and a bounded source context is
included in the provider model request. Project context includes only summary
fields such as id, name, status, AI tool, tech stack, and description. Session
context includes only summary fields such as id, name, status, AI tool, project
id, and model id. Paths, attach tokens, tmux session names, API key ids, and
other sensitive runtime fields are not included. Missing or cross-tenant
references produce a non-leaking "source context unavailable" block rather than
falling back to another user's data.
`sourceRefId` is optional, non-empty when provided, and limited to 256
characters.

`GET /capabilities` returns the provider formats Copilot can use, whether a
compatible provider is configured, and the current tool surface split into
`readTools` and `prepareTools`. Read tools execute directly after Gateway-side
validation. Prepare tools only create pending actions; all mutation or terminal
input still requires explicit approval through the pending-action routes.

`POST /runs` accepts:

```json
{
  "prompt": "Diagnose session launch readiness",
  "providerProfileId": "optional-provider-profile-id",
  "modelProfileId": "optional-model-profile-id",
  "source": "copilot",
  "sourceRefId": "optional-related-resource-id"
}
```

Successful runs return the created run, persisted timeline events, and any
pending actions:

```json
{
  "code": 0,
  "data": {
    "run": { "id": "run-id", "status": "completed" },
    "events": [],
    "pendingActions": []
  },
  "message": ""
}
```

Copilot allows only one executing or approval-waiting run per user while a run
is `queued`, `running`, or `waiting_for_approval`; the Gateway enforces this
with a database uniqueness gate in addition to the in-process guard. A run in
`waiting_for_approval` keeps its pending actions available for approval or
rejection, and it blocks new runs until those pending actions are approved,
rejected, or the run is cancelled.

`POST /runs/:id/cancel` marks live runs as `cancelled`, rejects outstanding
pending actions, and aborts the in-process model request when the run is still
active in the current Gateway process. Late model responses are ignored after a
run has been cancelled. The `run_cancelled` event and `copilot.run.cancel` audit
details include `abortSignalDelivered` so callers can distinguish status
cancellation from an in-process abort signal being delivered. Model requests are
timeout bounded; timeout failures return `504` with
`details.code = "copilot_model_request_timeout"` and record a redacted
`run_failed` event. Stale `queued`/`running` runs left behind by Gateway
interruption are failed before new run admission after the recovery window, but
`waiting_for_approval` runs are preserved for explicit user approval/rejection.
Network failures return `copilot_provider_network_failed`; malformed streaming
provider responses return `copilot_provider_stream_parse_failed`. The Web
console's Copilot run creation request uses a 65 second client timeout so the
Gateway's 60 second model timeout remains the user-visible failure boundary.
`GET /runs?limit=N` returns the requested bounded recent history and also
includes any live `queued`, `running`, or `waiting_for_approval` run found in
the 200-run recovery window. This keeps stale live runs visible and cancellable
in the Web console even when they are older than the normal history page size.

Read tools are allowlisted and validated server-side. Current read tools are:

- `openforge.get_dashboard_summary`
- `openforge.list_projects`
- `openforge.get_project_detail`
- `openforge.list_agents`
- `openforge.list_skills`
- `openforge.get_skill_detail`
- `openforge.list_templates`
- `openforge.get_notifications_summary`
- `openforge.get_usage_summary`
- `openforge.list_sessions`
- `openforge.get_session_detail`
- `openforge.get_session_terminal_snapshot`
- `openforge.get_adapter_discovery`
- `openforge.get_model_provider_summary`
- `openforge.get_model_provider_catalog`
- `openforge.get_recent_activity`
- `openforge.get_diagnostics_summary`
- `openforge.memory_search`
- `openforge.memory_get`

`openforge.get_diagnostics_summary` returns the bounded diagnostics subset
needed for in-chat recovery: generated time, runtime metadata, tenant resource
counts, dashboard health, adapter discovery, Provider SSOT readiness summaries,
and Copilot capability/provider-readiness metadata. Copilot provider readiness
uses Provider SSOT counts and supported provider formats, so legacy API key
rows alone do not mark Copilot as provider-configured. It does not include the
full diagnostics environment block, plaintext provider secrets, encrypted
credential material, credential previews, provider default headers, or
foreign-tenant providers.

Read-tool outputs are redacted before persistence or model follow-up, then
checked against size and residual-sensitive-output safety limits. Blocked tool
outputs fail closed with `details.code = "copilot_redaction_blocked_output"`,
record a redacted `run_failed` event, and are not persisted as `tool_result`
timeline entries.

Prepare tools create pending actions and do not directly mutate runtime state:

- `openforge.propose_session_create`
- `openforge.propose_project_create`
- `openforge.propose_project_import`
- `openforge.propose_project_delete`
- `openforge.propose_project_config_sync`
- `openforge.propose_project_manager_create_work_item`
- `openforge.propose_project_manager_update_work_item_status`
- `openforge.propose_project_manager_attach_evidence`
- `openforge.propose_session_input`
- `openforge.propose_session_start`
- `openforge.propose_session_stop`
- `openforge.propose_session_delete`
- `openforge.propose_agent_create`
- `openforge.propose_agent_update`
- `openforge.propose_agent_delete`
- `openforge.propose_template_create`
- `openforge.propose_template_update`
- `openforge.propose_template_delete`
- `openforge.propose_skill_toggle`
- `openforge.propose_project_skill_toggle`
- `openforge.propose_copilot_model_selection`
- `openforge.propose_model_provider_sync`
- `openforge.propose_model_provider_apply`
- `openforge.propose_diagnostics_export`
- `openforge.propose_adapter_refresh`
- `openforge.propose_troubleshooting_steps`
- `openforge.propose_feishu_message_send`
- `openforge.propose_feishu_doc_create`
- `openforge.propose_feishu_doc_update`
- `openforge.propose_feishu_task_create`
- `openforge.propose_feishu_task_update`
- `openforge.propose_memory_write`
- `openforge.propose_memory_delete`

The three Project Manager prepare tools map one-to-one to the Phase 12
`create_work_item`, `update_work_item_status`, and `attach_evidence` semantics.
They create pending actions only; they do not mutate Project Manager state until
the user approves the stored action through the existing approval route. No
other Project Manager prepare-tool semantics are part of this contract.

Approval uses the canonical stored pending-action payload. The client cannot
replace the action payload at approval time. Diagnostics approval returns a
redacted diagnostics payload. Session-create approval creates and starts a
terminal-backed CLI session for `claude`, `opencode`, or `codex` after
revalidating the stored draft. Session-input approval sends the stored bounded
input to the running terminal session, captures a bounded post-action terminal
snapshot, and continues the Copilot run with that evidence when the run has a
provider/model selection. If the run belongs to a conversation, the resulting
assistant message is also stored in that conversation. Adapter-refresh approval
reruns local adapter discovery and returns fresh availability/launch-readiness
metadata without starting CLI sessions or changing project/session state.
Approve and reject routes only operate on actions whose stored status is still
`pending`; already approved, rejected, or in-flight `processing` actions are not
rewritten. Approval claims the pending action before executing approval side
effects, so duplicate concurrent approvals return `409` with
`details.code = "copilot_pending_action_not_pending"` instead of executing the
same action twice.
Session-create drafts must target a project visible to the current user and one
of the supported terminal adapters: `claude`, `opencode`, or `codex`; approval
revalidates the canonical stored draft so stale or invalid drafts stay pending
instead of starting a session. Session-input drafts must target a running
session visible to the current user; approval revalidates the session state
before writing to the terminal. Troubleshooting-step approval also revalidates
its stored bounded payload. Unknown stored pending-action types are rejected
instead of being treated as generic troubleshooting output.
Memory-write approval creates a tenant-scoped durable memory entry from the
stored redacted payload. Memory-delete approval removes the stored tenant-scoped
memory entry or working note referenced by the canonical pending action.
Feishu action approval requires the tenant Feishu integration to be enabled,
not emergency-disabled, and configured with an explicit `identityMode` of
`user` or `bot`. When `allowedChatIds` is configured, approval also requires the
action target (`chatId`, `folderId`, `documentId`, `tasklistId`, or `taskId`) to
be in that allowlist. When Feishu user mappings are configured, task assignment
approvals require `assigneeFeishuUserId` to be mapped for the current tenant.
Approval executes only the Gateway-owned allowlisted operation registry for
message send, doc create/update, and task create/update;
model-generated raw command strings are rejected and never passed to `lark-cli`.
The allowlist maps to the current Feishu CLI command families
`im +messages-send`, `docs +create`, `docs +update`, `task +create`,
`task +update`, and `task +complete`.
Feishu command output, stderr, audit details, and Copilot timeline payloads are
bounded and redacted before persistence.
Approve and reject decisions also write tenant-scoped audit rows with redacted
action input and bounded result summaries.

Copilot memory is explicit product state. Durable memory entries and working
notes are scoped by `user_id`; project-scoped entries are additionally filtered
by `project_id`. Search uses bounded SQLite FTS/BM25 over redacted text only.
Copilot does not silently write long-term memory, does not index raw terminal
transcripts, and does not create embeddings in this release.

Explicit non-goals for this Copilot release:

- no raw shell or host exec tool;
- no arbitrary filesystem write tool outside validated OpenForge config/project workflows;
- no Codex app-server prompt or `/turn` UI;
- no unapproved terminal input;
- no automatic tmux input or autonomous development loop.

### Adapter Discovery

- `GET /api/v1/adapters/discovery`

Returns local AI CLI command discovery for Claude Code, OpenCode, and Codex.
All three adapters are launch-supported when the corresponding local command is
available. `launchEnabled` is false when the command check fails, and session
creation/start returns `409` before tmux launch in that case. Each adapter also
returns `runtimeModes`; Claude Code and OpenCode currently report `terminal`,
while Codex reports `terminal`, `app-server-stdio`, and `app-server-websocket`.
Codex app-server modes are exposed as a guarded Gateway prototype and are not
mixed into `/ws/terminal/:sessionId`.

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

Import behavior:

- `POST /api/v1/projects/import` registers an existing server directory as a
  project record. It does not delete, move, or rewrite the directory.
- The Web console runs config generation immediately after project create or
  import as a best-effort follow-up. If that follow-up returns a conflict, the
  project record remains valid and the project detail page must guide the user
  through preview/apply conflict handling.
- When no explicit `templateId` is supplied, project create/import stores the
  built-in template matching `aiTool`: Claude Code uses
  `builtin-claude-code`, OpenCode uses `builtin-opencode`, and Codex uses
  `builtin-codex`.

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
  files for the project's adapter, including existing discovered files under
  `.claude`, `.opencode`, `.codex`, and supported root files such as
  `CLAUDE.md`, `AGENTS.md`, `opencode.json`, and `AGENTS.override.md`.
- `GET /api/v1/projects/:id/ai-config/global` returns read-only global config
  files from the matching local tool config root. Sensitive values are redacted
  before the response leaves Gateway.
- `PUT /api/v1/projects/:id/ai-config/files` writes one approved project config
  file by safe relative path. It never writes outside the project root and does
  not modify global user config.
- The response includes form metadata for common Claude Code, OpenCode, and
  Codex settings. The Web console uses those fields to edit JSON/JSONC, simple
  TOML, and instruction-file content while keeping the raw file editor visible.

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
  -H "Authorization: Bearer $OPENFORGE_TOKEN" \
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
- `POST /api/v1/sessions/:id/switch-model`
- `DELETE /api/v1/sessions/:id`

Create body:

```json
{
  "projectId": "project-id",
  "credentialMode": "host_environment",
  "modelId": "model-id"
}
```

Stored credential body:

```json
{
  "projectId": "project-id",
  "credentialMode": "stored_encrypted_key",
  "apiKeyId": "api-key-id",
  "modelId": "model-id"
}
```

When `modelId` is supplied, Gateway validates ownership, persists it on the
session row, and injects the provider model identifier as `ANTHROPIC_MODEL`
in the tmux launch environment. Stored API keys are decrypted only in Gateway
memory and injected as `ANTHROPIC_API_KEY`.

For OpenCode projects, the session uses the project `aiTool` as the adapter and
receives `opencode --model <provider/model>` when a model is selected. Codex and
Kimi Code sessions are subscription-managed and do not receive provider
model/API-key environment injection from the model-provider module; supplying
`modelId`/`apiKeyId` for them is rejected. Codex app-server support
is exposed as adapter capability metadata and Gateway launch/protocol helpers;
interactive browser terminal sessions continue to use the existing tmux-backed
TUI path instead of sending JSON-RPC frames over the terminal WebSocket.

### CLI Global Config

cc-switch style management of each code CLI's global config files
(Kimi `~/.kimi-code/config.toml`, Claude `~/.claude/settings.json`,
Codex `~/.codex/config.toml`, OpenCode `$XDG_CONFIG_HOME/opencode/opencode.json`;
`KIMI_CODE_HOME` / `CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `OPENCODE_CONFIG_DIR`
overrides are honored):

- `GET /api/v1/cli-config/adapters`
- `GET /api/v1/cli-config/:adapter`
- `GET /api/v1/cli-config/:adapter/file?path=<name>&reveal=1`
- `PUT /api/v1/cli-config/:adapter/file` — raw file write (whitelisted file names, 128 KB cap, mode `0600`)
- `PUT /api/v1/cli-config/:adapter/providers/:providerId`
- `DELETE /api/v1/cli-config/:adapter/providers/:providerId`
- `PUT /api/v1/cli-config/:adapter/models` — body carries `alias` (Kimi only; aliases may contain `/`)
- `DELETE /api/v1/cli-config/:adapter/models` — body carries `alias`
- `PUT /api/v1/cli-config/:adapter/default-model`

Secrets are redacted in responses unless `reveal=1` is passed. Deleting a Kimi
provider cascades to its model aliases and clears a dangling `default_model`.

### Codex App-Server Prototype

- `GET /api/v1/codex/app-server`
- `POST /api/v1/codex/app-server`
- `POST /api/v1/codex/app-server/:id/initialize`
- `POST /api/v1/codex/app-server/:id/thread`
- `POST /api/v1/codex/app-server/:id/turn`
- `POST /api/v1/codex/app-server/:id/stop`

These endpoints are authenticated and tenant scoped. They are a guarded control
plane for `codex app-server`, separate from tmux-backed terminal sessions.

`POST /api/v1/codex/app-server` accepts:

```json
{
  "projectId": "project-id",
  "runtimeMode": "app-server-websocket",
  "credentialMode": "host_environment"
}
```

`runtimeMode` is `app-server-stdio` or `app-server-websocket`. WebSocket mode
binds loopback and uses a Gateway-created capability token file with `0600`
permissions. API responses return process metadata and lifecycle state but do
not expose capability tokens or token file paths. The start route rejects
`stored_encrypted_key`, `apiKeyId`, and `modelId`; Codex app-server is
subscription-managed and does not apply provider credentials or model
overrides. The manager enforces per-user process limits and emits activity rows
for start/stop/initialize/thread operations.

`initialize` and `thread` use the Gateway-owned Codex app-server client for the
managed app-server session. The routes validate request payloads, enforce tenant
ownership through the manager, and return the app-server result envelope without
persisting prompt or response transcript content. Codex app-server notifications
are normalized into `codex_app_server_notification` activity rows and broadcast
through the existing activity event path. Notification `message`/`text` payloads
from the Codex protocol are not stored as activity messages; Gateway stores a
type-level summary and safe identifiers such as method, notification type, and
thread id. Malformed inbound app-server frames close the app-server client
transport with a protocol error. The Gateway sends Codex protocol frames as
`{ id, method, params }` according to the generated `codex-cli 0.130.0`
app-server bindings.
If the managed child process exits or emits an error outside an explicit route
action, Gateway retains the safe stopped/error session state long enough for the
control plane to display it and records `codex_app_server_stopped` or
`codex_app_server_error` activity with safe operational metadata only. Process
errors are collapsed to single-line summaries and downgraded to a generic
message when they contain stack/path/secret-like content.

`POST /api/v1/codex/app-server/:id/turn` is present for the guarded prototype
but disabled by default to avoid accidental model usage. It returns `403` unless
Gateway is started with `OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1`. When
enabled, `turn/start` remains rate-limited per user and managed app-server
session, and prompt/response transcript content is not persisted by Gateway.
The current Web prototype does not expose prompt/turn controls and does not call
this route.

For Claude Code sessions, both create and restart paths merge OpenForge command
hooks into `.claude/settings.local.json` before tmux launch.

Codex terminal sessions are also subscription-managed. Session create/start and
the launch-plan helper reject provider credentials and model overrides for the
Codex adapter instead of accepting values that would later be ignored.

### Models

- `GET /api/v1/models`
- `GET /api/v1/models/presets`
- `GET /api/v1/models/groups`
- `POST /api/v1/models`
- `GET /api/v1/models/:id`
- `PUT /api/v1/models/:id`
- `DELETE /api/v1/models/:id`
- `POST /api/v1/models/:id/set-default`
- `POST /api/v1/models/:id/check`
- `POST /api/v1/models/:id/check-endpoint`

`GET /api/v1/models/presets` is kept for compatibility but returns an empty
list. Built-in model presets are deprecated; new model/provider setup should
use `/api/v1/model-providers/catalog`, which is now provider-preset driven and
prioritizes Claude Code-compatible presets inspired by cc-switch.

Create body:

```json
{
  "name": "Local Gateway",
  "provider": "local-gateway",
  "modelId": "local-model",
  "endpoint": "https://gateway.example.com/v1"
}
```

Update body accepts any subset of `name`, `provider`, `modelId`, and
`endpoint`. Model rows are tenant scoped by `user_id`.

`POST /api/v1/models/:id/check` performs a local configuration health check.
It verifies the current user's model row has provider/model identifiers and is
not disabled. It does not call external provider APIs during MVP-1, so the
result represents console readiness rather than third-party network health.

`POST /api/v1/models/:id/check-endpoint` performs a timeout-bounded external
endpoint probe and reports health, latency, HTTP status when available, and the
timeout used by the check.

### Model Providers

- `GET /api/v1/model-providers/catalog`
- `GET /api/v1/model-providers`
- `POST /api/v1/model-providers`
- `PATCH /api/v1/model-providers/:id`
- `DELETE /api/v1/model-providers/:id` — returns `409` when any of the
  provider's models are still referenced by a session, agent, or default-model
  setting; the provider and its models are left untouched in that case.
- `GET /api/v1/model-providers/:id/models`
- `POST /api/v1/model-providers/:id/models`
- `PATCH /api/v1/model-providers/:id/models/:modelId`
- `DELETE /api/v1/model-providers/:id/models/:modelId` — returns `409` when the
  model profile is still referenced by a session, agent, or default-model
  setting; the model row itself is left untouched in that case.
- `POST /api/v1/model-providers/:id/models/sync`
- `POST /api/v1/model-providers/:id/readiness`
- `POST /api/v1/model-providers/:id/preview-apply`
- `POST /api/v1/model-providers/:id/apply`

Provider Profiles are the source of truth for model provider configuration,
encrypted API keys, configured model profiles, and CLI apply plans. Both
`preview-apply` and `apply` accept an optional `scope` field:

- `project` (default): writes into the project directory (`projectRoot` is
  required).
- `user-global`: writes into the CLI's user-global config directory, so no
  `projectRoot` is needed. Target roots follow each CLI's conventions:
  `CLAUDE_CONFIG_DIR`/`~/.claude` for Claude, `OPENCODE_CONFIG_DIR` or
  `XDG_CONFIG_HOME/opencode` for OpenCode, and `KIMI_CODE_HOME`/`~/.kimi-code`
  for Kimi.

Provider configuration apply currently supports:

- `claude`: preview/apply writes environment entries (`ANTHROPIC_BASE_URL`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, and the cc-switch style
  `ANTHROPIC_DEFAULT_*_MODEL` / `API_TIMEOUT_MS` defaults). Project scope
  targets `.claude/settings.local.json`; user-global scope targets
  `settings.json`.
- `opencode`: preview/apply writes `opencode.json` provider and model
  fragments in the project root or the user-global config directory.
- `kimi`: preview/apply writes `config.toml` `[providers]`, `[models]`, and
  `default_model` fragments. Project scope targets `.kimi-code/config.toml`;
  user-global scope targets `config.toml` under `KIMI_CODE_HOME`/`~/.kimi-code`.

Codex remains subscription-managed and must not accept Provider URL/API key
configuration through these endpoints.

`GET /model-providers/catalog` returns a cc-switch-style Claude Code provider
preset catalog first, covering Anthropic API, Kimi, DeepSeek, Qwen, z.ai,
OpenRouter, and Ollama with endpoint, env metadata, and default models already
filled in. When models.dev is reachable, OpenCode-compatible provider entries
are appended as secondary catalog entries. Catalog OpenCode npm package names
are sanitized before exposure and revalidated before provider creation; unsafe
package names fall back to the OpenCode OpenAI-compatible provider package.

Creating from a catalog entry:

```json
{
  "catalogId": "openrouter"
}
```

`catalogId` must exist in the currently loaded catalog. Missing catalog entries
return a validation error. Catalog-created Claude Code providers seed all static
default models from the preset so users do not have to type model IDs manually.
Catalog-created models.dev providers still seed only the first advertised model
to keep large external catalogs manageable; users can use model sync or manual
model creation to add the full provider model list.

Creating a custom Provider Profile:

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

Model sync uses the selected Provider Profile base URL, saved credential, and
current catalog metadata when available. Plaintext credentials are decrypted
only inside Gateway memory for the outbound provider request.

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
- `codex_subscription_managed`

When `includeRemoteCheck` is true and the provider has a safe model-list
endpoint, Gateway decrypts the selected credential only in memory and calls the
provider's model-list endpoint through the existing HTTPS/SSRF-safe fetch
helper. Remote failure metadata is categorized as `invalid_credential`,
`timeout`, `provider_outage`, or `endpoint_or_network_failure`. The response
must not include plaintext credentials, authorization headers, provider request
payloads, provider response bodies, tokens, API keys, or other secrets.

For `adapter: "codex"`, readiness returns
`codex_subscription_managed`; it does not decrypt provider credentials, does
not call provider endpoints, and does not enable provider apply wiring. Codex
continues to use the subscription-managed SDK identity path.

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

Supported credential modes:

- `stored_encrypted_key`
- `host_environment`

The selected mode must be recorded on session launch. Silent fallback is forbidden.

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
returning the tenant Skill list. Discovery scans official project-level Skill
directories under the current working directory and each ancestor directory:
`.claude/skills`, `.opencode/skills`, and `.agents/skills`. It also scans
user-level Claude Code Skills from `CLAUDE_CONFIG_DIR/skills` or
`~/.claude/skills`, OpenCode Skills from `OPENCODE_CONFIG_DIR/skills` or
`$XDG_CONFIG_HOME/opencode/skills` or `~/.config/opencode/skills`, and
agent-compatible Skills from `AGENTS_HOME/skills` or `~/.agents/skills`.
OpenForge does not scan command directories, plugin caches, plugin marketplace
checkouts, or `CODEX_HOME` by default; use `OPENFORGE_SKILL_DIRS` with a
path-delimited list when those roots should be imported explicitly. Discovered
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
Template version audit rows are sanitized on read: OpenForge returns template
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
Session create and restart merge OpenForge hooks into
`.claude/settings.local.json` before starting Claude Code, so imported projects
can receive permission, `Stop`, and `SessionEnd` notifications even before a
manual template sync. OpenCode project plugins subscribe to `permission.asked`,
`session.idle`, and `session.error`. Codex project hooks subscribe to
`PermissionRequest`, `Stop`, and `SessionEnd`; Codex may require one-time hook
trust approval through `/hooks`. Kimi project hooks subscribe to
`PermissionRequest`, `Stop`, `Interrupt`, `StopFailure`, `SessionEnd`, and
`Notification(task.completed)`.
Claude hooks use `http` handlers and send the raw Claude hook payload as JSON
to OpenForge; Codex and Kimi use managed command scripts, while OpenCode uses a
managed plugin. Headers interpolate `OPENFORGE_SESSION_ID` and
`OPENFORGE_ATTACH_TOKEN` from the tmux launch environment. The endpoint also
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
permission denial, adapter error events, and Codex app-server lifecycle events.
They intentionally do not store terminal scrollback; terminal pane history
remains in tmux.

### Session Snapshots

- `GET /api/v1/snapshots`
- `POST /api/v1/snapshots/:id/restore`

Query parameters:

- `sessionId` filters snapshots to a session.
- `projectId` filters snapshots to a project.

Snapshots are tenant-scoped structured metadata records for tmux-backed session
state: session, project, tmux session name, selected model, selected Agent, and
optional config version. Snapshot metadata is sanitized and must not contain
terminal scrollback; terminal pane history remains in tmux.

Snapshot restore is explicit and tenant-scoped. When the recorded tmux session
still exists, OpenForge reattaches the database session to that tmux session and
returns `mode: "attach_tmux"` without rotating the existing session attach
token. When tmux no longer has the recorded session, OpenForge recreates a new
tmux-backed session from the snapshot's project/model/Agent metadata plus any credential and API key
metadata still available on the original session record. If the original session record is unavailable, restore falls back to the
snapshot metadata and `host_environment` credentials. Restore returns
`mode: "recreate_session"` and never writes terminal scrollback to SQLite.

### Usage Analytics

- `GET /api/v1/usage/summary`
- `GET /api/v1/usage/rates`
- `PUT /api/v1/usage/rates/:modelId`

Usage summary aggregates tenant-owned session duration by adapter, project, and
model. Optional per-model rates are user-configured hourly rates. Cost fields
are labeled `estimated` and are duration-based only; OpenForge does not claim
provider token billing accuracy from this endpoint.

### Session Hooks

- `POST /api/v1/session-hooks/claude-notification`
- `POST /api/v1/session-hooks/claude-notification/:sessionId`

This unauthenticated endpoint is for OpenForge-generated AI CLI hooks: Claude
Code HTTP hooks, the OpenCode notification plugin, Codex hooks, and Kimi hooks.
All integrations are materialized by the Gateway on session create/restart. It requires
`X-OpenForge-Session-Token` to match the session attach token and accepts
either legacy `{ sessionId, event }` payloads or raw Claude Code hook JSON sent
by Claude Code HTTP hooks / the OpenCode plugin. The session id may be supplied
in the path or `X-OpenForge-Session-Id`. The payload may carry an optional
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

The Gateway must verify the JWT before attaching to tmux, then require the JWT
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

- JWT authentication before attaching to tmux.
- Session ownership check before terminal access.
- One active terminal WebSocket per session; new connection replaces old connection.
- 30 second ping/pong heartbeat.
- 90 second timeout disconnect.
- Message size limit.
- Malformed message rejection.
- Basic input rate limit: 50 terminal input messages per second per connection.

## 6. API Shape Gate

Before frontend implementation begins, `.claude/rules/api.md`, `CLAUDE.md`, `docs/TECH-ARCHITECTURE.md`, and this file must agree on the response envelope.
