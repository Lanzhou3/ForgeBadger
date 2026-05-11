# Platform AI Copilot Design

Date: 2026-05-11
Status: Draft for review
Scope: first platform-side AI Copilot architecture, before implementation-plan breakdown

## Roadmap Context

OpenForge is currently a local-first control plane for AI CLI sessions. The
Gateway owns APIs, WebSocket terminal transport, SQLite persistence, encrypted
credentials, adapter discovery, diagnostics, activity events, and tmux session
lifecycle. The Web console remains a pure SPA.

This design introduces a platform-side AI Copilot. It is separate from:

- Codex app-server prompt/turn input, which remains guarded and disabled in Web.
- SSH/remote execution, which has its own confirmed architecture spec.
- Autonomous remote execution, hosted workers, and cloud collaboration.

The first release should make OpenForge easier to operate and debug without
letting a model directly control terminal input, shell commands, or project
files.

## Goal

Add a built-in Copilot that can inspect OpenForge state, answer operational
questions, recommend next steps, and prepare low-risk actions for user approval.

The first version should help with:

- "Why can I not launch a session?"
- "Which runtime CLI is available on this machine?"
- "What should I do after this diagnostics export?"
- "Create a safe plan for starting a Claude/OpenCode/Codex session."
- "Summarize this project/session state and suggest next actions."

## Non-Goals

- No autonomous developer loop.
- No automatic terminal input into tmux sessions.
- No raw shell execution tool.
- No direct filesystem writes by model output.
- No automatic code edits, dependency installs, or git operations.
- No browser-to-model direct API calls; all provider traffic goes through
  Gateway.
- No Next.js API routes for Copilot behavior.
- No Codex app-server `/turn` exposure in Web.
- No storing plaintext prompts containing secrets, API keys, attach tokens, or
  terminal transcripts.
- No remote execution integration in this first Copilot phase.

## Product Positioning

First version: "AI Copilot for operating OpenForge."

It is not an agent that replaces Claude Code, OpenCode, Codex, or a human
developer. It explains platform state and prepares controlled actions.

The Copilot should be available from:

- a right-side panel in the dashboard or project/session surfaces, or
- a dedicated `/copilot` page if the panel would crowd existing workflows.

The UI should show:

- current run status;
- model/provider used;
- tools the Copilot requested;
- tool results or errors;
- actions that require approval;
- a clear stop/cancel control.

## Approach Options Considered

### Recommended: read-heavy Copilot with approval-gated tools

The model can use a small set of read-only OpenForge tools. Low-risk write
actions are represented as pending actions that require user confirmation.

Pros:

- Delivers useful troubleshooting and workflow assistance quickly.
- Keeps terminal, filesystem, and provider credentials protected.
- Reuses existing Gateway services and audit/activity patterns.
- Creates a safe foundation for later controlled terminal supervision.

Cons:

- Less impressive than a fully autonomous developer demo.
- Requires careful UX so pending actions are not confused with completed work.

### Alternative: read-only advisor

The Copilot can inspect state and answer questions, but cannot prepare actions.

Pros:

- Smallest security and implementation surface.
- Good first proof of model-provider integration.

Cons:

- Weak product differentiation.
- Users still perform every recovery step manually.

### Alternative: session supervisor lite

The Copilot can observe terminal snapshots and suggest input for a tmux session,
with the user clicking to send each input.

Pros:

- Closer to the long-term "AI controls the IDE control plane" vision.
- Creates a visible bridge between platform Copilot and CLI sessions.

Cons:

- Requires terminal snapshot redaction, input preview, and stronger safety UX.
- Risks leaking secrets from terminal output.
- Easy to slide into autonomous terminal control too early.

This is a good Phase 2 candidate, not the first release.

## Architecture

```text
Web Copilot UI
  -> Gateway /api/v1/copilot/runs
  -> Copilot Orchestrator
  -> Model Client
     -> OpenAI Responses API
     -> Anthropic Messages API
  -> Tool Registry
  -> OpenForge services/repositories
  -> Audit, activities, diagnostics
```

Gateway stays the only runtime that can call model providers and execute
Copilot tools. Web only renders run state, messages, tool calls, and pending
actions.

### Model client

Create a provider-neutral model client for platform Copilot use. It should not
modify CLI launch behavior.

Provider support:

- OpenAI-compatible provider profiles with OpenAI Responses-style function
  calling.
- Anthropic provider profiles with Claude Messages-style tool use.

The client normalizes provider-specific events into internal shapes:

- `assistant_message`
- `tool_call_requested`
- `tool_result_submitted`
- `run_completed`
- `run_failed`

Tool schema should be strict where the provider supports it. Internally,
Gateway still validates every tool call with zod or an equivalent schema before
execution. Provider schema conformance is not a substitute for Gateway-side
validation.

### Provider selection

Use the existing Provider SSOT as the source for platform Copilot providers.

Requirements:

- Copilot provider/profile selection is explicit in Settings or Copilot UI.
- Provider credentials stay encrypted through the existing credential storage.
- Codex subscription identity remains separate from provider credentials.
- Applying provider config to Claude/OpenCode project files remains separate
  from choosing the Copilot model.

If no compatible provider is configured, Copilot UI should show a setup state
that links to model/provider configuration.

### Copilot runs

A Copilot run is a bounded model/tool loop started by a user prompt or a
predefined intent.

Suggested run fields:

- `id`
- `user_id`
- `status`: `queued`, `running`, `waiting_for_approval`, `completed`,
  `failed`, `cancelled`
- `provider_profile_id`
- `model_profile_id`
- `source`: `dashboard`, `project`, `session`, `settings`, `copilot`
- `source_ref_id`
- `goal`
- `step_count`
- `max_steps`
- `created_at`, `updated_at`, `completed_at`

Do not persist raw full terminal transcripts. If prompt/message persistence is
added, it must redact known secrets and allow diagnostics export to omit or
summarize sensitive content.

### Tool registry

Tools are platform capabilities exposed to the model. Each tool definition must
include:

- stable tool name;
- description;
- input schema;
- output schema or documented output shape;
- permission level;
- risk level;
- whether user confirmation is required;
- redaction policy;
- audit event type.

Tool classes:

- `read`: safe state lookup.
- `prepare`: creates a proposed action or draft plan without applying it.
- `write`: changes OpenForge state and requires confirmation in this first
  release.

First release should avoid direct `write` execution by the model. It should
return pending actions for the user to approve.

## First Tool Set

Start with a small tool set.

Read tools:

- `openforge.get_dashboard_summary`
- `openforge.list_projects`
- `openforge.get_project_detail`
- `openforge.list_sessions`
- `openforge.get_session_detail`
- `openforge.get_adapter_discovery`
- `openforge.get_diagnostics_summary`
- `openforge.get_recent_activity`

Prepare tools:

- `openforge.propose_session_create`
- `openforge.propose_diagnostics_export`
- `openforge.propose_troubleshooting_steps`

Approval-gated actions:

- export diagnostics JSON;
- refresh adapter discovery;
- navigate user to a project/session/provider setup surface;
- create a session draft from a proposed adapter/project choice.

Excluded tools:

- terminal input;
- shell command;
- file write;
- dependency install;
- git commit/push/merge;
- Codex app-server `turn/start`.

## Approval Model

The Copilot may suggest actions, but Web must render them as pending actions
before anything mutates state.

Approval rules:

- Read tools execute without approval.
- Prepare tools execute without approval because they only create proposals.
- Any state mutation requires explicit user confirmation.
- High-risk actions are not available in this first release.
- Approval records must include user id, action id, input payload, timestamp,
  and result.

The model should not be able to approve its own pending action.

## Safety And Privacy

Required controls:

- Tenant filtering on every tool.
- Gateway-side schema validation before tool execution.
- Per-run step limit.
- Per-user run concurrency limit.
- Request timeout and cancellation.
- Provider credential redaction.
- Attach-token redaction.
- API key, bearer token, password, private-key, and `sk-` style redaction.
- No terminal transcript persistence by default.
- Audit events for run start, tool call, pending action creation, approval,
  rejection, completion, and failure.

The Copilot must fail closed. If a tool result is too large, contains suspected
secrets, or crosses a path/tenant boundary, Gateway returns a redacted error
instead of sending raw data back to the model.

## Error Handling

Use explicit error codes that identify the failing layer:

- `copilot_provider_not_configured`
- `copilot_provider_auth_failed`
- `copilot_model_unavailable`
- `copilot_tool_not_allowed`
- `copilot_tool_validation_failed`
- `copilot_tool_execution_failed`
- `copilot_pending_action_required`
- `copilot_run_step_limit_exceeded`
- `copilot_run_cancelled`
- `copilot_redaction_blocked_output`

Web should show concise user-facing text and preserve diagnostic codes for
support reports.

## Data And API Direction

All APIs stay under `/api/v1`.

Proposed APIs:

- `GET /api/v1/copilot/capabilities`
- `GET /api/v1/copilot/runs`
- `POST /api/v1/copilot/runs`
- `GET /api/v1/copilot/runs/:id`
- `POST /api/v1/copilot/runs/:id/cancel`
- `POST /api/v1/copilot/runs/:id/pending-actions/:actionId/approve`
- `POST /api/v1/copilot/runs/:id/pending-actions/:actionId/reject`

Initial implementation can keep run execution synchronous behind the route for
simple prompts, but the API shape should allow later background execution and
event streaming through the existing `/ws/events` channel.

## UI Direction

First release UI should be operational, not decorative.

Recommended surface:

- Add a Copilot entry in the sidebar or dashboard.
- Provide context-aware launch buttons from Dashboard, Project detail, Session
  detail, and Settings.
- Show a run timeline with messages, tool calls, and pending actions.
- Clearly label proposed actions versus executed actions.
- Include "Stop" while a run is active.

Useful starter prompts:

- "Diagnose why sessions cannot launch."
- "Summarize this project's runtime readiness."
- "Help me prepare a session creation plan."
- "Review recent errors and suggest next steps."
- "Explain what to include in beta feedback."

## Phased Delivery

### Phase 0: design and implementation plan

Confirm this design, then write an implementation plan. No runtime code is
required in this phase.

### Phase 1: provider-backed Copilot text run

Add provider selection and a basic Copilot run route that can call OpenAI or
Anthropic and return a final answer without tools.

Acceptance:

- Provider credentials are decrypted only in Gateway memory.
- Missing provider setup has a clear UI/API error.
- Tests cover provider selection, auth failure, and response normalization.

### Phase 2: read-only tool registry

Add strict tool definitions and execute the read-only first tool set.

Acceptance:

- Tool calls are schema-validated in Gateway.
- Tenant filtering is enforced.
- Tool calls are audited.
- Step limits and cancellation are covered by tests.

### Phase 3: approval-gated prepare actions

Add pending actions for diagnostics export, adapter refresh, and session draft
creation.

Acceptance:

- The model cannot approve its own action.
- Web distinguishes proposed, approved, rejected, and executed actions.
- Audit logs link approval to the user and Copilot run.

### Phase 4: UX hardening and beta feedback

Add focused docs, diagnostics fields, starter prompts, and manual smoke.

Acceptance:

- Manual smoke covers dashboard diagnostics, missing CLI, missing provider, and
  proposed session creation.
- Diagnostics export includes Copilot capability state without leaking provider
  secrets or prompts.

## Future Directions

After the first Copilot release is stable, consider:

- session supervisor lite: terminal snapshot plus suggested input;
- user-confirmed terminal input;
- project planning and task decomposition tools;
- remote execution target awareness after SSH feature work lands;
- multi-run orchestration with budgets and pause/resume;
- autonomous developer mode behind a separate architecture review.

Each of these must have its own security review before implementation.

## References

- OpenAI Responses API and function calling:
  `https://developers.openai.com/api/docs/guides/migrate-to-responses`
  and `https://developers.openai.com/api/docs/guides/function-calling`.
- Anthropic Claude tool use:
  `https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools`
  and `https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview`.

## Decision

Proceed with a first-version AI Copilot that is read-heavy, provider-backed,
and approval-gated. Do not expose autonomous terminal control, raw shell, direct
file writes, or Codex app-server prompt/turn input in this phase.
