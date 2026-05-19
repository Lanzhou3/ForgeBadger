# Feishu Inbound Command Bridge Next Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first safe inbound Feishu command bridge so authorized Feishu chats can create Copilot conversations and runs without gaining direct terminal or approval authority.

**Current status:** Completed in `28c9365 fix: harden copilot run gates` on `post-beta-release-gates`. GitHub PR #2 is open against `master`, mergeable, and the remote CI checks for this head SHA are green as of 2026-05-19.

**Product positioning:** OpenForge remains a local-first AI CLI control plane with an approval-gated Copilot. Feishu is only a controlled collaboration channel into Copilot, not the execution authority, not a Feishu bot platform, and not a remote autonomous development entry point.

**Architecture:** Gateway remains the only enforcement point. Feishu inbound messages enter through an explicit authenticated/local-only Gateway route, are normalized into a bounded command object, checked against tenant Feishu config, chat allowlist, user mappings, and rate limits, then routed into Copilot as `source: "feishu"` with all write operations still represented as pending actions. Web only receives the resulting Copilot conversation/run state through existing APIs.

**Tech Stack:** Express, TypeScript, zod, SQLite/better-sqlite3 repositories, existing CopilotRepository and CopilotOrchestrator, node:test, Web API client tests.

---

## Scope

Build Task 5 from `docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md`.

In scope:
- Explicit `POST /api/v1/integrations/feishu/inbound` test adapter.
- Existing OpenForge JWT guard before any inbound payload is trusted; public webhook signature verification stays out of this slice.
- Explicit identity mode and chat allowlist enforcement using `identityMode` and `allowedChatIds`.
- Feishu user mapping enforcement using `integration_feishu_user_mappings`.
- `source: "feishu"` support for Copilot runs/conversations when needed by type paths.
- Optional inbound `projectId` ownership validation before it is used as Copilot context.
- `messageId` replay protection and bounded per-chat rate limiting.
- Redaction of inbound text before persistence and provider request context.
- Free-form approval text must not approve pending actions.
- Audit rows for accepted and rejected inbound commands.

Out of scope:
- Public webhook signature verification beyond the first route guard.
- `lark-cli event consume` long-running listener.
- Feishu approval links or code approval.
- Direct terminal input from Feishu.
- Batch authorization or unattended loops.
- Project-manager work items and ledger tables; those start after this bridge is stable.

## File Map

- Modify `packages/gateway/src/routes/integrations-feishu.ts`
  - Add inbound route, request schema, guard, policy checks, audit writes, and Copilot handoff.
- Modify `packages/gateway/src/routes/copilot.ts`
  - Export or factor a small helper only if inbound needs to reuse run creation without duplicating orchestration logic.
- Modify `packages/gateway/src/db/repositories/copilot-repository.ts`
  - Only if source validation or persistence assumptions reject `feishu`.
- Modify `packages/gateway/src/services/copilot/redaction.ts`
  - Only if existing redaction is insufficient for inbound message text.
- Modify `packages/web/src/lib/api.ts`
  - Add types only for route contract tests or future admin diagnostics; do not add UI controls in this iteration.
- Modify `docs/API.md`
  - Document route, guard, policy, redaction, and non-goals.
- Test `packages/gateway/test/feishu-integration.test.ts`
  - Route-level inbound policy, mapping, redaction, and audit coverage.
- Test `packages/gateway/test/copilot-routes.test.ts`
  - Copilot `source: "feishu"` lifecycle and pending-action safety coverage if route delegates into Copilot route helpers.
- Test `packages/web/src/lib/api.test.ts`
  - Only if `api.ts` gains client functions/types.

## Task 1: Inbound Contract And Rejection Tests

**Files:**
- Modify: `packages/gateway/test/feishu-integration.test.ts`
- Modify: `packages/gateway/src/routes/integrations-feishu.ts`

- [x] **Step 1: Write failing tests for guarded, disabled, and emergency-disabled integration**

Add tests asserting unauthenticated `POST /api/v1/integrations/feishu/inbound` returns `401`, and authenticated requests return `403` with envelope code `1`, write no Copilot run, and do not leak input text when:
- config is missing or `enabled: false`;
- config has `emergencyDisabled: true`.

- [x] **Step 2: Write failing tests for chat allowlist**

Seed config with `enabled: true`, `identityMode: "bot"`, and `allowedChatIds: ["oc_allowed"]`.
Assert inbound from `oc_denied` returns `403`, creates no Copilot run, and records a redacted `feishu.inbound.reject` audit row.

- [x] **Step 3: Implement minimal inbound schema and rejection path**

Add a strict zod schema:

```ts
const inboundFeishuCommandSchema = z.object({
  chatId: z.string().min(1).max(128),
  feishuUserId: z.string().min(1).max(128),
  text: z.string().min(1).max(8_000),
  messageId: z.string().min(1).max(128).optional(),
  projectId: z.string().min(1).max(128).optional()
}).strict();
```

The route must fail closed before touching Copilot when config or chat policy fails.

- [x] **Step 4: Verify**

Run:

```bash
pnpm --dir packages/gateway test test/feishu-integration.test.ts
```

Expected: new rejection tests pass.

## Task 2: User Mapping And Source Support

**Files:**
- Modify: `packages/gateway/test/feishu-integration.test.ts`
- Modify: `packages/gateway/src/routes/integrations-feishu.ts`
- Modify: `packages/gateway/src/db/repositories/copilot-repository.ts` if needed
- Modify: `packages/web/src/lib/api.ts` if shared Copilot source type is too narrow

- [x] **Step 1: Write failing test for unmapped Feishu user**

Seed enabled config and allowed chat. Do not seed `integration_feishu_user_mappings`.
Assert inbound returns `403`, creates no run, and returns `feishu_user_not_mapped`.

- [x] **Step 2: Write failing test for mapped user creating a Copilot run**

Seed mapping `{ feishuUserId: "ou_allowed", openforgeUserId: user.id }`.
Assert inbound creates or reuses a Copilot conversation, creates a run with `source: "feishu"`, and returns only bounded run/conversation metadata.

- [x] **Step 3: Write failing tests for project ownership and active-run blocking**

Assert an inbound `projectId` owned by another tenant is rejected before run creation, and a current `queued`, `running`, or `waiting_for_approval` run blocks a new Feishu inbound run.

- [x] **Step 4: Add `source: "feishu"` where type paths require it**

Keep source handling additive. Do not loosen source validation to arbitrary strings if a literal union is available.

- [x] **Step 5: Verify**

Run:

```bash
pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts
pnpm --dir packages/gateway typecheck
```

Expected: mapped inbound path passes and existing Copilot route behavior remains unchanged.

## Task 3: Redaction, Audit, And No Free-Form Approval

**Files:**
- Modify: `packages/gateway/test/feishu-integration.test.ts`
- Modify: `packages/gateway/src/routes/integrations-feishu.ts`
- Modify: `docs/API.md`

- [x] **Step 1: Write failing redaction test**

Use inbound text containing API-key-shaped content. Assert persisted Copilot messages, provider prompt context, API response, and audit details do not contain the raw secret.

- [x] **Step 2: Write failing free-form approval test**

Create a waiting Copilot run with a pending action. Send inbound text such as `approve`, `批准`, or `/approve action-id`.
Assert the pending action remains `pending` and the route returns a bounded rejection instead of approving the action.

- [x] **Step 3: Write failing replay and rate-limit tests**

Assert a repeated accepted `messageId` does not create a second run, and a per-chat rate limit returns `429` without calling Copilot.

- [x] **Step 4: Add audit rows**

Record:
- `feishu.inbound.accept` with chat id, mapped OpenForge user id, optional project id, and redacted text summary.
- `feishu.inbound.reject` with reason code and bounded redacted metadata.

- [x] **Step 5: Document the contract**

Update `docs/API.md` with the route, required guard, policy decisions, redaction, and explicit non-support for Feishu approval text.

- [x] **Step 6: Verify**

Run:

```bash
pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts
pnpm --dir packages/gateway typecheck
git diff --check
```

Expected: all tests pass and docs contain the safety boundaries.

## Task 4: CI And Handoff

**Files:**
- Modify: `.github/workflows/ci.yml` only if the inbound route adds a new narrow regression suite that is not already covered by `pnpm -r test`.
- Modify: `docs/CI-CD-PLAN.md` only if CI commands change.

- [x] **Step 1: Run focused verification**

Run:

```bash
pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts
pnpm --dir packages/gateway typecheck
pnpm --dir packages/web test src/lib/api.test.ts
```

- [x] **Step 2: Run broader release-adjacent verification**

Run:

```bash
pnpm -r test
pnpm -r build
git diff --check
```

- [x] **Step 3: Commit**

Actual commit:

```bash
git commit -m "fix: harden copilot run gates"
git push origin post-beta-release-gates
```

```bash
git add packages/gateway/src/routes/integrations-feishu.ts packages/gateway/src/routes/copilot.ts packages/gateway/src/db/repositories/copilot-repository.ts packages/gateway/test/feishu-integration.test.ts packages/gateway/test/copilot-routes.test.ts packages/web/src/lib/api.ts packages/web/src/lib/api.test.ts docs/API.md .github/workflows/ci.yml docs/CI-CD-PLAN.md
git commit -m "feat: route feishu commands to copilot"
```

Only include files that actually changed.

The command block above is the original execution template; the actual commit was broader because it also closed Copilot live-run, provider error, frontend polling, CI gate, and Feishu outbound-policy review findings.

## Acceptance Gates

- Unauthenticated inbound requests are rejected before policy or Copilot execution.
- Unknown Feishu identity mode and empty inbound chat allowlists fail closed.
- Unauthorized chat cannot create a Copilot run.
- Unmapped Feishu user cannot create a Copilot run or approve actions.
- Mapped Feishu user in an allowed chat can create a Copilot run with `source: "feishu"`.
- Inbound `projectId` is never trusted without tenant ownership validation.
- Replaying an accepted `messageId` cannot create duplicate runs.
- Per-chat inbound rate limits fail closed with `429`.
- Inbound text is redacted before persistence, provider request context, audit details, and API response.
- Free-form approval text never approves a pending action.
- Emergency disable stops inbound immediately.
- The route has a documented JWT guard and remains a test adapter until a separate public webhook signature design lands.
- Existing Web Copilot and approved outbound Feishu actions keep passing.

## Follow-Up Backlog

- Add a separate public Feishu webhook design with signature verification and replay protection at the webhook boundary.
- Move inbound per-chat rate limiting to a shared store before multi-instance deployment; the current route-level limiter is sufficient for the local Gateway MVP slice.
- Keep Feishu approvals out of scope unless a future design adds explicit OpenForge approval tokens and auditable approval semantics.
- Start project-manager work item and ledger tables only after this bridge has run safely behind the current PR gates.
