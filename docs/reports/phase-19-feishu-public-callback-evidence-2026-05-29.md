# Phase 19 Feishu Public Callback Evidence

Date: 2026-05-29
Scope: Phase 19 `FEI-LIVE-01` through `FEI-LIVE-03` evidence attempt for the v1.4 `FEISHU-CALLBACK` gate.

## Status

| Gate | Status | Decision |
|------|--------|----------|
| `FEISHU-CALLBACK` | Blocked | Feishu CLI bot preflight is usable and local regression passes, but no public HTTPS Gateway route, operator webhook setup environment, or Feishu developer-console URL verification action was available in this run. |

## Command Evidence

Commands:

```bash
lark-cli --version
lark-cli auth status --verify
lark-cli doctor
pnpm smoke:feishu-public-webhook
pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts
pnpm --dir packages/gateway typecheck
```

Environment summary:

- OS: Linux `6.8.0-107-generic` `x86_64 GNU/Linux`
- Node: `v24.14.1`
- pnpm: `10.33.2`
- Commit: `6b51b61`
- `lark-cli`: `1.0.36`
- OpenForge Feishu setup environment availability: all required public-webhook
  setup variable names were unset in the current shell.

Execution notes:

- Sandboxed `lark-cli` network verification hit local proxy socket permission
  errors. The same commands were rerun with approved escalation.
- Sandboxed `pnpm smoke:feishu-public-webhook` failed before helper execution
  because `tsx` could not create its IPC pipe: `listen EPERM` under
  `/tmp/tsx-*`. The same command was rerun with approved escalation.
- Sandboxed Gateway tests also collapsed into whole-file failures because of
  the same `tsx` IPC limitation. The same test command was rerun with approved
  escalation.

## Sanitized Feishu CLI Result

`lark-cli auth status --verify`:

- bot identity: ready and verified;
- user identity: missing because refresh token expired;
- usable identity for bot/tenant calls: bot;
- proxy warning present.

`lark-cli doctor`:

- overall status: `ok: true`;
- CLI config file found;
- Feishu app resolved;
- bot identity ready;
- at least one identity available;
- Feishu OpenAPI endpoint reachable;
- Feishu MCP endpoint reachable;
- version update available from `1.0.36` to `1.0.43`.

Private app ids, user ids, bot ids, names, token metadata, and scope lists from
the raw CLI output were intentionally not recorded.

## Webhook Setup Helper Result

Command:

```bash
pnpm smoke:feishu-public-webhook
```

Unrestricted result:

```json
{
  "ok": false,
  "reason": "OPENFORGE_DB_PATH is required"
}
```

This is a setup blocker, not a Feishu developer-console callback attempt. The
helper cannot configure the public webhook without an operator-provided
OpenForge database path, master key, OpenForge user selector, public webhook
id, verification token, and event encrypt key.

## Developer Console Verification

No real Feishu developer-console URL verification occurred in this phase.

Required live URL shape:

```text
https://<public-host>/api/v1/integrations/feishu/webhook/<publicWebhookId>
```

Missing live prerequisites:

- a public HTTPS URL routed to the current Gateway;
- operator-provided public webhook setup environment;
- Feishu developer-console event subscription URL verification action;
- sanitized Gateway callback marker proving that the console request reached
  the public route.

## Regression Evidence

Command:

```bash
pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts
```

Unrestricted result:

- exit code: `0`;
- tests: `183`;
- pass: `183`;
- fail: `0`.

Covered boundaries include:

- public URL verification has no Copilot side effects;
- unsigned, stale, invalid-token, encrypted, out-of-allowlist, replayed, and
  rate-limited public webhook events fail closed;
- a valid signed public webhook message can create one Feishu-sourced Copilot
  run under policy;
- free-form Feishu approval text does not approve pending actions;
- outbound Feishu actions stay constrained by integration enabled state,
  configured targets, identity mode, and user mappings;
- active `waiting_for_approval` runs block new Feishu inbound runs.

Typecheck:

```bash
pnpm --dir packages/gateway typecheck
```

Unrestricted result: exit code `0`.

Automated regression is still local simulated Gateway evidence. It does not
replace Feishu developer-console URL verification.

## Gate Decision

`FEISHU-CALLBACK` remains `Blocked`.

Phase 19 records a stronger current-state blocker than the Phase 7 historical
report:

1. `lark-cli` bot preflight and endpoint reachability are currently usable.
2. OpenForge public-webhook setup environment is missing.
3. Public HTTPS Gateway routing is not available in this execution.
4. Feishu developer-console URL verification was not performed.
5. Local authority and policy regression passed.

No `Pass` can be claimed until a real Feishu developer-console URL verification
request reaches the public Gateway webhook route and the sanitized Gateway
status is recorded.

## Rerun Path

1. Start Gateway with the production/trial database and stable
   `OPENFORGE_MASTER_KEY`.
2. Set operator-controlled webhook setup environment in the shell or secret
   manager. Do not write secret values into reports or shell history.
3. Run:

```bash
pnpm smoke:feishu-public-webhook
```

4. Expose the Gateway route through public HTTPS:

```text
https://<public-host>/api/v1/integrations/feishu/webhook/<publicWebhookId>
```

5. Configure the Feishu developer-console event subscription URL to that
   address and run URL verification.
6. Record only sanitized console status, timestamp, callback route shape, and
   Gateway audit/status marker.
7. Rerun:

```bash
pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts
pnpm --dir packages/gateway typecheck
```

## Artifact And Redaction Review

Allowed artifact fields recorded:

- command names;
- OS/Node/pnpm/commit summaries;
- CLI version and readiness classes;
- helper status and missing environment variable name;
- test counts and pass/fail counts;
- gate decision and next actions.

Forbidden content not recorded:

- Feishu app secrets;
- verification tokens;
- event encryption keys;
- raw signatures, nonces, and callback bodies;
- private chat content;
- private app ids, bot ids, user ids, names, and scope lists;
- JWTs, browser auth tokens, attach tokens, or provider credentials.

Secret-pattern scan note: verification scans may match documented forbidden
pattern text or environment variable names in this report and the Phase 19
plan. Those matches are field names or scan patterns, not secret values.

## Verification

```bash
rg -n "FEISHU-CALLBACK|phase-19-feishu|smoke:feishu-public-webhook|lark-cli|OPENFORGE_DB_PATH|developer-console|Blocked|Pass|Caveat" docs/EXTERNAL-EVIDENCE-GATES.md docs/reports/phase-19-feishu-public-callback-evidence-2026-05-29.md .planning/REQUIREMENTS.md .planning/ROADMAP.md .planning/STATE.md .planning/phases/OF-19-feishu-public-callback-evidence MEMORY.md
rg -n "app_secret|verification token value|event encrypt key value|x-lark-signature|Bearer [A-Za-z0-9._-]+|ou_[A-Za-z0-9]+|cli_[A-Za-z0-9]+|OPENFORGE_FEISHU_WEBHOOK_VERIFICATION_TOKEN=|OPENFORGE_FEISHU_WEBHOOK_EVENT_ENCRYPT_KEY=" docs/reports/phase-19-feishu-public-callback-evidence-2026-05-29.md .planning/phases/OF-19-feishu-public-callback-evidence || true
git diff --check
```
