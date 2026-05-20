---
phase: 02-public-feishu-webhook-safety
verified: 2026-05-20T18:44:26Z
status: passed
score: 24/24 must-haves verified
overrides_applied: 0
---

# Phase 2: Public Feishu Webhook Safety Verification Report

**Phase Goal:** Move Feishu inbound from a guarded authenticated/local test adapter toward a public webhook design with explicit boundary verification.
**Verified:** 2026-05-20T18:44:26Z
**Status:** passed
**Re-verification:** No - initial verification; no prior `*-VERIFICATION.md` artifact existed.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Public Feishu webhook signature, timestamp, replay, and failure semantics are specified before implementation. | VERIFIED | `docs/API.md:292-377` documents the public route, Feishu headers, raw-body signature verification, timestamp freshness, setup-only challenge handling, encrypted-payload fail-closed behavior, replay/rate persistence, failure responses, and audit metadata. |
| 2 | Replay and rate limiting are appropriate for the deployment model, with shared-store migration called out before multi-instance use. | VERIFIED | `docs/API.md:316-325` states repository-backed replay/rate state, local single-Gateway SQLite support, and shared replay/rate store requirement before multi-instance enablement. `schema.ts:736-780` and migration `0021_feishu_public_webhook.sql:13-39` add persistent replay/rate tables. |
| 3 | Chat allowlist, identity mode, user mapping, redaction, and audit behavior remain fail-closed. | VERIFIED | Public route gates check enabled/emergency state, identity mode, `allowedChatIds`, mapped Feishu user, project visibility, rate limits, active run, redaction, and audit before `runText` (`integrations-feishu.ts:169-266`, `680-734`). |
| 4 | Natural-language Feishu approval text still cannot approve pending actions or control terminals. | VERIFIED | Public webhook text is only passed into Copilot after safety gates with `source: "feishu"` (`integrations-feishu.ts:237-253`); free-form approval tests keep pending actions pending (`feishu-integration.test.ts:896-922`). Copilot approval routes remain authenticated and canonical (`docs/API.md:682-706`). |

**Score:** 24/24 must-haves verified

### Detailed Boundary Truths

| Truth | Status | Evidence |
|-------|--------|----------|
| D-01 public webhook is separate from authenticated `/inbound`. | VERIFIED | `router.post("/webhook/:publicId")` is registered at `integrations-feishu.ts:85`; `router.use(authenticate)` starts later at `integrations-feishu.ts:277`, so `/inbound` remains behind JWT middleware. |
| D-02 public lookup uses per-integration public id. | VERIFIED | `findPublicWebhookConfig(req.params.publicId)` resolves config at `integrations-feishu.ts:96-105`; repository lookup normalizes and queries `public_webhook_id` at `feishu-integration-repository.ts:230-250`. |
| D-03 handling is disabled/fail-closed by default. | VERIFIED | Default config sets `publicWebhookEnabled: false` (`feishu-integration-repository.ts:108-117`); route rejects disabled configs (`integrations-feishu.ts:108-110`); tests cover unknown/disabled ids (`feishu-integration.test.ts:731-758`). |
| D-04 public route does not mix JWT and Feishu webhook auth. | VERIFIED | Public route is before JWT middleware and uses Feishu token/signature checks; protocol responses use `{ msg: ... }` or `{ challenge: ... }` instead of the OpenForge REST envelope (`integrations-feishu.ts:85-135`, `676-678`). |
| D-05 ordinary events require timestamp, nonce, signature, and raw-body verification. | VERIFIED | Raw body is captured in `server.ts:73-80`; route calls `verifyFeishuPublicSignature` before normalization (`integrations-feishu.ts:123-128`); verifier checks all three headers and hashes the raw body (`integrations-feishu.ts:581-608`). |
| D-06 timestamp freshness is checked before normalization and Copilot execution. | VERIFIED | Five-minute timestamp window is enforced at `integrations-feishu.ts:58`, `592-599`, before `normalizePublicFeishuCommand` at `138`. Stale route test passes at `feishu-integration.test.ts:777-799`. |
| D-07 URL verification is setup-only and side-effect free. | VERIFIED | Challenge path validates token then returns only the challenge at `integrations-feishu.ts:113-120`; test asserts no run at `feishu-integration.test.ts:760-775`. |
| D-08 encrypted payload boundary is safe. | VERIFIED | This slice documents encrypted top-level `encrypt` as unsupported and fail-closed (`docs/API.md:309-314`); route returns `feishu_webhook_encrypted_payload_unsupported` before normalization (`integrations-feishu.ts:129-132`). |
| D-09 replay protection uses dedicated persistent store. | VERIFIED | Replay entries table exists in migration/schema (`0021_feishu_public_webhook.sql:13-25`, `schema.ts:736-756`); route consumes event/message and nonce replay keys via repository (`integrations-feishu.ts:144-166`). |
| D-10 local SQLite single-Gateway persistence is implemented and migration-backed. | VERIFIED | Repository uses SQLite transactions and unique insert/update state (`feishu-integration-repository.ts:253-314`); migration-backed schema test passed and includes replay/rate tables (`db-schema.test.ts:37-83`). |
| D-11 multi-instance shared-store requirement is called out before enablement. | VERIFIED | `docs/API.md:321-325` states multi-instance public webhook deployment requires shared replay/rate storage or must fail closed/remain disabled. |
| D-12 rate limits are repository-backed for integration, chat, and mapped-user scopes. | VERIFIED | Route consumes `integration`, `chat`, and `user` scopes at `integrations-feishu.ts:191-218`; persistent rate windows table and unique index exist at `schema.ts:758-780`. |
| D-13 public events reuse guarded fail-closed tenant policy before Copilot side effects. | VERIFIED | Checks for enabled, emergency disabled, identity mode, allowlist, mapping, project visibility, rate limit, and active run occur before `runText` (`integrations-feishu.ts:169-224`). |
| D-14 unsupported event types are acknowledged without side effects. | VERIFIED | `normalizePublicFeishuCommand` returns undefined unless `event_type` is `im.message.receive_v1` text (`integrations-feishu.ts:610-640`); route returns `{ msg: "ignored" }` at `138-141`. |
| D-15 free-form approval text is unsupported. | VERIFIED | Public webhook `/approve` test leaves action `pending` (`feishu-integration.test.ts:896-922`); guarded inbound equivalent also remains pending (`feishu-integration.test.ts:629-656`). |
| D-16 accepted events create only Copilot `source: "feishu"` runs, not terminal/session writes. | VERIFIED | Accepted route calls `runText` with `source: "feishu"` and creates a Feishu conversation/message only (`integrations-feishu.ts:237-253`); terminal writes remain pending-action approvals in Copilot docs/API (`docs/API.md:682-706`). |
| D-17 unauthentic failures are minimal and avoid sensitive material. | VERIFIED | Signature/token/disabled/unknown failures use `sendPublicWebhookError` minimal `{ msg }` (`integrations-feishu.ts:101-135`, `676-678`); tests assert `sk-public-webhook-secret` is absent from failure responses (`feishu-integration.test.ts:731-799`). |
| D-18 policy rejections after tenant resolution write redacted audit rows. | VERIFIED | `sendPublicWebhookPolicyReject` writes `feishu.webhook.reject` with reason code and redacted text summary (`integrations-feishu.ts:680-704`). |
| D-19 accepted events write bounded audit metadata. | VERIFIED | `recordPublicWebhookAccept` stores public id, event/message/chat/user/project/run/conversation/pending count and redacted summary (`integrations-feishu.ts:706-734`). |
| D-20 provider/API surfaces receive redacted Feishu context only. | VERIFIED | Public route redacts conversation text (`integrations-feishu.ts:249-253`); accepted-route test confirms response, run goal, and model request omit `sk-public-webhook-secret` (`feishu-integration.test.ts:801-836`). |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docs/API.md` | Public webhook contract and non-goals | VERIFIED | Public route, protocol responses, replay/rate topology, fail-closed policy, redaction, audit, and no-approval/no-terminal semantics documented at `292-377`. |
| `packages/gateway/src/server.ts` | Raw body capture for signature verification | VERIFIED | Express JSON `verify` stores `rawBody` only for `/api/v1/integrations/feishu/webhook/` at `73-80`. |
| `packages/gateway/src/routes/integrations-feishu.ts` | Public route and fail-closed handoff | VERIFIED | Public route is substantive and wired before JWT auth (`85-277`); policy/audit helpers are implemented (`680-734`). |
| `packages/gateway/src/db/repositories/feishu-integration-repository.ts` | Public id lookup, encrypted secrets, persistent replay/rate methods | VERIFIED | Encrypted webhook config and decrypt-on-lookup methods at `188-250`; persistent replay/rate transactions at `253-314`. |
| `packages/gateway/src/db/schema.ts` | Drizzle schema for webhook config, replay, and rate windows | VERIFIED | Config fields at `683-706`; replay table at `736-756`; rate table at `758-780`. |
| `packages/gateway/src/db/migrations/0021_feishu_public_webhook.sql` | Migration for config fields and replay/rate tables | VERIFIED | Adds public webhook config columns and unique indexes, replay table, and rate window table at `1-39`. |
| `packages/gateway/test/feishu-integration.test.ts` | Public webhook and guarded inbound route coverage | VERIFIED | Covers unknown/disabled ids, challenge, unsigned/stale auth failures, valid Feishu run, replay, rate limit, redaction, and free-form approval at `731-922`. |
| `packages/gateway/test/copilot-routes.test.ts` | Outbound Feishu approval policy regression coverage | VERIFIED | Covers allowed Feishu execution plus disabled, allowlist, unmapped, and identity-mode rejections at `4593-4728`. |
| `packages/gateway/test/db-schema.test.ts` | Migration-backed schema verification | VERIFIED | Applies migrations and asserts webhook replay/rate tables exist at `1-83`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Public route | Raw body signature verification | Express `rawBody` plus `verifyFeishuPublicSignature` | WIRED | `server.ts:73-80` captures raw body; `integrations-feishu.ts:123-128`, `581-608` verify signed raw bytes before normalization. |
| Public route | Tenant config by public id | `FeishuIntegrationRepository.findPublicWebhookConfig` | WIRED | Public id lookup occurs at `integrations-feishu.ts:96-105`; repository query/decrypt occurs at `230-250`. |
| Public route | Persistent replay/rate stores | `consumePublicWebhookReplayKey` and `consumePublicWebhookRateWindow` | WIRED | Route consumes repository-backed replay and integration/chat/user rate windows at `integrations-feishu.ts:144-218`. |
| Public route | Copilot guarded ingress | `CopilotOrchestrator.runText({ source: "feishu" })` | WIRED | Route applies tenant policy then creates Feishu-sourced run/conversation at `integrations-feishu.ts:169-266`. |
| Public free-form text | Approval/terminal side effects | No direct call path to approval routes or session input handlers | WIRED | Test keeps `/approve` action pending (`feishu-integration.test.ts:896-922`); terminal input remains approval-only in `docs/API.md:682-706`. |
| Outbound Feishu actions | OpenForge approval policy | Authenticated pending-action approval route | WIRED | Copilot route tests enforce disabled, allowlist, mapping, and identity gates before Feishu action execution (`copilot-routes.test.ts:4593-4728`). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `integrations-feishu.ts` public route | `config` | `findPublicWebhookConfig(publicId)` reads SQLite `integration_feishu_configs` and decrypts webhook settings | Yes | FLOWING |
| `integrations-feishu.ts` public route | `rawBody` | Express JSON parser `verify` stores request bytes on webhook paths | Yes | FLOWING |
| `integrations-feishu.ts` public route | `normalized` | Feishu `im.message.receive_v1` event payload normalized through `inboundFeishuCommandSchema` | Yes | FLOWING |
| `integrations-feishu.ts` public route | `replayKey` and rate scopes | Repository transactions insert/update SQLite replay and rate tables | Yes | FLOWING |
| `integrations-feishu.ts` Copilot handoff | `result.run`, `conversation`, `audit details` | `CopilotOrchestrator.runText`, `CopilotRepository`, `AuditLogRepository` | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Whitespace check | `git diff --check` | exit 0 | PASS |
| Gateway typecheck | `pnpm --dir packages/gateway typecheck` | exit 0 | PASS |
| Migration-backed DB schema | `pnpm --dir packages/gateway test test/db-schema.test.ts` | 1 test file pass, duration 1159ms | PASS |
| Feishu/Copilot route safety | `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts` | Restricted sandbox rerun failed at file level with no assertion stack; approved rerun passed 166 tests, 4 suites, 166 pass, 0 fail, duration 5008ms | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| None | `find scripts -path '*/tests/probe-*.sh' -type f -print` | No project probes found | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FSH-01 | `02-01-PLAN.md`, `02-02-PLAN.md` | Public Feishu webhook ingress has documented signature-verification and timestamp/replay design before exposure. | SATISFIED | `docs/API.md:292-325`; code implementation at `server.ts:73-80`, `integrations-feishu.ts:123-166`, tests at `feishu-integration.test.ts:777-865`. |
| FSH-02 | `02-01-PLAN.md`, `02-02-PLAN.md` | Replay protection and per-chat rate limiting are safe for intended topology. | SATISFIED | Persistent replay/rate tables in migration/schema; repository transactions at `feishu-integration-repository.ts:253-314`; docs multi-instance caveat at `docs/API.md:321-325`; tests at `feishu-integration.test.ts:838-894`. |
| FSH-03 | `02-01-PLAN.md`, `02-02-PLAN.md` | Feishu inbound/outbound paths enforce tenant configuration, chat allowlists, identity mode, and mappings before Copilot/outbound execution. | SATISFIED | Public policy gates at `integrations-feishu.ts:169-224`; guarded inbound equivalents remain at `418-470`; outbound approval policy tests at `copilot-routes.test.ts:4630-4728`. |
| FSH-04 | `02-01-PLAN.md`, `02-02-PLAN.md` | Feishu free-form text cannot approve pending actions, send terminal input, or bypass OpenForge approval/audit semantics. | SATISFIED | Public `/approve` test at `feishu-integration.test.ts:896-922`; guarded inbound `/approve` test at `629-656`; docs keep terminal/session input behind pending-action approval at `docs/API.md:682-706`. |

No orphaned Phase 2 requirements found in `.planning/REQUIREMENTS.md`; FSH-01 through FSH-04 are all mapped to Phase 2.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/gateway/src/db/repositories/feishu-integration-repository.ts` | 451 | `return []` in JSON parse fallback | INFO | Not a stub; invalid stored allowlist JSON fails closed to an empty allowlist. |

Debt marker scan found no `TBD`, `FIXME`, or `XXX` markers in the modified phase files. Secret scan matches are documentation placeholders, auth test headers, or deliberate redaction test dummy values; no real secret material was found.

### Human Verification Required

None for this phase goal. Live Feishu developer-console URL verification requires a real Feishu app and public callback URL, but Phase 2's goal is the Gateway boundary implementation and local single-Gateway safety evidence; automated route and policy tests cover that contract.

### Gaps Summary

No blocking gaps found. The only execution caveat was environment-specific: the restricted sandbox route-test command failed at file level because `node:test` route suites need loopback listening. The same command passed under approved execution with 166/166 tests passing.

---

_Verified: 2026-05-20T18:44:26Z_
_Verifier: the agent (gsd-verifier)_
