# Phase 7: Feishu Live Callback Readiness - Research

**Researched:** 2026-05-21T15:19:06+08:00
**Status:** Ready for planning

## Research Question

What does the planner need to know to turn Phase 7 into executable Feishu live callback readiness work without expanding OpenForge into a Feishu bot platform, terminal-control surface, or multi-instance webhook service?

Phase 7 is an evidence and readiness phase. It should prove or precisely block a real Feishu developer-console HTTP callback to the existing public webhook route, then record the topology, encrypted-payload, shared-store, and authority-boundary decisions as `Pass`, `Caveat`, or `Blocked`.

## Inputs Reviewed

- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `.planning/PROJECT.md`
- `.planning/STATE.md`
- `.planning/phases/OF-07-feishu-live-callback-readiness/07-CONTEXT.md`
- `.planning/milestones/v1.0-phases/OF-02-public-feishu-webhook-safety/02-VERIFICATION.md`
- `.planning/phases/OF-06-live-provider-and-platform-smoke-evidence/06-CONTEXT.md`
- `docs/API.md`
- `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md`
- `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md`
- `packages/gateway/src/server.ts`
- `packages/gateway/src/routes/integrations-feishu.ts`
- `packages/gateway/src/db/repositories/feishu-integration-repository.ts`
- `packages/gateway/src/services/integrations/feishu-cli.ts`
- `packages/gateway/test/feishu-integration.test.ts`
- `packages/gateway/test/copilot-routes.test.ts`

## Findings

### 1. Real Callback Readiness Is Blocked By Callback Setup, Not CLI Availability

The host has a working `lark-cli` path and `lark-cli auth status --verify` plus `lark-cli doctor` passed during discussion. The CLI event consumer is a separate long-running event-bus path and does not exercise OpenForge's public HTTP callback route.

Planner implication:

- Use CLI auth/doctor/event commands only as preflight evidence.
- FEI-01 pass requires a Feishu developer-console HTTP callback attempt to `POST /api/v1/integrations/feishu/webhook/:publicId`.
- If no public HTTPS URL, developer-console access, verification token, event encrypt key, or route DB setup exists, record the exact blocker. Do not report "Feishu CLI unavailable".

### 2. Public Webhook Config Exists In The Repository Layer But Has No Operator Runbook

`FeishuIntegrationRepository.configurePublicWebhook` can store the public id, encrypted verification token, encrypted event encrypt key, and enable flag. The authenticated Feishu config route updates only basic config fields and user mappings. There is no obvious reusable operator script for safely preparing the current DB for a real developer-console callback.

Planner implication:

- Plan 07-01 should add a small evidence-prep script rather than ask operators to paste ad hoc SQL or inline `tsx` snippets containing secrets.
- The script must read secrets from environment variables, write encrypted DB config, and output only public metadata such as callback path, public id, enabled state, allowed-chat count, and mapping count.
- Tests should assert that the script does not print verification token or event encrypt key values.

### 3. Public Route Already Enforces The Critical Boundary

`packages/gateway/src/routes/integrations-feishu.ts` registers `/webhook/:publicId` before JWT middleware. It resolves config by public id, rejects missing/disabled config, handles `url_verification`, verifies timestamp/nonce/signature against raw request body for ordinary events, rejects top-level `encrypt`, checks verification token, consumes persistent replay keys, applies integration/chat/user rate limits, enforces enabled/emergency-disabled/identity/allowlist/mapping/project visibility, blocks active runs including `waiting_for_approval`, and creates Feishu-sourced Copilot runs only after those gates.

Planner implication:

- Do not redesign the route unless execution finds a concrete product bug.
- Use existing route tests as the baseline for FEI-03 regression evidence.
- Add focused tests for any Phase 7-specific proof gaps, especially encrypted-payload fail-closed and public policy negative cases that are only documented or verified by code review today.

### 4. Existing Tests Cover Many, But Not All, Phase 7 Evidence Needs

`packages/gateway/test/feishu-integration.test.ts` already covers:

- URL verification without Copilot side effects.
- Missing/disabled public webhook ids.
- Unsigned and stale public webhook events.
- Valid signed public webhook message creating one `source: "feishu"` run.
- Replay rejection.
- Public webhook rate limiting.
- Public free-form approval rejection.
- Authenticated inbound active-run blocking and free-form approval rejection.

Likely Phase 7 test gaps:

- Top-level encrypted public webhook payload returns `feishu_webhook_encrypted_payload_unsupported`.
- Public webhook token mismatch for signed ordinary event returns no run.
- Public webhook chat/user/project policy rejections are represented in tests, not only in code/docs.
- Real evidence docs label which checks are live and which are automated regression coverage.

Planner implication:

- Plan 07-02 should add missing narrow tests only where gaps are confirmed.
- Keep test scope in `feishu-integration.test.ts`; do not touch frontend unless evidence docs require UI text changes.

### 5. Deployment Decision Is Already Single-Gateway Only

`docs/API.md` states SQLite-backed replay/rate storage is supported only for local single-Gateway deployment. Multi-instance public webhook deployment requires shared replay and shared rate-limit stores before enablement.

Planner implication:

- Phase 7 should not implement distributed storage.
- Evidence docs should state single-Gateway is the only currently supported public-webhook topology.
- Multi-instance should remain `Caveat` or future backlog, not an unqualified support claim.

### 6. Encrypted Payloads Are Deliberately Unsupported

The route rejects top-level `encrypt` with `feishu_webhook_encrypted_payload_unsupported`, and `docs/API.md` says tenants requiring encrypted app mode must leave public webhook enablement off until decrypt support is implemented and tested.

Planner implication:

- Do not add decrypt support in Phase 7.
- Add or verify a focused fail-closed test.
- User-facing evidence must say encrypted mode is not supported, not "partially supported".

### 7. Evidence Needs A Dedicated Feishu Report And Matrix Link

Phase 6 created `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` as the v1.1 matrix. Its current scope says Phase 6. Phase 7 needs a directly discoverable Feishu callback artifact without mixing real console evidence, local signed route tests, CLI preflight, and authority regression into one ambiguous row.

Planner implication:

- Create `docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md`.
- Add Phase 7 rows or a Phase 7 section to the v1.1 matrix that links to the Feishu report.
- Keep row statuses explicit: `Pass`, `Caveat`, or `Blocked`; do not promote simulated signed-route tests to real console callback pass.

## Recommended Plan Shape

1. **Plan 07-01: Feishu callback setup and live verification path.** Add a safe operator setup script if needed, verify CLI preflight, prepare callback URL/config evidence, attempt real developer-console URL verification, and record `Pass`, `Caveat`, or `Blocked` in a dedicated Feishu callback report.
2. **Plan 07-02: Exposure decision and authority regression closeout.** Finalize single-Gateway/multi-instance caveats, encrypted-payload fail-closed evidence, automated negative controls, docs/matrix updates, and redaction scan.

## Risks

| Risk | Why It Matters | Planning Mitigation |
|------|----------------|---------------------|
| Treating CLI long connection as callback proof | It bypasses OpenForge public route and signature logic | Label CLI evidence as preflight only; require real console HTTP callback for FEI-01 pass |
| Secret leakage during callback setup | Verification token and event encrypt key are real secrets | Use environment variables, encrypted DB storage, no raw secret logging, targeted scan |
| False multi-instance support claim | SQLite replay/rate state is process-local deployment state | Document single-Gateway only; multi-instance requires shared replay/rate stores |
| Encrypted app mode ambiguity | Feishu apps may require encrypted event mode | Keep top-level `encrypt` fail-closed and record explicit caveat |
| Authority regression gaps | Feishu text must not become approval or terminal authority | Run focused tests for free-form approval, terminal-input pending action, policy gates, replay/rate, and audit redaction |

## Validation Architecture

### Automated Validation

- `git diff --check`.
- `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts`.
- `pnpm --dir packages/gateway typecheck`.
- Script tests for any new Feishu callback setup script.
- `gsd-sdk query check.decision-coverage-plan .planning/phases/OF-07-feishu-live-callback-readiness .planning/phases/OF-07-feishu-live-callback-readiness/07-CONTEXT.md`.
- Targeted secret scan over Phase 7 evidence docs and any new script output fixtures.

### Manual-Only Validation

- Real Feishu developer-console URL verification against a public HTTPS URL routed to `POST /api/v1/integrations/feishu/webhook/:publicId`.
- Optional real `im.message.receive_v1` event trigger in an allowed chat.
- Operator confirmation that developer-console configuration used the same verification token and event encrypt key as the encrypted DB setup, without recording those secret values.

### Acceptance Rules For Plans

- Every plan must reference FEI-01, FEI-02, or FEI-03 in frontmatter.
- Every task must include `<read_first>` and `<acceptance_criteria>`.
- `FEI-01` can be `Pass` only with real developer-console HTTP callback evidence; local signed requests are simulated evidence.
- `FEI-02` must record single-Gateway support, multi-instance shared-store caveat, and encrypted-payload fail-closed decision.
- `FEI-03` must prove free-form text cannot approve pending actions, send terminal input, or bypass tenant/audit policy through live or clearly labeled automated regression evidence.

## RESEARCH COMPLETE
