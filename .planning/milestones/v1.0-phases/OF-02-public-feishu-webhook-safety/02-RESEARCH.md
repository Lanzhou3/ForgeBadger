---
phase: 02
slug: public-feishu-webhook-safety
status: complete
created: 2026-05-20
---

# Phase 02 - Research

## Research Question

What must be known to plan public Feishu webhook safety without weakening the current guarded inbound bridge?

## Findings

### Public Webhook Must Be A Separate Boundary

The current `POST /api/v1/integrations/feishu/inbound` route is intentionally an OpenForge JWT-protected local/test adapter. It already assumes an authenticated OpenForge user before reading Feishu config, user mappings, project ownership, and Copilot state. A public Feishu webhook cannot reuse that assumption because the first trust decision is Feishu request authenticity, not OpenForge JWT authentication.

Planning implication: add a separate route, for example `POST /api/v1/integrations/feishu/webhook/:publicId`, and mount it before the route-level `authenticate` middleware. Keep `/inbound` unchanged for tests and local adapters.

### Tenant Resolution Comes Before Tenant-Scoped Repository Trust

Feishu webhook requests arrive without an OpenForge session. The route needs a non-secret per-integration public id so it can load one tenant's Feishu webhook config before verifying the request. The public id is only a lookup handle; it does not replace signature verification.

Planning implication: extend `integration_feishu_configs` with public webhook metadata and add repository lookup by public id. Store required verification secret material encrypted at rest using the existing `crypto/secret-box.ts` pattern used by API keys and provider credentials.

### Raw Body Is Required For Signature Verification

`packages/gateway/src/server.ts` currently installs `express.json()` before route mounting. Signature verification must use the exact raw request body bytes. A public webhook implementation must either capture raw bytes in the JSON parser `verify` hook for the webhook path or mount a route-specific raw parser before general JSON parsing.

Planning implication: plan a server/parser task before signature verification tests can pass.

### Feishu Event SDK Surface

The official Lark/Feishu Go SDK event package exposes request headers `X-Lark-Request-Nonce`, `X-Lark-Request-Timestamp`, and `X-Lark-Signature`, a `Signature(timestamp, nonce, eventEncryptKey, body)` helper, encrypted event message shape, and URL verification challenge response shape. The public route should align with this event model and keep implementation tests anchored to these identifiers.

Planning implication: tests should verify missing/invalid timestamp, nonce, and signature; URL verification returns the expected challenge JSON and stops without Copilot side effects.

### Replay And Rate Limit Need Public-Route Stores

The guarded `/inbound` route currently uses an in-memory `Map` for per-chat rate limiting and audit-log search for accepted `messageId` replay. That is not sufficient for public webhook ingress because process restarts erase the limiter and audit lookup is not an atomic replay guard.

Planning implication: add dedicated repository-backed replay and rate-limit entries. SQLite is acceptable for the current local-first single Gateway deployment. The implementation must document and fail closed before multi-instance use unless a shared store exists.

### Existing Policy Can Be Reused After Verification

After signature, timestamp, replay, and rate-limit checks, public events can normalize into the existing bounded inbound command shape. The existing policy should still apply: enabled config, not emergency disabled, identity mode not unknown, explicit allowed chat, mapped Feishu user, visible project id, no active run, redaction, and audit.

Planning implication: factor shared helpers only where they reduce duplication. Do not broaden the event surface beyond minimum message events needed for the command bridge.

## Validation Architecture

### Automated Backend Coverage

- `pnpm --dir packages/gateway test test/feishu-integration.test.ts`
  - public webhook disabled/default closed
  - URL verification challenge with no Copilot side effects
  - missing/malformed signature headers rejected
  - stale/future timestamp rejected
  - replayed event/message/nonce rejected through persistent store
  - per-chat and per-mapped-user rate limit enforced through repository-backed state
  - policy rejections preserve chat allowlist, identity mode, user mapping, project ownership, active-run blocking, redaction, and audit behavior
  - free-form approval text never approves pending actions

- `pnpm --dir packages/gateway test test/copilot-routes.test.ts`
  - existing pending-action approval and Feishu outbound policy remain unchanged

- `pnpm --dir packages/gateway typecheck`
  - route, repository, schema, and test types compile

### Documentation Coverage

- `docs/API.md` must document the public webhook route, verification headers, challenge response, failure semantics, storage topology caveat, and non-goals.
- The public route must be described as protocol-specific and must not imply OpenForge REST envelope responses.

### Security Validation

- Secret grep should find no real Feishu verification token, encrypt key, signature, API key, JWT, attach token, or raw Feishu message text in docs, tests, audit expectations, or diagnostics.
- Audit rows must contain reason codes and bounded redacted metadata only.

## Key Risks

- Mixing JWT and public webhook logic could expose the local test adapter as public ingress.
- Capturing raw body globally without bounds could increase memory or log exposure risk.
- Challenge handling that bypasses ordinary auth must remain setup-only and side-effect free.
- SQLite replay/rate stores are safe for local single Gateway but not for multi-instance public deployment.

## Research Complete

This research supports planning Phase 02 as two plans: contract first, implementation second.
