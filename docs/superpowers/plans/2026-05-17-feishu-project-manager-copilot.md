# Feishu Project Manager Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Feishu as a controlled Copilot collaboration channel and evolve Copilot into an approval-gated project manager for AI CLI development sessions.

**Architecture:** Gateway owns Feishu CLI discovery, command allowlisting, integration state, project-manager state, Copilot tools, approval execution, audit, and rate limits. Web renders Feishu integration settings and project-manager state. Feishu is a client/channel, not an execution authority; terminal input and writes continue through OpenForge pending actions.

**Tech Stack:** Node.js/Express, TypeScript, SQLite/better-sqlite3, Drizzle migrations, zod, Next.js App Router, React, TanStack Query, Tailwind, lucide-react, node:test, Vitest, Playwright, external `lark-cli`.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md`
- Copilot baseline spec: `docs/superpowers/specs/2026-05-11-platform-ai-copilot-design.md`
- API contract: `docs/API.md`
- Architecture rules: `CLAUDE.md`, `docs/TECH-ARCHITECTURE.md`
- Existing Copilot tools: `packages/gateway/src/services/copilot/read-tools.ts`
- Existing Copilot route and approval handling: `packages/gateway/src/routes/copilot.ts`
- Existing Copilot persistence: `packages/gateway/src/db/repositories/copilot-repository.ts`
- Existing Settings UI: `packages/web/src/app/(dashboard)/settings/page.tsx`
- Existing Web API client: `packages/web/src/lib/api.ts`

## Scope Boundaries

Implement in phases. Stop after any phase if the safety gates or tests are not
green.

This plan includes:

- Feishu CLI discovery and read-only integration status.
- Feishu integration settings UI.
- Approved outbound Feishu messages/docs/tasks.
- Authorized inbound Feishu commands routed into Copilot.
- Project goals, work items, development ledger, and project-manager Copilot
  tools.
- Later batch authorization with explicit budgets and stop conditions.

This plan excludes:

- Raw shell execution.
- Model-generated Feishu CLI command strings.
- Direct terminal input from Feishu messages.
- Unmapped Feishu approvals.
- Unattended autonomous development mode.
- Cloud-hosted runners or collaboration billing.

## File Structure

Gateway:

- Create `packages/gateway/src/services/integrations/feishu-cli.ts` for binary discovery, version/auth status, safe command invocation, structured output parsing, timeouts, and redaction.
- Create `packages/gateway/src/services/integrations/feishu-commands.ts` for the allowlisted Feishu command registry.
- Create `packages/gateway/src/db/repositories/feishu-integration-repository.ts` for tenant-scoped Feishu settings and user mappings.
- Create `packages/gateway/src/db/repositories/project-manager-repository.ts` for project goals, work items, ledger events, and batch authorizations.
- Add migrations after the current latest migration with Feishu and project-manager tables.
- Create `packages/gateway/src/routes/integrations-feishu.ts` for `/api/v1/integrations/feishu`.
- Modify `packages/gateway/src/routes/index.ts` to mount the Feishu route.
- Modify `packages/gateway/src/services/copilot/read-tools.ts` to add project-manager and Feishu read/prepare tools.
- Modify `packages/gateway/src/routes/copilot.ts` to approve Feishu and project-manager pending actions.
- Add tests in `packages/gateway/test/feishu-integration.test.ts`, `packages/gateway/test/project-manager-repository.test.ts`, `packages/gateway/test/copilot-tools.test.ts`, and `packages/gateway/test/copilot-routes.test.ts`.

Web:

- Modify `packages/web/src/lib/api.ts` and `packages/web/src/lib/api.test.ts` for Feishu/project-manager API client contracts.
- Modify `packages/web/src/app/(dashboard)/settings/page.tsx` to show Feishu integration status and controls.
- Modify `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` or split a project-manager panel component if the page is already too large.
- Modify `packages/web/src/lib/copilot.ts` and `packages/web/src/lib/copilot.test.ts` for new pending action labels and summaries.
- Modify `packages/web/src/lib/i18n.ts` and `packages/web/src/lib/i18n.test.ts` for user-facing copy.
- Add or extend Playwright coverage in `packages/web/e2e/copilot.spec.ts` and a future project-manager E2E file if the page flow grows.

Docs:

- Update `docs/API.md` for new endpoints, tools, pending actions, and safety boundaries.
- Update `docs/DEVELOPMENT-PLAN.md` with phase status after each completed slice.

## Task 1: Feishu CLI Discovery And Read-Only Status

**Files:**
- Create: `packages/gateway/src/services/integrations/feishu-cli.ts`
- Create: `packages/gateway/src/routes/integrations-feishu.ts`
- Modify: `packages/gateway/src/routes/index.ts`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/api.test.ts`
- Test: `packages/gateway/test/feishu-integration.test.ts`

- [ ] **Step 1: Write failing service tests**

Cover:

- missing `lark-cli` returns `{ available: false }`;
- version output is parsed into `{ available: true, version }`;
- auth status output is parsed from structured JSON;
- unparseable output fails closed;
- command timeout returns unavailable status without leaking stderr.

Run:

```bash
pnpm --dir packages/gateway test test/feishu-integration.test.ts
```

Expected: FAIL because service and route do not exist.

- [ ] **Step 2: Implement minimal Feishu CLI service**

Implement fixed executable discovery with a configurable path but no raw command
input. Use a command runner abstraction for tests. Parse only JSON/NDJSON for
auth status where supported; otherwise return a redacted unknown status.

- [ ] **Step 3: Add read-only status route**

Route:

```text
GET /api/v1/integrations/feishu/status
```

Response envelope:

```json
{
  "code": 0,
  "data": {
    "status": {
      "available": true,
      "version": "0.0.0",
      "authState": "authenticated",
      "identityMode": "unknown",
      "enabled": false
    }
  },
  "message": ""
}
```

- [ ] **Step 4: Add Web API client tests and client**

Add `getFeishuIntegrationStatus()` in `packages/web/src/lib/api.ts`.

Run:

```bash
pnpm --dir packages/web test src/lib/api.test.ts
```

Expected: PASS after client implementation.

- [ ] **Step 5: Verify Gateway route**

Run:

```bash
pnpm --dir packages/gateway test test/feishu-integration.test.ts
pnpm --dir packages/gateway typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/services/integrations packages/gateway/src/routes/integrations-feishu.ts packages/gateway/src/routes/index.ts packages/gateway/test/feishu-integration.test.ts packages/web/src/lib/api.ts packages/web/src/lib/api.test.ts
git commit -m "feat: add feishu integration status"
```

## Task 2: Feishu Settings UI And Diagnostics

**Files:**
- Modify: `packages/web/src/app/(dashboard)/settings/page.tsx`
- Modify: `packages/web/src/lib/i18n.ts`
- Modify: `packages/web/src/lib/i18n.test.ts`
- Modify: `packages/gateway/src/routes/diagnostics.ts` if diagnostics are centralized there, otherwise the existing diagnostics export service.
- Test: `packages/web/e2e/settings.spec.ts` if present, otherwise add focused coverage to an existing E2E file.

- [ ] **Step 1: Write failing UI/API copy tests**

Assert i18n includes Feishu integration labels and status strings in `zh-CN`,
`zh-TW`, and `en`.

Run:

```bash
pnpm --dir packages/web test src/lib/i18n.test.ts
```

Expected: FAIL until keys are added.

- [ ] **Step 2: Render Settings / Integrations / Feishu card**

The card shows:

- CLI available/missing;
- version;
- auth state;
- enabled/disabled;
- emergency disabled state;
- read-only note that remote control is not enabled in Phase 1.

Do not add Feishu writes or inbound control in this task.

- [ ] **Step 3: Add diagnostics field**

Diagnostics should include safe Feishu capability state only:

- available;
- version;
- auth state;
- enabled;
- identity mode.

Do not include tokens, cookies, full CLI stderr, chat ids, document ids, or user
mapping details.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --dir packages/web test src/lib/i18n.test.ts src/lib/api.test.ts
pnpm --dir packages/web typecheck
```

Run a focused Playwright test if a settings E2E exists or is added.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/\(dashboard\)/settings/page.tsx packages/web/src/lib/i18n.ts packages/web/src/lib/i18n.test.ts docs/API.md
git commit -m "feat: show feishu integration status"
```

## Task 3: Feishu Integration Persistence

**Files:**
- Create: next migration under `packages/gateway/src/db/migrations/`
- Modify: `packages/gateway/src/db/schema.ts`
- Create: `packages/gateway/src/db/repositories/feishu-integration-repository.ts`
- Modify: `packages/gateway/src/routes/integrations-feishu.ts`
- Test: `packages/gateway/test/feishu-integration.test.ts`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/api.test.ts`

- [ ] **Step 1: Write failing repository tests**

Cover:

- configs are tenant scoped;
- user mappings are tenant scoped;
- disabled flag prevents outbound/inbound action execution;
- allowed chat ids are normalized and bounded;
- no secret fields are persisted.

- [ ] **Step 2: Add migration and schema**

Tables:

- `integration_feishu_configs`
- `integration_feishu_user_mappings`

Every row includes `user_id`; repositories must automatically filter by
`user_id`.

- [ ] **Step 3: Add settings update endpoints**

Routes:

```text
GET /api/v1/integrations/feishu/config
PATCH /api/v1/integrations/feishu/config
GET /api/v1/integrations/feishu/user-mappings
PUT /api/v1/integrations/feishu/user-mappings
```

Use zod validation, bounded arrays, and audit logs for changes.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --dir packages/gateway test test/db-schema.test.ts test/feishu-integration.test.ts
pnpm --dir packages/gateway typecheck
pnpm --dir packages/web test src/lib/api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/db/schema.ts packages/gateway/src/db/migrations packages/gateway/src/db/repositories/feishu-integration-repository.ts packages/gateway/src/routes/integrations-feishu.ts packages/gateway/test/feishu-integration.test.ts packages/web/src/lib/api.ts packages/web/src/lib/api.test.ts docs/API.md
git commit -m "feat: persist feishu integration settings"
```

## Task 4: Approved Outbound Feishu Actions

**Files:**
- Create: `packages/gateway/src/services/integrations/feishu-commands.ts`
- Modify: `packages/gateway/src/services/copilot/read-tools.ts`
- Modify: `packages/gateway/src/routes/copilot.ts`
- Modify: `packages/web/src/lib/copilot.ts`
- Modify: `packages/web/src/lib/copilot.test.ts`
- Modify: `packages/web/src/lib/i18n.ts`
- Test: `packages/gateway/test/copilot-tools.test.ts`
- Test: `packages/gateway/test/copilot-routes.test.ts`

- [ ] **Step 1: Write failing tool tests**

Cover these prepare tools:

- `openforge.propose_feishu_message_send`
- `openforge.propose_feishu_doc_create`
- `openforge.propose_feishu_doc_update`
- `openforge.propose_feishu_task_create`
- `openforge.propose_feishu_task_update`

Assert they create pending actions only and never execute Feishu CLI during model
tool execution.

- [ ] **Step 2: Implement Feishu command allowlist**

Commands define schemas, output parsers, timeouts, and redaction. Reject
unknown operations and all raw command strings.

- [ ] **Step 3: Implement approval handlers**

Approval handlers execute the allowlisted Feishu command, record audit rows, add
Copilot timeline events, and return redacted result details.

- [ ] **Step 4: Update Web pending action labels**

Add clear summaries for message/doc/task actions. Show target channel/document
ids only if they are safe and bounded.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --dir packages/gateway test test/copilot-tools.test.ts test/copilot-routes.test.ts
pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/i18n.test.ts
pnpm --dir packages/web exec playwright test e2e/copilot.spec.ts --project=chromium
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/services/integrations packages/gateway/src/services/copilot/read-tools.ts packages/gateway/src/routes/copilot.ts packages/gateway/test/copilot-tools.test.ts packages/gateway/test/copilot-routes.test.ts packages/web/src/lib/copilot.ts packages/web/src/lib/copilot.test.ts packages/web/src/lib/i18n.ts docs/API.md
git commit -m "feat: add approved feishu copilot actions"
```

## Task 5: Inbound Feishu Command Bridge

**Files:**
- Modify: `packages/gateway/src/routes/integrations-feishu.ts`
- Modify: `packages/gateway/src/routes/copilot.ts`
- Modify: `packages/gateway/src/db/repositories/copilot-repository.ts` only if `source` needs migration support.
- Modify: `packages/web/src/lib/api.ts`
- Test: `packages/gateway/test/feishu-integration.test.ts`
- Test: `packages/gateway/test/copilot-routes.test.ts`

- [ ] **Step 1: Write failing inbound tests**

Cover:

- unauthorized chat is rejected without leaking project data;
- unmapped Feishu user cannot approve actions;
- mapped Feishu user can create a Copilot conversation/run with `source:
  "feishu"`;
- inbound command text is redacted before persistence/provider requests;
- free-form approval text does not approve actions.

- [ ] **Step 2: Add source support**

Add `feishu` as a Copilot source only if all repository, API, and Web type paths
are updated together.

- [ ] **Step 3: Add inbound route or event adapter**

Start with an explicit Gateway route for tests:

```text
POST /api/v1/integrations/feishu/inbound
```

Later replace or supplement it with `lark-cli` event watch or Feishu webhook
ingestion. The route must require a configured secret or local-only guard before
exposure beyond localhost.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts
pnpm --dir packages/gateway typecheck
pnpm --dir packages/web test src/lib/api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/routes/integrations-feishu.ts packages/gateway/src/routes/copilot.ts packages/gateway/test/feishu-integration.test.ts packages/gateway/test/copilot-routes.test.ts packages/web/src/lib/api.ts docs/API.md
git commit -m "feat: route feishu commands to copilot"
```

## Task 6: Project Manager Persistence

**Files:**
- Create: next migration under `packages/gateway/src/db/migrations/`
- Modify: `packages/gateway/src/db/schema.ts`
- Create: `packages/gateway/src/db/repositories/project-manager-repository.ts`
- Create: `packages/gateway/test/project-manager-repository.test.ts`
- Modify: `packages/gateway/src/routes/projects.ts` or create `packages/gateway/src/routes/project-manager.ts`

- [ ] **Step 1: Write failing repository tests**

Cover:

- project goals are tenant scoped and project scoped;
- work items are tenant scoped and project scoped;
- ledger events are append-only;
- work item completion requires evidence summary;
- batch authorizations have expiry, status, budget fields, and stop reason.

- [ ] **Step 2: Add migration and schema**

Tables:

- `project_goals`
- `project_work_items`
- `project_development_events`
- `project_batch_authorizations`

- [ ] **Step 3: Add project-manager read APIs**

Routes:

```text
GET /api/v1/projects/:id/manager
GET /api/v1/projects/:id/manager/work-items
GET /api/v1/projects/:id/manager/ledger
```

Writes should initially be through Copilot pending actions, not direct Web form
mutations, unless a later UX task explicitly adds manual editing.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --dir packages/gateway test test/db-schema.test.ts test/project-manager-repository.test.ts
pnpm --dir packages/gateway typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/db/schema.ts packages/gateway/src/db/migrations packages/gateway/src/db/repositories/project-manager-repository.ts packages/gateway/src/routes packages/gateway/test/project-manager-repository.test.ts docs/API.md
git commit -m "feat: add project manager state"
```

## Task 7: Project Manager Copilot Tools And UI

**Files:**
- Modify: `packages/gateway/src/services/copilot/read-tools.ts`
- Modify: `packages/gateway/src/routes/copilot.ts`
- Modify: `packages/web/src/app/(dashboard)/projects/[id]/page.tsx`
- Prefer create: `packages/web/src/components/projects/project-manager-panel.tsx`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/copilot.ts`
- Test: `packages/gateway/test/copilot-tools.test.ts`
- Test: `packages/gateway/test/copilot-routes.test.ts`
- Test: `packages/web/src/lib/copilot.test.ts`

- [ ] **Step 1: Write failing Copilot tool tests**

Cover:

- read tools return only current user's project-manager state;
- prepare tools create pending actions only;
- work item completion without evidence is rejected;
- project run next step requires same-run project/session evidence.

- [ ] **Step 2: Add project-manager tools**

Read tools:

- `openforge.get_project_goal`
- `openforge.list_project_work_items`
- `openforge.get_project_work_item`
- `openforge.get_project_development_ledger`

Prepare tools:

- `openforge.propose_project_goal_update`
- `openforge.propose_project_work_item_create`
- `openforge.propose_project_work_item_update`
- `openforge.propose_project_run_next_step`

- [ ] **Step 3: Add approval handlers**

Approval records project-manager mutations and appends ledger events. For
`propose_project_run_next_step`, approval should create or update a linked
session input pending action rather than bypassing terminal input approval.

- [ ] **Step 4: Render project manager panel**

Panel shows:

- current goal;
- acceptance criteria;
- work items;
- linked sessions;
- latest ledger entries;
- pending Copilot actions;
- Feishu sync status when available.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --dir packages/gateway test test/copilot-tools.test.ts test/copilot-routes.test.ts test/project-manager-repository.test.ts
pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts
pnpm --dir packages/web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/services/copilot/read-tools.ts packages/gateway/src/routes/copilot.ts packages/gateway/test/copilot-tools.test.ts packages/gateway/test/copilot-routes.test.ts packages/web/src/app/\(dashboard\)/projects/\[id\]/page.tsx packages/web/src/components/projects packages/web/src/lib/api.ts packages/web/src/lib/copilot.ts packages/web/src/lib/copilot.test.ts docs/API.md
git commit -m "feat: add project manager copilot tools"
```

## Task 8: Batch Authorization Foundation

**Files:**
- Modify: `packages/gateway/src/db/repositories/project-manager-repository.ts`
- Modify: `packages/gateway/src/routes/copilot.ts`
- Modify: `packages/gateway/src/services/copilot/read-tools.ts`
- Modify: project manager Web panel.
- Test: `packages/gateway/test/copilot-routes.test.ts`
- Test: `packages/gateway/test/project-manager-repository.test.ts`

- [ ] **Step 1: Write failing budget tests**

Cover:

- expired budget cannot execute actions;
- exhausted step budget pauses run;
- destructive/high-risk action pauses even with budget;
- terminal input remains explicit approval unless a separate terminal-input
  budget is present;
- approval replay cannot reuse a budget grant.

- [ ] **Step 2: Add `openforge.propose_batch_authorization`**

The pending action includes:

- project id;
- goal id;
- allowed action classes;
- max steps;
- max duration;
- stop conditions;
- expiration.

- [ ] **Step 3: Add budget enforcement helper**

Budget helper is called before any auto-executed project-manager action. It
never approves model-generated terminal input by itself in the first batch
release.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --dir packages/gateway test test/project-manager-repository.test.ts test/copilot-routes.test.ts test/copilot-tools.test.ts
pnpm --dir packages/gateway typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/db/repositories/project-manager-repository.ts packages/gateway/src/routes/copilot.ts packages/gateway/src/services/copilot/read-tools.ts packages/gateway/test docs/API.md
git commit -m "feat: add copilot batch authorization"
```

## Task 9: Final Verification And Documentation

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/DEVELOPMENT-PLAN.md`
- Modify: `docs/TEST-PLAN.md` if new acceptance gates are added.

- [ ] **Step 1: Run full relevant verification**

Run:

```bash
pnpm --dir packages/gateway test test/feishu-integration.test.ts test/project-manager-repository.test.ts test/copilot-tools.test.ts test/copilot-routes.test.ts
pnpm --dir packages/web test src/lib/api.test.ts src/lib/copilot.test.ts src/lib/i18n.test.ts
pnpm --dir packages/web exec playwright test e2e/copilot.spec.ts --project=chromium
pnpm --dir packages/gateway typecheck
pnpm --dir packages/web typecheck
git diff --check
```

- [ ] **Step 2: Audit safety checklist**

Confirm:

- no model-controlled raw Feishu CLI command;
- no Feishu direct terminal input;
- no approval without mapped OpenForge user;
- no secrets in diagnostics, audit, tool output, or provider prompt;
- every new table is tenant scoped;
- every write has an audit path;
- emergency disable stops Feishu actions.

- [ ] **Step 3: Update docs**

Document endpoints, tool names, pending actions, Feishu setup guidance, and
batch authorization boundaries.

- [ ] **Step 4: Commit docs**

```bash
git add docs/API.md docs/DEVELOPMENT-PLAN.md docs/TEST-PLAN.md
git commit -m "docs: document feishu project manager copilot"
```

## Execution Order Recommendation

Start with Tasks 1-2 only. They produce a safe, user-visible Feishu integration
status with no remote control. After that, implement Task 3 persistence and Task
4 approved outbound Feishu actions. Do not implement inbound control or project
manager batch authorization until the earlier phases are merged and verified.
