# Feishu Project Manager Copilot Design

Date: 2026-05-17
Status: Proposed
Scope: Feishu remote collaboration channel and project-manager Copilot evolution

## Context

OpenForge Copilot is already a provider-backed, approval-gated platform
assistant. It can inspect tenant-scoped platform state, use read tools, prepare
pending actions, observe bounded terminal snapshots, and send terminal input only
after explicit approval.

The next product step is to make Copilot useful as a project manager for each
AI CLI-backed development project, not only as an OpenForge operator. Copilot
should understand project goals, decompose work, watch Code CLI progress, keep
project management artifacts current, and prepare the next development action.
Feishu CLI should provide the remote collaboration channel for chat, project
tasks, status reports, and development documents.

## Goals

- Add Feishu as an optional remote collaboration channel for Copilot.
- Let project-scoped Copilot act as a development project manager for Claude
  Code, OpenCode, and Codex terminal sessions.
- Preserve the existing OpenForge safety model: no raw shell tool, no arbitrary
  direct filesystem writes, no unapproved terminal input, no model self-approval,
  and no unattended autonomous loop in the first release.
- Establish a phased path from explicit approval for every action to later
  batch authorization with budgets and risk gates.

## Non-Goals

- No Feishu message may become raw terminal input directly.
- No Feishu user may approve actions without being mapped to an OpenForge user.
- No background autonomous development loop in the first implementation.
- No direct use of Feishu CLI raw API commands from model output.
- No direct Git, dependency install, or file write tool outside validated
  OpenForge workflows and AI CLI terminal sessions.
- No hosted collaboration, billing, or cloud runner work in this scope.

## External Capability Baseline

Feishu CLI is exposed as `lark-cli` through the `@larksuite/cli` npm package. It
is designed for AI agents and developers, supports structured output formats
including JSON and NDJSON, uses OAuth 2.0 Device Flow, supports user and bot
identity switching, and covers messaging, documents, Bitable, calendar, mail,
tasks, drive, sheets, wiki, meetings, and contacts.

OpenForge should treat Feishu CLI as an external integration executable, not as
a model-controlled shell. Gateway owns discovery, command allowlisting, argument
validation, output parsing, redaction, audit, and rate limiting.

## Approach Options

### Recommended: collaboration bridge plus approval-gated project manager

Feishu messages enter Gateway through a controlled bridge and become Copilot
conversation messages with source metadata. Copilot can inspect project and
session state, create project-management drafts, and prepare session inputs or
Feishu updates as pending actions. Web and Feishu both render approval links or
approval codes, but Gateway remains the only authority that executes approved
actions.

Pros:

- Reuses the existing Copilot pending-action model.
- Gives remote control without bypassing OpenForge audit and tenant isolation.
- Builds the project-manager role incrementally.
- Can later support batch authorization without redesigning the channel.

Cons:

- Slower than a direct "chat message controls terminal" demo.
- Requires identity mapping and channel authorization before write actions.

### Alternative: Feishu notifications only

OpenForge sends status updates, reports, and task summaries to Feishu, but does
not accept inbound Feishu commands.

Pros:

- Lowest risk.
- Useful for release/status reporting.

Cons:

- Does not satisfy remote Copilot control.
- Does not materially advance project-manager Copilot behavior.

### Alternative: full remote agent mode

Feishu messages can trigger Copilot to drive Code CLI sessions for a configured
budget without per-action approval.

Pros:

- Strongest autonomous workflow.
- Closest to a remote development operator.

Cons:

- Too much risk for the first Feishu release.
- Requires durable queues, locks, budgets, action policy, replay protection,
  stronger audit, and emergency stop controls first.

## Recommended Product Model

Start with two levels:

1. Explicit approval mode. Copilot may plan, inspect, draft, and prepare
   actions, but every terminal input, session lifecycle change, Feishu write, or
   project-management mutation requires approval.
2. Batch authorization mode. After explicit approval mode is stable, the user
   may authorize a bounded project objective with step, time, and risk budgets.
   Copilot can proceed within that budget but must pause for high-risk actions,
   missing evidence, secrets, failed tests, destructive operations, or unclear
   terminal prompts.

Do not implement unattended long-running autonomous mode until batch
authorization has production evidence and a separate security review.

## System Architecture

```text
Feishu chat/doc/task event
  -> Feishu CLI bridge or webhook adapter
  -> Gateway integration service
  -> identity/channel policy check
  -> Copilot conversation/run source=feishu
  -> Copilot project-manager tools
  -> pending action queue
  -> approval through Web or signed Feishu approval
  -> Gateway executes allowlisted action
  -> audit/activity/Copilot timeline
  -> Feishu status/task/doc update when approved
```

Gateway remains the enforcement point. Web and Feishu are clients. The model
only sees normalized, redacted Feishu context and validated OpenForge tool
outputs.

## Core Components

### Feishu Integration Settings

Store tenant-scoped integration state:

- CLI binary path and version discovered from `lark-cli`.
- Authentication status from `lark-cli auth status`.
- Enabled/disabled flag.
- Allowed chat IDs, doc roots, and task lists.
- Feishu user or bot identity mode.
- Feishu user id to OpenForge user id mapping.
- Default project mapping rules for chat channels.
- Rate limits and emergency disable flag.

Secrets must not be stored by OpenForge when Feishu CLI can keep credentials in
the OS-native keychain. OpenForge may store non-secret app metadata and redacted
status only.

### Feishu Command Bridge

The bridge executes only an allowlisted registry of Feishu operations:

- `feishu.get_status`
- `feishu.send_message`
- `feishu.create_doc`
- `feishu.update_doc`
- `feishu.create_task`
- `feishu.update_task`
- `feishu.append_status_report`
- `feishu.watch_events` or webhook ingestion in a later phase

Each bridge command defines exact arguments, output schema, maximum output size,
timeout, dry-run support where available, and redaction rules. The bridge must
use structured JSON or NDJSON output and reject unparseable output.

### Project Manager Copilot

Add project-scoped management concepts without giving the model raw execution:

- Project objective: durable user-approved goal and constraints.
- Work items: tasks with status, evidence, linked sessions, and Feishu task ids.
- Development run ledger: Copilot decisions, observed terminal snapshots,
  proposed inputs, approvals, test evidence, and blockers.
- Session queue: at most one active Copilot-driven run per project unless a
  future multi-agent plan explicitly allows parallel sessions.
- Evidence requirements: Copilot cannot mark work done without terminal output,
  test output, file diff, or CI evidence that maps to the task.

### Project-Manager Tool Surface

Read tools:

- `openforge.get_project_goal`
- `openforge.list_project_work_items`
- `openforge.get_project_work_item`
- `openforge.get_project_development_ledger`
- `openforge.get_feishu_integration_status`
- `openforge.get_feishu_project_context`

Prepare tools:

- `openforge.propose_project_goal_update`
- `openforge.propose_project_work_item_create`
- `openforge.propose_project_work_item_update`
- `openforge.propose_project_run_next_step`
- `openforge.propose_feishu_message_send`
- `openforge.propose_feishu_doc_create`
- `openforge.propose_feishu_doc_update`
- `openforge.propose_feishu_task_create`
- `openforge.propose_feishu_task_update`
- `openforge.propose_batch_authorization`

All prepare tools create pending actions. Approval handlers own validation and
execution.

### Approval Model

Explicit approval mode:

- Terminal input uses the existing `openforge.propose_session_input` path.
- Feishu writes use Feishu-specific pending actions.
- Project-management writes use project-manager pending actions.
- Approval may happen in Web or through Feishu with a signed one-time approval
  code that references the pending action id.

Batch authorization mode:

- User approves a project objective, budget, allowed action classes, and stop
  conditions.
- Gateway records a budget token for the project and Copilot run.
- Low-risk project-management updates may execute within budget.
- Terminal input still requires either explicit approval or a narrowly scoped
  per-session budget that records the exact allowed input class.
- High-risk triggers always pause: destructive actions, dependency install,
  git operations, secrets detected, failed/ambiguous tests, permission prompts,
  changed project goal, stale terminal evidence, or cross-project ambiguity.

## Data Model Additions

Add new tenant-scoped tables in later implementation:

- `integration_feishu_configs`: non-secret settings, auth status snapshot,
  allowed channels, identity mode, disabled flag.
- `integration_feishu_user_mappings`: Feishu user id to OpenForge user id.
- `project_goals`: current goal, constraints, acceptance criteria, status.
- `project_work_items`: task title, status, priority, project id, Feishu ids,
  linked session ids, evidence summary.
- `project_development_events`: append-only ledger of observations, decisions,
  approvals, CLI inputs, test evidence, Feishu syncs, and blockers.
- `project_batch_authorizations`: bounded autonomy grants, budgets, allowed
  action classes, expiration, stop reason.

All tables must include `user_id` and use repository-level tenant filtering.

## Error Handling

- Feishu CLI missing: integration status is unavailable, Copilot can only draft
  setup steps.
- Feishu auth expired: fail closed and prepare a re-auth guidance action.
- Unmapped Feishu user: accept only read-only status commands, no approvals.
- Unauthorized chat: ignore or respond with a minimal non-sensitive denial.
- CLI output too large or unparseable: fail closed, store redacted diagnostic
  summary, and do not send data to the model.
- Pending action expired or already decided: reject approval with the existing
  pending-action not-pending semantics.
- Batch budget exhausted: pause run, update ledger, and request new approval.

## Security Requirements

- No model-generated raw CLI command strings.
- No Feishu CLI raw API access in the first implementation.
- Validate every Feishu command input with zod.
- Parse structured output only.
- Redact Feishu messages, documents, task descriptions, terminal snapshots, and
  CLI output before persistence or provider model requests.
- Bind approvals to OpenForge user id, Feishu user id, pending action id,
  expiry, and nonce.
- Rate limit inbound Feishu messages per chat and per mapped user.
- Store audit rows for inbound command, pending-action creation, approval,
  execution result, and Feishu write.
- Include an emergency integration disable switch.

## UX Requirements

Web:

- Settings / Integrations / Feishu page with CLI status, auth status, allowed
  channels, user mapping, and emergency disable.
- Project page "Project Manager" view for goal, work items, run ledger, current
  batch authorization, and linked Feishu artifacts.
- Copilot chat badges for source `feishu`, project scope, and autonomy mode.

Feishu:

- `/openforge status` returns safe project or workspace status.
- `/openforge plan <goal>` asks Copilot to draft a project plan and pending
  actions.
- `/openforge continue` asks Copilot to inspect the project/session and propose
  the next step.
- Approval replies use signed codes or links, never free-form "yes" text alone.
- Status updates link back to OpenForge run, session, and pending action ids.

## Phased Delivery

### Phase 0: Documentation and safety gate

Write this design, implementation plan, and security checklist. Do not change
runtime behavior.

### Phase 1: Feishu integration status

Add CLI discovery, auth status, settings UI, and read-only diagnostics. No
inbound remote control and no Feishu writes.

### Phase 2: Feishu outbound project reports

Allow approved Copilot pending actions to send Feishu messages and create/update
docs/tasks. This gives immediate project-management value without inbound
control.

### Phase 3: Inbound Feishu command bridge

Allow authorized Feishu chats to create Copilot conversations and runs. All
write operations remain pending actions.

### Phase 4: Project manager ledger and work items

Add project goals, work items, development ledger, and project-manager read/
prepare tools. Copilot can propose the next Code CLI step based on project
state, terminal snapshots, and tests.

### Phase 5: Batch authorization

Add bounded autonomy grants. Start with low-risk project-management updates and
status reports. Terminal input budgets require a separate safety checklist and
fresh review before enabling.

## Acceptance Criteria

- Feishu integration can be disabled instantly.
- No inbound Feishu message can execute terminal input directly.
- Every Feishu write and project-management write is represented in audit logs.
- Unmapped or unauthorized Feishu users cannot approve pending actions.
- Copilot cannot mark project work done without evidence mapped to the work
  item.
- Batch authorization cannot exceed its time, step, or risk budget.
- Tests cover tenant isolation, command allowlist rejection, approval replay,
  Feishu CLI missing/auth-expired paths, redaction, and rate limits.

## Open Questions

- Whether first inbound Feishu support should use `lark-cli` event watch, a
  Gateway webhook route, or both.
- Whether Feishu approval should initially be code-only, link-only, or both.
- Whether project work items should remain OpenForge-native with Feishu ids as
  mirrors, or Feishu Tasks should become the source of truth for mapped projects.

## Decision

Proceed with the recommended bridge-plus-project-manager design. Implement
explicit approval mode first. Batch authorization is a later phase gated by
ledger, policy, budget, and security tests. Do not implement unattended
autonomous development mode in this scope.
