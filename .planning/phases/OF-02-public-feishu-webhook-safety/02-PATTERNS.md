# Phase 02 - Pattern Map

## Route Patterns

- `packages/gateway/src/routes/integrations-feishu.ts`
  - Uses local zod schemas with `.strict()`.
  - Uses `requireRepo()` for unavailable persistence.
  - Writes `AuditLogRepository` rows with safe metadata.
  - Current `router.use(authenticate)` protects all existing Feishu routes; public webhook must be registered before this middleware or split into a public router.

- `packages/gateway/src/routes/index.ts`
  - Mounts Gateway-owned routes under `/api/v1`.
  - Existing Feishu integration mount point is `/api/v1/integrations/feishu`.

## Repository Patterns

- `packages/gateway/src/db/repositories/feishu-integration-repository.ts`
  - Constructor scopes every query by `userId`.
  - Normalizes config values before persistence.
  - Uses SQLite transactions for replace operations.

- `packages/gateway/src/db/repositories/api-key-repository.ts`
  - Uses `encryptSecret()` and `decryptSecret()` from `packages/gateway/src/crypto/secret-box.ts`.
  - Stores encrypted secret JSON and never exposes plaintext in list responses.
  - Good analog for Feishu webhook verification token and encrypt key storage.

## Migration Patterns

- `packages/gateway/src/db/migrations/0019_feishu_integration.sql`
  - Adds Feishu config and mapping tables with `user_id` foreign keys and indexes.
  - New public webhook fields should be additive to preserve existing installs.

- `packages/gateway/src/db/schema.ts`
  - Drizzle schema mirrors migration table/index names.
  - New tables need `created_at` and `updated_at` patterns consistent with nearby schema definitions.

## Test Patterns

- `packages/gateway/test/feishu-integration.test.ts`
  - Creates an in-memory SQLite DB and runs migrations.
  - Uses `makeRequest()` against the Express app.
  - Seeds Feishu config/mappings through the repository.
  - Seeds Copilot provider and intercepts model requests for inbound route tests.
  - Existing tests assert response body, run count, audit rows, redaction, replay, rate limit, and no-free-form approval.

## Implementation Constraints

- Public webhook signature verification needs raw request bytes; `server.ts` currently uses global `express.json()`.
- Public webhook responses should be Feishu-compatible minimal JSON instead of OpenForge authenticated REST envelopes.
- Existing inbound helpers can be factored only after tests prove current `/inbound` behavior is preserved.
