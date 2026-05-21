# Phase 7 Feishu Callback Evidence

Date: 2026-05-21

Scope: FEI-01 Feishu public callback readiness. This report separates local `lark-cli` preflight, Gateway webhook setup, real Feishu developer-console callback verification, optional live message-event evidence, and automated regressions.

## Evidence Rules

- FEI-01 `Pass` requires a real Feishu developer-console HTTP callback to `POST /api/v1/integrations/feishu/webhook/:publicId`.
- `lark-cli auth status`, `lark-cli doctor`, and long-running event consumers are preflight evidence only.
- URL verification proves public reachability and verification-token match only. It does not prove chat policy, tenant mapping, replay protection, rate limiting, or approval boundaries.
- Simulated signed Gateway requests are local regression evidence, not real Feishu developer-console proof.
- Do not record raw auth config, app secrets, verification tokens, event encryption keys, raw signatures, JWTs, callback bodies, or private chat content.

## Evidence Matrix

| Gate | Status | Command or Checklist | Environment | Evidence Summary | Artifact | Caveat or Blocker Reason | Owner | Rerun or Next Action |
|------|--------|----------------------|-------------|------------------|----------|--------------------------|-------|----------------------|
| CLI preflight | Pass | `lark-cli auth status --verify`; `lark-cli doctor` | Local host with `lark-cli 1.0.36`; current default identity is user; bot and user identities ready; Feishu OpenAPI and MCP endpoints reachable | Auth status verified as valid; doctor checks passed; CLI is up to date. CLI emitted a proxy warning, so this proves the current host network path only. | Sanitized command result observed in this execution session | CLI preflight is not FEI-01 callback proof. | owner: OpenForge operator | Rerun both commands before a live callback attempt. Use direct network settings if proxy routing must be excluded. |
| Gateway callback setup | Caveat | `pnpm smoke:feishu-public-webhook` with environment-provided DB path, master key, OpenForge user, public webhook id, verification token, event encrypt key, allowed chat ids, and user mappings | Helper and unit test are present; live DB setup was not run in this report because live webhook secrets and public route values must stay operator-controlled | Callback URL shape: `https://<public-host>/api/v1/integrations/feishu/webhook/<publicWebhookId>`. Helper output is designed to include enabled state, identity mode, allowed chat count, mapping count, public id, and callback path only. | `scripts/prepare-feishu-public-webhook.ts`; `scripts/prepare-feishu-public-webhook.test.ts`; root script `smoke:feishu-public-webhook` | Missing live operator-provided webhook environment for this run. | owner: OpenForge operator | Set required environment variables, run `pnpm smoke:feishu-public-webhook`, then attach sanitized helper output summary here. |
| Real console URL verification | Blocked | Configure Feishu developer-console event subscription callback URL to `https://<public-host>/api/v1/integrations/feishu/webhook/<publicWebhookId>` and run URL verification | Requires Gateway reachable through public HTTPS and Feishu developer-console access | No real Feishu developer-console HTTP callback occurred in this execution. FEI-01 is not `Pass`. | This report | Missing public HTTPS URL routed to Gateway and missing developer-console URL verification action evidence. | owner: OpenForge operator | Rerun after assigning a public HTTPS URL, preparing live webhook config, and pressing Feishu console URL verification. Record only sanitized console result and Gateway audit status. |
| Optional real message event | Caveat | Subscribe to `im.message.receive_v1`, send one message in an allowed chat, and inspect sanitized Gateway audit/log status | Requires URL verification pass, allowed chat id, and Feishu open_id mapping | Not attempted because real URL verification is blocked. This optional live event does not override FEI-01 status. | This report | Missing successful URL verification and live allowed-chat policy setup. | owner: OpenForge operator | Rerun after URL verification passes, then trigger one allowed-chat message and record sanitized event type, status, and audit id only. |
| Local signed route regression | Pass | `pnpm --dir packages/gateway test test/feishu-integration.test.ts`; `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts` | Local automated regression environment | Automated signed-route checks cover URL verification without side effects, missing/disabled public id, unsigned/stale signatures, top-level encrypted payload fail-closed, signed token mismatch, chat allowlist rejection, replay, rate limiting, and accepted message redaction. These are simulated Gateway requests, not real developer-console callback evidence. | `packages/gateway/test/feishu-integration.test.ts` | No local signed-route regression blocker found. | owner: OpenForge engineering | Rerun after any public webhook route, repository, or redaction change. |
| Authority regression | Pass | `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts`; `pnpm --dir packages/gateway typecheck` | Local automated regression environment | 169 backend tests passed plus gateway typecheck. Automated checks cover free-form Feishu approval text staying non-authoritative, terminal-input pending actions staying pending until authenticated approval, enabled/emergency-disabled state, chat allowlist, user mapping, project visibility, active-run blocking including `waiting_for_approval`, replay, rate, outbound Feishu target policy, and redacted audit/output boundaries. | `packages/gateway/test/feishu-integration.test.ts`; `packages/gateway/test/copilot-routes.test.ts` | Automated evidence only; it does not replace real Feishu developer-console callback proof. | owner: OpenForge engineering | Rerun before release cut and after any Copilot pending-action, terminal action, or Feishu policy change. |
| Topology decision | Pass | Documentation and implementation review | v1.1 local-first deployment boundary | Current supported public-webhook topology is local or single-Gateway with SQLite-backed replay/rate storage. | `docs/API.md`; this report | No v1.1 multi-instance support claim. | owner: OpenForge engineering | Keep route disabled outside this topology until shared stores are implemented. |
| Encrypted payload boundary | Pass | `pnpm --dir packages/gateway test test/feishu-integration.test.ts` | Local automated regression environment | Top-level encrypted payloads fail closed with `feishu_webhook_encrypted_payload_unsupported` before Copilot execution. Decrypt support is not part of Phase 7. | `packages/gateway/test/feishu-integration.test.ts`; `docs/API.md` | Tenants requiring encrypted Feishu app mode must keep public webhook enablement off. | owner: OpenForge engineering | Split decrypt support into a dedicated security-reviewed implementation phase before enabling encrypted app mode. |
| Shared replay/rate store | Pass | Documentation review | v1.1 local-first deployment boundary | Multi-instance public webhook exposure requires shared replay and shared rate-limit stores. Deployments without shared stores must keep the public route disabled or fail closed. | `docs/API.md`; `docs/CI-CD-PLAN.md`; this report | Shared replay/rate storage is not implemented in v1.1. | owner: OpenForge engineering | Plan shared replay/rate storage before any multi-instance public webhook deployment. |
| Secret/redaction scan | Pass | Targeted scan for raw auth/config/secrets in Phase 7 artifacts | Local repository | Report and helper test scan found no raw credential values. Helper source uses internal config field names only and does not log them. `git diff --check` passed. | Phase 7 report and helper artifacts | No 07-01 redaction blocker found. | owner: OpenForge engineering | Rerun after 07-02 updates the report and backend regressions. |

## Callback Setup Inputs

The setup helper reads secret and live-route inputs from environment variables, not command-line arguments. Required inputs are:

- `OPENFORGE_DB_PATH`
- `OPENFORGE_MASTER_KEY`
- `OPENFORGE_FEISHU_OPENFORGE_USER_ID` or `OPENFORGE_FEISHU_OPENFORGE_USER_EMAIL`
- `OPENFORGE_FEISHU_PUBLIC_WEBHOOK_ID`
- `OPENFORGE_FEISHU_WEBHOOK_VERIFICATION_TOKEN`
- `OPENFORGE_FEISHU_WEBHOOK_EVENT_ENCRYPT_KEY`

Optional policy inputs are:

- `OPENFORGE_FEISHU_PUBLIC_WEBHOOK_ENABLED`
- `OPENFORGE_FEISHU_INTEGRATION_ENABLED`
- `OPENFORGE_FEISHU_EMERGENCY_DISABLED`
- `OPENFORGE_FEISHU_IDENTITY_MODE`
- `OPENFORGE_FEISHU_ALLOWED_CHAT_IDS`
- `OPENFORGE_FEISHU_USER_MAPPINGS_JSON`

Expected safe output shape:

```json
{
  "ok": true,
  "publicWebhookId": "<publicWebhookId>",
  "callbackPath": "/api/v1/integrations/feishu/webhook/<publicWebhookId>",
  "publicWebhookEnabled": true,
  "integrationEnabled": true,
  "emergencyDisabled": false,
  "identityMode": "bot",
  "allowedChatIdCount": 0,
  "mappingCount": 0,
  "webhookConfiguredAt": "2026-05-21T00:00:00.000Z"
}
```
