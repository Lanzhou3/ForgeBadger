# Phase 19 Context: Feishu Public Callback Evidence

Date: 2026-05-29

## Why This Phase Exists

Phase 17 made `docs/EXTERNAL-EVIDENCE-GATES.md` the source of truth for
external release gates. Phase 19 addresses `FEISHU-CALLBACK`, which is still
`Blocked` because a real Feishu developer-console URL verification has not
reached a public HTTPS Gateway webhook route.

This phase should not expand Feishu authority. It records current evidence,
keeps public callback claims truthful, and preserves the existing boundaries:
signature/raw-body handling, replay/rate policy, tenant chat allowlists, user
mappings, redaction, and no free-form approval or terminal input.

## Source Evidence

- `docs/EXTERNAL-EVIDENCE-GATES.md` defines the `FEISHU-CALLBACK` clearing
  condition and redaction rules.
- `docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md` records the
  historical Phase 7 evidence and the missing public HTTPS/console verification
  blocker.
- `docs/API.md` documents the public route
  `POST /api/v1/integrations/feishu/webhook/:publicId`.
- `packages/gateway/src/routes/integrations-feishu.ts` implements the public
  route and fail-closed policy checks.
- `scripts/prepare-feishu-public-webhook.ts` is the setup helper for
  operator-controlled webhook configuration.
- `packages/gateway/test/feishu-integration.test.ts` and
  `packages/gateway/test/copilot-routes.test.ts` cover local regression and
  authority boundaries.

## Runtime Inputs Observed

The current shell has no OpenForge Feishu public-webhook setup environment
variables set:

- `OPENFORGE_DB_PATH`
- `OPENFORGE_MASTER_KEY`
- `OPENFORGE_FEISHU_OPENFORGE_USER_ID`
- `OPENFORGE_FEISHU_OPENFORGE_USER_EMAIL`
- `OPENFORGE_FEISHU_PUBLIC_WEBHOOK_ID`
- `OPENFORGE_FEISHU_PUBLIC_WEBHOOK_ENABLED`
- `OPENFORGE_FEISHU_WEBHOOK_VERIFICATION_TOKEN`
- `OPENFORGE_FEISHU_WEBHOOK_EVENT_ENCRYPT_KEY`
- `OPENFORGE_FEISHU_ALLOWED_CHAT_IDS`
- `OPENFORGE_FEISHU_USER_MAPPINGS_JSON`

Do not print or persist secret values if a later shell provides them.

## Local Feishu CLI Preflight

`lark-cli` is installed as version `1.0.36`. In sandboxed execution, network
verification was blocked by local proxy socket permissions. The same commands
were rerun with approved escalation and produced sanitized evidence:

- `lark-cli auth status --verify`: bot identity is ready and verified; user
  identity is expired; active usable identity is bot.
- `lark-cli doctor`: `ok: true`; CLI config exists; bot identity is ready;
  Feishu OpenAPI and MCP endpoints are reachable; version update is available
  from `1.0.36` to `1.0.43`.

The raw command output included private IDs and broad scope text; those values
must not be copied into reports.

## Expected Outcomes

Accept only:

- `Pass`: Feishu developer-console URL verification reaches the public HTTPS
  Gateway route and the report records sanitized Gateway status.
- `Blocked`: the public HTTPS route, OpenForge webhook setup environment, or
  developer-console URL verification action is missing.
- `Caveat`: partial live evidence exists but does not satisfy the real
  developer-console callback clearing condition.

## Phase 19 Output

- `.planning/phases/OF-19-feishu-public-callback-evidence/19-01-PLAN.md`
- `docs/reports/phase-19-feishu-public-callback-evidence-2026-05-29.md`
- planning-state updates that keep `FEISHU-CALLBACK` as `Blocked` unless real
  Feishu developer-console verification occurs.
