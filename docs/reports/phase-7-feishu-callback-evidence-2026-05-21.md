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
| Local signed route regression | Pending | Backend regression test for signed public webhook route | Local test environment | Planned in 07-02. | `packages/gateway/test/feishu-integration.test.ts` | Pending 07-02 implementation. | owner: OpenForge engineering | Add and run targeted backend regression. |
| Authority regression | Pending | Backend regression test proving outbound authority boundaries remain enforced after inbound callback handling | Local test environment | Planned in 07-02. | `packages/gateway/test/feishu-integration.test.ts`; Copilot/Feishu policy paths | Pending 07-02 implementation. | owner: OpenForge engineering | Add and run targeted policy regression. |
| Secret/redaction scan | Pending | Targeted scan for raw auth/config/secrets in Phase 7 artifacts | Local repository | Planned before 07-01 and 07-02 completion. | Phase 7 report and helper artifacts | Pending final scan. | owner: OpenForge engineering | Run targeted scan and `git diff --check` before completion. |

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
