---
phase: 02-public-feishu-webhook-safety
plan: 02
subsystem: gateway
tags: [feishu, public-webhook, replay-protection, rate-limit, copilot]

requires:
  - plan: 02-01
    provides: public webhook contract
provides:
  - public Feishu webhook route
  - tenant-scoped public webhook config storage
  - persistent replay and rate-limit protections
  - public webhook integration tests and Copilot regression coverage
affects: [gateway-routes, gateway-db, feishu-integration, copilot-ingress]

tech-stack:
  added: []
  patterns:
    - public route registered before JWT middleware with Feishu signature checks
    - webhook secrets stored encrypted with AES-256-GCM through the existing secret-box helper
    - replay and rate windows are SQLite-backed for local single-Gateway deployment

key-files:
  created:
    - packages/gateway/src/db/migrations/0021_feishu_public_webhook.sql
    - .planning/phases/OF-02-public-feishu-webhook-safety/02-02-SUMMARY.md
  modified:
    - docs/API.md
    - packages/gateway/src/db/migrations/meta/_journal.json
    - packages/gateway/src/db/repositories/feishu-integration-repository.ts
    - packages/gateway/src/db/schema.ts
    - packages/gateway/src/routes/integrations-feishu.ts
    - packages/gateway/src/server.ts
    - packages/gateway/test/db-schema.test.ts
    - packages/gateway/test/feishu-integration.test.ts
    - .planning/phases/OF-02-public-feishu-webhook-safety/02-VALIDATION.md

key-decisions:
  - "Public webhook route is `POST /api/v1/integrations/feishu/webhook/:publicId` and is registered before authenticated Feishu admin routes."
  - "Ordinary events require `X-Lark-Request-Timestamp`, `X-Lark-Request-Nonce`, `X-Lark-Signature`, raw body signature verification, token validation, and freshness checks."
  - "Encrypted top-level `encrypt` payloads fail closed in this slice until decrypt support is separately implemented."
  - "Authentic but non-actionable or policy-rejected public events return minimal 2xx acknowledgements to avoid retry amplification."

patterns-established:
  - "Public webhook tests sign the exact JSON raw body used by the request."
  - "Policy failures create redacted public webhook audit rows; unauthentic failures create no Copilot run and return minimal non-2xx responses."

requirements-completed: [FSH-01, FSH-02, FSH-03, FSH-04]

duration: 55min
completed: 2026-05-20
---

# Phase 02 Plan 02: Public Feishu Webhook Safety Summary

Gateway now has a disabled-by-default public Feishu webhook ingress with signature, replay, rate-limit, tenant policy, redaction, and audit gates before Copilot execution.

## Accomplishments

- Added public webhook config fields, encrypted verification token/event encrypt key storage, persistent replay entries, and persistent rate windows.
- Added `POST /api/v1/integrations/feishu/webhook/:publicId` before JWT-protected Feishu admin/test routes.
- Preserved raw JSON body bytes for Feishu webhook signature verification in the Gateway server.
- Implemented URL verification challenge handling, ordinary event signature/timestamp/nonce validation, verification token validation, replay protection, and public rate limiting.
- Normalized supported `im.message.receive_v1` text events into the same fail-closed Copilot ingress policy as `/inbound`.
- Kept free-form Feishu approval text and direct terminal input unsupported.
- Updated API docs and validation status to match implementation.

## Verification

- `pnpm --dir packages/gateway test test/feishu-integration.test.ts`
- `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts`
- `pnpm --dir packages/gateway test test/db-schema.test.ts`
- `pnpm --dir packages/gateway typecheck`
- `git diff --check`
- Changed-file secret scan reviewed; matches are documentation placeholders, auth test headers, or redaction test dummy values.

## Deviations from Plan

- Encrypted top-level Feishu `encrypt` payloads are explicitly unsupported and fail closed in this slice. This keeps Phase 2 safe without implementing Feishu payload decryption as part of the public route.
- `packages/gateway/test/db-schema.test.ts` was updated because the migration adds two expected public webhook tables.

## Issues Encountered

- Sandbox-local `node:test` route tests cannot listen on loopback without escalation; the focused route tests were rerun with approval and passed.

## User Setup Required

None for local tests. Real Feishu developer-console URL verification still requires a live Feishu app and public callback URL.

## Next Phase Readiness

Ready for Phase 2 completion/verification. Multi-instance public webhook deployment remains out of scope until a shared replay/rate-limit store exists.

## Self-Check: PASSED

