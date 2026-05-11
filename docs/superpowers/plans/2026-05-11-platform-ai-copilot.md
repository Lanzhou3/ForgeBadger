# Platform AI Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Platform AI Copilot release: a provider-backed, read-heavy, approval-gated OpenForge assistant that can answer operational questions and prepare safe actions without autonomous terminal control.

**Architecture:** Gateway owns Copilot model calls, run state, tool validation, audit, and approval handling under `/api/v1/copilot`. Web renders a Copilot page and pending actions. Provider selection reuses the existing Provider SSOT and encrypted credentials; Codex subscription identity, tmux terminal input, Codex app-server `/turn`, raw shell, and file writes remain outside this release.

**Tech Stack:** Node.js/Express, TypeScript, SQLite/better-sqlite3, Drizzle migrations, zod, Next.js App Router, React, TanStack Query, Tailwind, lucide-react, node:test, Vitest.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-11-platform-ai-copilot-design.md`
- Architecture rules: `CLAUDE.md`, `docs/TECH-ARCHITECTURE.md`
- Provider source of truth: `packages/gateway/src/db/repositories/model-provider-repository.ts`
- Existing route mount pattern: `packages/gateway/src/routes/index.ts`
- Existing Web API client: `packages/web/src/lib/api.ts`
- Sidebar navigation: `packages/web/src/components/layout/sidebar.tsx`
- OpenClaw reference: provider-owned runtime seams, memory recall tools, active
  memory gating, session tool visibility, and exec approval canonical-plan
  handling.

## Scope Boundaries

This plan includes:

- Provider-backed Copilot text runs.
- OpenAI Responses-style and Anthropic Messages-style response normalization.
- Copilot run persistence and audit-ready events.
- First Web Copilot page.
- Read-only tool registry.
- Approval-gated prepare actions.

This plan excludes:

- Automatic terminal input.
- Any raw shell tool.
- Direct filesystem writes.
- Dependency install or git operations.
- Codex app-server prompt or `/turn` UI.
- SSH/remote execution integration.
- Cross-session send/spawn or autonomous sub-agent orchestration.
- Silent long-term memory writes.

## OpenClaw Reference Constraints

The OpenClaw reference should influence module boundaries, not relax OpenForge
safety. Apply these constraints while implementing:

- Keep the first provider implementation concrete, but isolate provider-specific
  transport, tool-schema, auth-hint, and failover behavior behind
  `CopilotModelClient` / provider-selection seams so future provider quirks do
  not leak across the orchestrator.
- Treat memory as explicit Gateway-owned product state. OpenClaw uses Markdown
  memory files; OpenForge should use tenant-scoped SQLite rows first, with
  optional Markdown export/import later.
- Add memory recall only as bounded tools (`openforge.memory_search`,
  `openforge.memory_get`) and add memory writes only as prepared actions
  (`openforge.propose_memory_write`).
- If an active-recall pass is added, it can call only memory tools, must have a
  hard timeout and circuit breaker, and must continue the run with no memory
  context when recall is unavailable or weak.
- Do not add OpenClaw-style host exec, session send, session spawn, or
  background sub-agent tools to this Copilot release.
- Pending-action approval must execute the canonical stored action payload. Do
  not trust a fresh client payload at approval time.

## File Map

Gateway files to create:

- `packages/gateway/src/db/repositories/copilot-repository.ts` - tenant-scoped run, event, and pending-action persistence.
- `packages/gateway/src/db/migrations/0013_copilot.sql` - additive Copilot tables.
- `packages/gateway/src/services/copilot/types.ts` - shared internal Copilot types.
- `packages/gateway/src/services/copilot/redaction.ts` - prompt/tool/result redaction helpers.
- `packages/gateway/src/services/copilot/provider-selection.ts` - select provider, model, and credential from Provider SSOT.
- `packages/gateway/src/services/copilot/model-client.ts` - provider-neutral model client interface.
- `packages/gateway/src/services/copilot/openai-responses-client.ts` - OpenAI Responses-compatible adapter.
- `packages/gateway/src/services/copilot/anthropic-messages-client.ts` - Anthropic Messages adapter.
- `packages/gateway/src/services/copilot/tool-registry.ts` - tool registration, validation, and risk metadata.
- `packages/gateway/src/services/copilot/read-tools.ts` - read-only OpenForge tools.
- `packages/gateway/src/services/copilot/orchestrator.ts` - bounded run loop and tool execution coordinator.
- `packages/gateway/src/routes/copilot.ts` - authenticated `/api/v1/copilot` routes.
- `packages/gateway/test/copilot-repository.test.ts`
- `packages/gateway/test/copilot-model-client.test.ts`
- `packages/gateway/test/copilot-routes.test.ts`
- `packages/gateway/test/copilot-tools.test.ts`

Gateway files to modify:

- `packages/gateway/src/db/schema.ts` - add Copilot table definitions.
- `packages/gateway/src/routes/index.ts` - mount `/api/v1/copilot`.
- `packages/gateway/test/db-schema.test.ts` - assert new tables exist.

Web files to create:

- `packages/web/src/app/(dashboard)/copilot/page.tsx` - first Copilot page.
- `packages/web/src/lib/copilot.ts` - display helpers for run status, event labels, pending action labels.
- `packages/web/src/lib/copilot.test.ts`

Web files to modify:

- `packages/web/src/lib/api.ts` - Copilot types and API helpers.
- `packages/web/src/lib/api.test.ts` - API helper coverage.
- `packages/web/src/components/layout/sidebar.tsx` - add Copilot navigation item.
- `packages/web/src/lib/i18n.ts` - zh-CN, zh-TW, en strings.
- `packages/web/src/lib/i18n.test.ts` - key coverage.

Docs to modify:

- `docs/API.md` - Copilot API section.
- `docs/DEVELOPMENT-PLAN.md` - mark implementation plan ready or in progress.
- `docs/TRIAL-CHECKLIST.md` or `docs/TRIAL-FEEDBACK.md` only after UI exists.

---

### Task 1: Copilot Persistence Foundation

**Files:**
- Create: `packages/gateway/src/db/migrations/0013_copilot.sql`
- Create: `packages/gateway/src/db/repositories/copilot-repository.ts`
- Modify: `packages/gateway/src/db/schema.ts`
- Modify: `packages/gateway/test/db-schema.test.ts`
- Test: `packages/gateway/test/copilot-repository.test.ts`

- [ ] **Step 1: Write the DB schema test first**

Add the new table names to `packages/gateway/test/db-schema.test.ts`:

```ts
assert.deepEqual(names, [
  "agents",
  "api_keys",
  "audit_logs",
  "catalog_items",
  "catalog_sources",
  "copilot_pending_actions",
  "copilot_run_events",
  "copilot_runs",
  // existing names...
]);
```

- [ ] **Step 2: Run schema test and verify it fails**

Run:

```bash
pnpm --dir packages/gateway test -- test/db-schema.test.ts
```

Expected: FAIL because `copilot_runs`, `copilot_run_events`, and `copilot_pending_actions` do not exist.

- [ ] **Step 3: Add migration `0013_copilot.sql`**

Create additive tables only:

```sql
CREATE TABLE `copilot_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `status` text NOT NULL,
  `provider_profile_id` text,
  `model_profile_id` text,
  `source` text NOT NULL,
  `source_ref_id` text,
  `goal` text NOT NULL,
  `step_count` integer DEFAULT 0 NOT NULL,
  `max_steps` integer DEFAULT 8 NOT NULL,
  `error_code` text,
  `error_message` text,
  `created_at` integer,
  `updated_at` integer,
  `completed_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade,
  FOREIGN KEY (`provider_profile_id`) REFERENCES `model_provider_profiles`(`id`) ON DELETE set null,
  FOREIGN KEY (`model_profile_id`) REFERENCES `model_profiles`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_runs_user_created` ON `copilot_runs` (`user_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `copilot_run_events` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `run_id` text NOT NULL,
  `type` text NOT NULL,
  `sequence` integer NOT NULL,
  `message` text,
  `payload_json` text NOT NULL DEFAULT '{}',
  `created_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `copilot_runs`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_run_events_run_sequence` ON `copilot_run_events` (`run_id`, `sequence`);
--> statement-breakpoint
CREATE TABLE `copilot_pending_actions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `run_id` text NOT NULL,
  `type` text NOT NULL,
  `status` text NOT NULL,
  `input_json` text NOT NULL DEFAULT '{}',
  `result_json` text,
  `approved_by` text,
  `approved_at` integer,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `copilot_runs`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_pending_actions_run` ON `copilot_pending_actions` (`run_id`, `status`);
```

- [ ] **Step 4: Add Drizzle table definitions**

Modify `packages/gateway/src/db/schema.ts` with `copilotRuns`, `copilotRunEvents`, and `copilotPendingActions`. Keep every business table scoped by `userId`.

- [ ] **Step 5: Write repository tests**

Create `packages/gateway/test/copilot-repository.test.ts` covering:

- creates a run scoped to one user;
- lists only the current user's runs;
- appends events with increasing sequence;
- creates pending actions in `pending` state;
- prevents cross-user reads by returning `undefined` or empty lists.

Use the existing in-memory migration pattern from `packages/gateway/test/db-schema.test.ts`.

- [ ] **Step 6: Implement `CopilotRepository`**

Create `packages/gateway/src/db/repositories/copilot-repository.ts` with:

```ts
export class CopilotRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}
  createRun(input: CreateCopilotRunInput): CopilotRun;
  getRun(id: string): CopilotRun | undefined;
  listRuns(limit?: number): CopilotRun[];
  updateRun(id: string, input: UpdateCopilotRunInput): CopilotRun | undefined;
  addEvent(runId: string, input: CreateCopilotRunEventInput): CopilotRunEvent;
  listEvents(runId: string): CopilotRunEvent[];
  createPendingAction(runId: string, input: CreatePendingActionInput): CopilotPendingAction;
  updatePendingAction(actionId: string, input: UpdatePendingActionInput): CopilotPendingAction | undefined;
}
```

All SQL must include `WHERE user_id = ?` for reads and writes that touch tenant-owned rows.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --dir packages/gateway test -- test/db-schema.test.ts test/copilot-repository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/gateway/src/db/schema.ts packages/gateway/src/db/migrations/0013_copilot.sql packages/gateway/src/db/repositories/copilot-repository.ts packages/gateway/test/db-schema.test.ts packages/gateway/test/copilot-repository.test.ts
git commit -m "feat: add copilot persistence"
```

---

### Task 2: Provider-Backed Model Client

**Files:**
- Create: `packages/gateway/src/services/copilot/types.ts`
- Create: `packages/gateway/src/services/copilot/redaction.ts`
- Create: `packages/gateway/src/services/copilot/provider-selection.ts`
- Create: `packages/gateway/src/services/copilot/model-client.ts`
- Create: `packages/gateway/src/services/copilot/openai-responses-client.ts`
- Create: `packages/gateway/src/services/copilot/anthropic-messages-client.ts`
- Test: `packages/gateway/test/copilot-model-client.test.ts`

- [ ] **Step 1: Write provider selection tests**

In `packages/gateway/test/copilot-model-client.test.ts`, set up in-memory DB, create a provider profile, model profile, and credential through `ModelProviderRepository`, then assert:

- OpenAI `apiFormat: "openai"` selects the OpenAI Responses client.
- OpenAI-compatible selects the OpenAI Responses client only when explicitly allowed by the Copilot client policy.
- Anthropic `apiFormat: "anthropic"` selects the Anthropic Messages client.
- Missing credential for `authType !== "none"` returns `copilot_provider_not_configured`.
- Codex subscription status is not used for Copilot provider credentials.

- [ ] **Step 2: Write normalization tests with fake fetch**

Use injected fetch functions. Do not call the network.

Expected OpenAI normalized output:

```ts
{
  type: "assistant_message",
  text: "Gateway is healthy."
}
```

Expected Anthropic normalized output:

```ts
{
  type: "assistant_message",
  text: "Gateway is healthy."
}
```

Also test redaction of `sk-test`, `Bearer token`, and `OPENFORGE_ATTACH_TOKEN`.

- [ ] **Step 3: Implement shared types**

In `types.ts`, define:

```ts
export type CopilotProviderFormat = "openai" | "openai-compatible" | "anthropic";
export type CopilotModelEvent =
  | { type: "assistant_message"; text: string }
  | { type: "tool_call_requested"; id: string; name: string; input: unknown }
  | { type: "run_failed"; code: string; message: string };

export interface CopilotModelRequest {
  model: string;
  instructions: string;
  input: string;
  tools?: CopilotToolDefinition[];
  maxOutputTokens?: number;
}
```

- [ ] **Step 4: Implement redaction**

In `redaction.ts`, include deterministic regex-based redaction:

- `Bearer ...`
- `sk-...`
- keys matching `/api[_-]?key|token|password|secret|private[_-]?key/i`
- `OPENFORGE_ATTACH_TOKEN=...`

Do not over-redact ordinary project names.

- [ ] **Step 5: Implement provider selection**

`provider-selection.ts` should:

- use `ModelProviderRepository`;
- validate provider/model ownership through repository methods;
- select explicit `providerProfileId` and `modelProfileId` from request when present;
- otherwise select a default active model from compatible providers;
- decrypt credentials only after ownership and provider compatibility are confirmed;
- return structured errors, not thrown secrets.

- [ ] **Step 6: Implement OpenAI Responses client**

Use `fetch` directly. Default URL:

- provider base URL ending in `/v1` -> `${baseUrl}/responses`
- provider base URL ending in `/responses` -> use as-is
- no base URL for OpenAI catalog should not happen; still guard with `copilot_provider_not_configured`

Headers:

```ts
{
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json"
}
```

Request body:

```ts
{
  model,
  instructions,
  input,
  max_output_tokens: maxOutputTokens ?? 1024,
  tools
}
```

Parse `output_text` first, then fall back to text items in `output`.

- [ ] **Step 7: Implement Anthropic Messages client**

Default URL:

- provider base URL -> `${baseUrl}/v1/messages` unless it already ends in `/v1/messages`.

Headers:

```ts
{
  "x-api-key": apiKey,
  "anthropic-version": "2023-06-01",
  "Content-Type": "application/json"
}
```

Request body:

```ts
{
  model,
  max_tokens: maxOutputTokens ?? 1024,
  system: instructions,
  messages: [{ role: "user", content: input }],
  tools
}
```

Parse `content` text blocks and `tool_use` blocks into normalized events.

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm --dir packages/gateway test -- test/copilot-model-client.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/gateway/src/services/copilot packages/gateway/test/copilot-model-client.test.ts
git commit -m "feat: add copilot model client"
```

---

### Task 3: Copilot Run Routes Without Tools

**Files:**
- Create: `packages/gateway/src/services/copilot/orchestrator.ts`
- Create: `packages/gateway/src/routes/copilot.ts`
- Modify: `packages/gateway/src/routes/index.ts`
- Test: `packages/gateway/test/copilot-routes.test.ts`

- [ ] **Step 1: Write route tests first**

Test cases:

- `GET /api/v1/copilot/capabilities` returns supported provider formats and `toolExecutionEnabled: false`.
- `POST /api/v1/copilot/runs` rejects unauthenticated requests.
- `POST /api/v1/copilot/runs` returns `400` for empty prompt.
- `POST /api/v1/copilot/runs` returns `400` with `copilot_provider_not_configured` when no compatible provider exists.
- Successful run creates a `completed` run and at least one assistant event.
- The response envelope remains `{ code: 0, data, message: "" }`.

Use a fake model client injected into route options to avoid network calls.

- [ ] **Step 2: Implement orchestrator text-only path**

`orchestrator.ts` should:

- create a run with `running` status;
- call provider selection;
- call the injected or default model client;
- redact event text before persistence;
- persist assistant events;
- mark run `completed` or `failed`;
- enforce `maxSteps` even though tool calls are disabled in this task.

- [ ] **Step 3: Implement routes**

`routes/copilot.ts` should expose:

- `GET /capabilities`
- `GET /runs`
- `POST /runs`
- `GET /runs/:id`
- `POST /runs/:id/cancel`

Route schema:

```ts
const createRunSchema = z.object({
  prompt: z.string().min(1).max(32 * 1024),
  providerProfileId: z.string().min(1).optional(),
  modelProfileId: z.string().min(1).optional(),
  source: z.enum(["dashboard", "project", "session", "settings", "copilot"]).default("copilot"),
  sourceRefId: z.string().min(1).optional()
});
```

- [ ] **Step 4: Mount the route**

Modify `packages/gateway/src/routes/index.ts`:

```ts
import { createCopilotRoutes } from "./copilot.js";

app.use("/api/v1/copilot", createCopilotRoutes({
  db: deps.db,
  masterKey: deps.masterKey
}));
```

Do not add Gateway behavior to Next.js API routes.

- [ ] **Step 5: Run focused route tests**

Run:

```bash
pnpm --dir packages/gateway test -- test/copilot-routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run Gateway typecheck**

Run:

```bash
pnpm --dir packages/gateway typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/services/copilot/orchestrator.ts packages/gateway/src/routes/copilot.ts packages/gateway/src/routes/index.ts packages/gateway/test/copilot-routes.test.ts
git commit -m "feat: add copilot run API"
```

---

### Task 4: Web Copilot Page And API Client

**Files:**
- Create: `packages/web/src/app/(dashboard)/copilot/page.tsx`
- Create: `packages/web/src/lib/copilot.ts`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/api.test.ts`
- Modify: `packages/web/src/components/layout/sidebar.tsx`
- Modify: `packages/web/src/lib/i18n.ts`
- Modify: `packages/web/src/lib/i18n.test.ts`
- Test: `packages/web/src/lib/copilot.test.ts`

- [ ] **Step 1: Write API client tests**

In `packages/web/src/lib/api.test.ts`, cover:

- `getCopilotCapabilities()` calls `/api/v1/copilot/capabilities`.
- `createCopilotRun({ prompt })` posts to `/api/v1/copilot/runs`.
- `listCopilotRuns()` calls `/api/v1/copilot/runs`.
- `getCopilotRun(id)` calls `/api/v1/copilot/runs/:id`.
- `cancelCopilotRun(id)` posts to `/api/v1/copilot/runs/:id/cancel`.

- [ ] **Step 2: Add Web API types and helpers**

In `packages/web/src/lib/api.ts`, add:

```ts
export interface CopilotRun {
  id: string;
  status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled" | string;
  goal: string;
  source: string;
  sourceRefId?: string | null;
  providerProfileId?: string | null;
  modelProfileId?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  completedAt?: number | null;
}

export interface CopilotRunEvent {
  id: string;
  runId: string;
  type: string;
  sequence: number;
  message?: string | null;
  payload?: Record<string, unknown>;
  createdAt?: number | null;
}
```

- [ ] **Step 3: Add display helper tests**

Create `packages/web/src/lib/copilot.test.ts` for:

- status tone mapping;
- pending action label fallback;
- event label fallback.

- [ ] **Step 4: Implement display helpers**

Create `packages/web/src/lib/copilot.ts` with small pure functions only. Keep UI formatting out of API helpers.

- [ ] **Step 5: Add i18n keys**

Add zh-CN, zh-TW, and en keys:

- `nav.copilot`
- `copilot.title`
- `copilot.subtitle`
- `copilot.promptPlaceholder`
- `copilot.start`
- `copilot.stop`
- `copilot.runs`
- `copilot.noRuns`
- `copilot.providerSetupRequired`
- `copilot.pendingActions`
- `copilot.proposedAction`

Update `packages/web/src/lib/i18n.test.ts` to assert at least representative keys for all languages.

- [ ] **Step 6: Add navigation item**

Modify `packages/web/src/components/layout/sidebar.tsx`:

```ts
import { Sparkles } from "lucide-react";

{ labelKey: "nav.copilot", href: "/copilot", icon: Sparkles }
```

Place Copilot near Dashboard or after Sessions. Keep separators stable and verify collapsed labels.

- [ ] **Step 7: Implement first page**

Create `packages/web/src/app/(dashboard)/copilot/page.tsx` using existing card/button/input styling.

Page requirements:

- prompt textarea or input;
- start button;
- disabled state when prompt is empty;
- latest run timeline;
- provider setup error state;
- stop/cancel button when status is `running`;
- no terminal input controls;
- no shell-like text box.

- [ ] **Step 8: Run focused Web tests**

Run:

```bash
pnpm --dir packages/web test
```

Expected: PASS.

- [ ] **Step 9: Run Web typecheck**

Run:

```bash
pnpm --dir packages/web typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add 'packages/web/src/app/(dashboard)/copilot/page.tsx' packages/web/src/lib/api.ts packages/web/src/lib/api.test.ts packages/web/src/lib/copilot.ts packages/web/src/lib/copilot.test.ts packages/web/src/components/layout/sidebar.tsx packages/web/src/lib/i18n.ts packages/web/src/lib/i18n.test.ts
git commit -m "feat: add copilot web surface"
```

---

### Task 5: Read-Only Tool Registry

**Files:**
- Create: `packages/gateway/src/services/copilot/tool-registry.ts`
- Create: `packages/gateway/src/services/copilot/read-tools.ts`
- Modify: `packages/gateway/src/services/copilot/types.ts`
- Modify: `packages/gateway/src/services/copilot/orchestrator.ts`
- Test: `packages/gateway/test/copilot-tools.test.ts`
- Test: `packages/gateway/test/copilot-routes.test.ts`

- [ ] **Step 1: Write tool registry tests**

Cover:

- unknown tool is rejected with `copilot_tool_not_allowed`;
- invalid input is rejected with `copilot_tool_validation_failed`;
- read tools execute without approval;
- tool outputs are redacted before being returned to the model;
- tool execution is tenant-scoped.

- [ ] **Step 2: Define tool metadata**

In `tool-registry.ts`:

```ts
export interface CopilotToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  risk: "read" | "prepare" | "write";
  requiresApproval: boolean;
  inputSchema: z.ZodType<TInput>;
  execute(input: TInput, context: CopilotToolContext): Promise<TOutput>;
}
```

Use zod schemas locally and convert to provider schemas separately. Never trust provider schema validation alone.

- [ ] **Step 3: Implement first read tools**

Start with:

- `openforge.get_dashboard_summary`
- `openforge.list_projects`
- `openforge.list_sessions`
- `openforge.get_adapter_discovery`
- `openforge.get_recent_activity`

Use existing repositories/services where possible. Do not call route handlers internally.

- [ ] **Step 4: Extend orchestrator to handle tool calls**

The loop should:

1. call model;
2. persist assistant message or tool request event;
3. validate tool request;
4. execute read tool;
5. send tool result back to provider;
6. stop at final assistant message or `maxSteps`.

If provider-specific tool-result continuations are too large for one change, keep Task 5 to one model provider first and document the second provider in Task 6. Do not silently claim both providers support tools until tests cover both.

- [ ] **Step 5: Update capabilities route**

Return:

```ts
{
  toolExecutionEnabled: true,
  readTools: ["openforge.get_dashboard_summary", "..."],
  approvalRequiredForWrites: true
}
```

- [ ] **Step 6: Run Gateway tests**

Run:

```bash
pnpm --dir packages/gateway test -- test/copilot-tools.test.ts test/copilot-routes.test.ts
pnpm --dir packages/gateway typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/services/copilot packages/gateway/test/copilot-tools.test.ts packages/gateway/test/copilot-routes.test.ts
git commit -m "feat: add copilot read tools"
```

---

### Task 6: Approval-Gated Prepare Actions

**Files:**
- Modify: `packages/gateway/src/services/copilot/tool-registry.ts`
- Modify: `packages/gateway/src/services/copilot/orchestrator.ts`
- Modify: `packages/gateway/src/routes/copilot.ts`
- Modify: `packages/web/src/app/(dashboard)/copilot/page.tsx`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/copilot.ts`
- Test: `packages/gateway/test/copilot-routes.test.ts`
- Test: `packages/gateway/test/copilot-tools.test.ts`
- Test: `packages/web/src/lib/api.test.ts`
- Test: `packages/web/src/lib/copilot.test.ts`

- [ ] **Step 1: Write pending action tests**

Gateway tests should cover:

- `openforge.propose_session_create` creates a pending action, not a session.
- `openforge.propose_diagnostics_export` creates a pending action, not a file download.
- approve endpoint rejects actions outside the current user.
- reject endpoint marks action rejected.
- model cannot self-approve because approval requires authenticated route call.

- [ ] **Step 2: Add prepare tools**

Implement:

- `openforge.propose_session_create`
- `openforge.propose_diagnostics_export`
- `openforge.propose_troubleshooting_steps`

Each tool writes a pending action through `CopilotRepository` and returns a safe summary.

- [ ] **Step 3: Add approve/reject routes**

Add:

- `POST /api/v1/copilot/runs/:id/pending-actions/:actionId/approve`
- `POST /api/v1/copilot/runs/:id/pending-actions/:actionId/reject`

Approval should execute only low-risk actions for this release:

- diagnostics export: return export payload through the approval response;
- adapter refresh: run discovery and return result;
- session draft: store/display draft only, do not start a session unless a later route explicitly implements it.

- [ ] **Step 4: Update Web pending action UI**

Show pending actions with:

- type;
- proposed input summary;
- approve/reject buttons;
- result or error after approval.

Label clearly that actions are proposed, not already executed.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --dir packages/gateway test -- test/copilot-routes.test.ts test/copilot-tools.test.ts
pnpm --dir packages/web test
pnpm --dir packages/gateway typecheck
pnpm --dir packages/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/services/copilot packages/gateway/src/routes/copilot.ts packages/gateway/test/copilot-routes.test.ts packages/gateway/test/copilot-tools.test.ts 'packages/web/src/app/(dashboard)/copilot/page.tsx' packages/web/src/lib/api.ts packages/web/src/lib/api.test.ts packages/web/src/lib/copilot.ts packages/web/src/lib/copilot.test.ts
git commit -m "feat: add copilot pending actions"
```

---

### Task 7: Docs, Diagnostics, And Final Verification

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/DEVELOPMENT-PLAN.md`
- Modify: `docs/TRIAL-CHECKLIST.md`
- Modify: `docs/TRIAL-FEEDBACK.md`
- Optional modify: `packages/gateway/src/routes/diagnostics.ts`
- Optional test: `packages/gateway/test/diagnostics-routes.test.ts`

- [ ] **Step 1: Update API docs**

Add a Copilot section to `docs/API.md`:

- capabilities;
- runs;
- run details;
- cancel;
- approve/reject pending actions;
- explicit non-goals: no terminal input, no shell, no Codex turn.

- [ ] **Step 2: Update development plan status**

Update `docs/DEVELOPMENT-PLAN.md` from "待按实施计划开发" to the current implementation status and cite the new plan path.

- [ ] **Step 3: Add trial checklist note**

Add a short Copilot smoke item:

- configure provider;
- ask Copilot to diagnose session launch readiness;
- verify it reads adapter state;
- verify no terminal input control appears.

- [ ] **Step 4: Add diagnostics metadata if implemented**

If diagnostics export already has a clean extension point, include:

```ts
copilot: {
  capabilities: {
    enabled: true,
    toolExecutionEnabled: true,
    approvalRequiredForWrites: true
  }
}
```

Do not include prompt text, provider credentials, tool raw stderr, or terminal transcript.

- [ ] **Step 5: Run full relevant verification**

Run:

```bash
pnpm --dir packages/gateway test
pnpm --dir packages/gateway typecheck
pnpm --dir packages/web test
pnpm --dir packages/web typecheck
git diff --check
```

Expected: all PASS.

- [ ] **Step 6: Security grep**

Run:

```bash
rg -n "sk-[A-Za-z0-9]|Bearer [A-Za-z0-9._-]+|OPENFORGE_ATTACH_TOKEN=|private_key|password" packages docs
```

Expected: only tests, examples, docs, or redaction patterns; no real secrets.

- [ ] **Step 7: Commit**

```bash
git add docs/API.md docs/DEVELOPMENT-PLAN.md docs/TRIAL-CHECKLIST.md docs/TRIAL-FEEDBACK.md packages/gateway/src/routes/diagnostics.ts packages/gateway/test/diagnostics-routes.test.ts
git commit -m "docs: document platform copilot"
```

---

### Task 8: Copilot Memory Module Follow-Up

This is a follow-up task after the provider-backed Copilot and approval-gated
tool surface are stable. Do not block the first implementation PR on this task.

**Files:**
- Create: `packages/gateway/src/db/migrations/0014_copilot_memory.sql`
- Create: `packages/gateway/src/db/repositories/copilot-memory-repository.ts`
- Create: `packages/gateway/src/services/copilot/memory.ts`
- Modify: `packages/gateway/src/services/copilot/tool-registry.ts`
- Modify: `packages/gateway/src/services/copilot/read-tools.ts`
- Modify: `packages/gateway/src/services/copilot/orchestrator.ts`
- Modify: `packages/gateway/src/routes/copilot.ts`
- Modify: `packages/gateway/src/db/schema.ts`
- Test: `packages/gateway/test/copilot-memory-repository.test.ts`
- Test: `packages/gateway/test/copilot-tools.test.ts`
- Test: `packages/gateway/test/copilot-routes.test.ts`

- [ ] **Step 1: Write memory persistence tests first**

Cover:

- durable memory rows are scoped by `user_id`;
- project-scoped and global memory can be listed separately;
- working notes are not returned as durable memory unless explicitly queried;
- cross-user reads return empty results;
- secret-looking values are redacted before persistence.

- [ ] **Step 2: Add tenant-scoped memory schema**

Start with SQLite/FTS only:

- `copilot_memory_entries`: durable curated facts, preferences, decisions,
  project notes, `scope`, `project_id`, `source_run_id`, `redacted_text`,
  timestamps.
- `copilot_memory_notes`: recent working notes and observations, scoped by user,
  project/session when available, timestamps.
- `copilot_memory_fts`: FTS5 table over redacted durable text and note text.

Do not add embeddings in this task. Embeddings require a separate privacy and
provider-cost review.

- [ ] **Step 3: Implement `CopilotMemoryRepository`**

Required methods:

```ts
createEntry(input: CreateMemoryEntryInput): CopilotMemoryEntry;
createNote(input: CreateMemoryNoteInput): CopilotMemoryNote;
search(input: SearchMemoryInput): CopilotMemorySearchResult[];
getEntry(id: string): CopilotMemoryEntry | undefined;
listEntries(input: ListMemoryInput): CopilotMemoryEntry[];
```

Every method must apply `WHERE user_id = ?`.

- [ ] **Step 4: Add memory tools**

Add tools:

- `openforge.memory_search`: bounded FTS/BM25 search with max result clamp,
  redacted snippets, and source metadata.
- `openforge.memory_get`: exact bounded read of one memory entry or note the
  user can access.
- `openforge.propose_memory_write`: creates a pending action; it does not write
  durable memory directly.

- [ ] **Step 5: Optional active recall pass**

If added in this task, active recall must be opt-in per Copilot run or
user-facing Copilot source, not platform-wide. It must:

- use only memory tools;
- include only the current prompt and small recent Copilot context;
- timeout quickly;
- open a circuit breaker after repeated timeouts;
- continue the main run with no injected memory when recall fails or is weak.

- [ ] **Step 6: Update docs and diagnostics**

Document:

- memory is explicit and tenant-scoped;
- no silent long-term writes;
- no raw terminal transcript indexing;
- embeddings are not part of the first memory release.

- [ ] **Step 7: Run verification**

Run:

```bash
pnpm --dir packages/gateway test -- test/copilot-memory-repository.test.ts test/copilot-tools.test.ts test/copilot-routes.test.ts
pnpm --dir packages/gateway typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/gateway/src/db/schema.ts packages/gateway/src/db/migrations/0014_copilot_memory.sql packages/gateway/src/db/repositories/copilot-memory-repository.ts packages/gateway/src/services/copilot packages/gateway/src/routes/copilot.ts packages/gateway/test/copilot-memory-repository.test.ts packages/gateway/test/copilot-tools.test.ts packages/gateway/test/copilot-routes.test.ts docs
git commit -m "feat: add copilot memory"
```

---

## Final Acceptance Checklist

- [ ] Copilot provider selection uses Provider SSOT and encrypted provider credentials.
- [ ] Codex subscription identity remains separate from Copilot provider credentials.
- [ ] `/api/v1/copilot` routes use the standard OpenForge response envelope.
- [ ] Web does not call provider APIs directly.
- [ ] No Next.js API routes are added.
- [ ] No terminal input, shell, file write, dependency install, git operation, or Codex app-server `/turn` tool exists.
- [ ] No OpenClaw-style session send/spawn or host exec tool exists.
- [ ] Tool execution is Gateway-validated with zod schemas.
- [ ] Pending actions require explicit user approval.
- [ ] Pending-action approval executes the stored canonical action payload.
- [ ] Audit or run events record model calls and tool actions without storing secrets.
- [ ] If memory is implemented, it is tenant-scoped, redacted, bounded, and explicit.
- [ ] Gateway tests pass.
- [ ] Web tests pass.
- [ ] Gateway and Web typechecks pass.
- [ ] `git diff --check` passes.

## Suggested Implementation Order

For the first implementation PR, stop after Task 4 if risk or time grows. That produces a useful Copilot text-run surface without tools. Continue to Task 5 and Task 6 only after the provider-backed text run is stable and reviewed. Treat Task 8 as a follow-up memory PR after the base Copilot safety and approval path are proven.
