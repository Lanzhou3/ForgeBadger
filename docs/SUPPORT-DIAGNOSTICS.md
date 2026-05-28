# OpenForge Support Diagnostics

Use this packet when a first-user trial reports provider, runtime/terminal, or
Feishu failures. The goal is to collect enough redacted evidence for triage
without exposing credentials, auth tokens, provider payloads, Feishu secrets, or
sensitive terminal output.

## Before Collecting

- Confirm the report uses `docs/TRIAL-CHECKLIST.md` and either
  `docs/TRIAL-FEEDBACK.md` or the GitHub issue form
  `OpenForge first-user trial feedback`.
- Prefer the Web Settings diagnostics export. The local API is
  `GET /api/v1/diagnostics/export`; it is authenticated, tenant scoped,
  local-only, and redacted.
- Record OpenForge version or commit, startup path, OS, shell, browser, Node,
  tmux, Claude Code, and package manager versions.
- Share summaries, counts, statuses, sanitized error names, public metadata, and
  file paths. Do not share raw secrets or full payload bodies.
- Keep `Caveat` statuses visible when the missing evidence depends on external
  credentials, physical Windows/WSL hosts, public HTTPS routing, or Feishu
  developer-console access.

## Project Manager Failures

Run or request:

```bash
pnpm --dir packages/web run typecheck
pnpm --dir packages/web exec vitest run src/lib/api.test.ts
pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium
```

Collect these redacted artifacts:

- project id or disposable project name when non-sensitive;
- Project Manager tab screenshot showing goal, work item, or ledger state;
- exact OpenForge request path and status code for failing
  `/api/v1/projects/:projectId/project-manager/*` calls;
- work item title or short ID;
- evidence reference fields only: `kind`, `label`, `ref`, and `path`;
- ledger event type, work item title or ID, status, evidence count, Feishu
  reference count, and timestamp;
- focused test command summary and failure name;
- owner and next action.

Classify:

- Evidence attachment failure with safe draft values preserved is a recoverable
  Project Manager mutation issue.
- Evidence attachment failure that clears the Sheet, drops safe values, or asks
  for raw content is a product contract failure.
- Ledger load failure should remain scoped to the ledger area. If it hides goal
  or work item data, map it to UX-06.
- Unknown Project Manager API endpoint drift should fail strict E2E mocks rather
  than returning a generic success response.
- Evidence-free `done` should require a non-empty manual completion reason.

Escalate when:

- Project Manager data appears across tenants or projects;
- evidence attachment accepts raw terminal transcripts, Feishu message bodies,
  provider payloads, API keys, JWTs, private keys, attach tokens, or unrelated
  project secrets;
- ledger rows expose raw manual reasons, evidence reference lists, terminal
  output, Feishu bodies, provider payloads, or secret-bearing details;
- a status transition bypasses the documented Gateway transition rules;
- diagnostics expose plaintext credentials or raw project-manager payloads.

Redact:

- raw terminal transcripts;
- Feishu message bodies;
- provider payloads;
- API keys;
- JWTs;
- private keys;
- attach tokens;
- unrelated project secrets;
- browser auth token values;
- raw provider or callback bodies.

Acceptable evidence references are short pointers, not raw evidence. Examples:
`docs/TRIAL-CHECKLIST.md`, `project-manager.spec.ts`,
`docs/reports/v1.2-project-manager-web-workflow-closeout-2026-05-22.md`,
`OF-123`, `PR-42`, or a short test command name.

## Provider Failures

Run or request:

```bash
pnpm smoke:copilot-provider
```

Collect these redacted artifacts:

- smoke status: passed / skipped / failed;
- provider name and model id when non-sensitive;
- visible readiness reason from Copilot/Web: no compatible provider, missing
  active credential, missing active model, disabled provider, or provider
  request failure class;
- `/models` Provider Health fields: `readiness.status`, `readiness.code`,
  `checks.remoteModelList`, `remote.errorCode`, matched model id, and next-step
  text. Do not collect plaintext credentials, Authorization headers, provider
  request/response bodies, or raw provider payloads.
- diagnostics export summary from `GET /api/v1/diagnostics/export`;
- browser console/network failure names, status codes, and OpenForge request
  paths;
- owner and next action.

Classify:

- Missing disposable credential, missing active model, or missing compatible
  provider is an environment `Caveat` until the operator provides a disposable
  credential and explicit model id.
- `invalid_credential` means the selected credential failed provider auth;
  rotate or replace the credential before retrying.
- `timeout` means the provider call did not complete inside the readiness
  timeout; retry once, then check host network/proxy connectivity.
- `provider_outage` means the provider returned a 5xx-style failure; check the
  provider status page or retry later.
- `endpoint_or_network_failure` means OpenForge could not reach the configured
  endpoint or model-list route; verify base URL, proxy, DNS, and models support.
- `remote_model_missing` means the selected model id was not returned by the
  provider model list; sync models or pick a returned model id.
- `codex_subscription_managed` is expected for Codex. It is not a third-party
  provider key failure; Codex must keep using the subscription-managed SDK
  identity path.
- A configured provider that returns a recoverable auth, quota, network,
  unsupported-model, timeout, or outage error is a provider readiness issue.
  Preserve the provider error class, not raw provider request or response
  bodies.
- Copilot exposing terminal input, raw shell execution, automatic tmux input, or
  Codex app-server `/turn` input is a product contract failure and should be
  escalated to engineering.
- Copilot pending-action state moving backward, duplicating approval, or losing
  cancellation context should be mapped to UX-03 or UX-05.

Escalate when:

- a user can trigger an action without pending-action approval;
- diagnostics expose plaintext credentials, encrypted secret blobs, provider
  default headers, raw provider payloads, or foreign-tenant provider data;
- provider failures produce empty UI instead of a recoverable error state;
- a live-provider `Pass` claim lacks disposable credential and redacted command
  evidence.

Redact:

- raw provider keys;
- default headers;
- raw provider request body;
- raw provider response body;
- full model output;
- browser auth token value;
- JWTs and attach tokens.

## Runtime And Terminal Failures

Run or request:

```bash
openforge doctor
node --version
tmux -V
claude --version
pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium --reporter=line
pnpm --dir packages/web exec playwright test e2e/gate-d-smoke.spec.ts --project=chromium --reporter=line
RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts
```

Collect these redacted artifacts:

- startup command, Web URL, Gateway URL, and health envelope status;
- `openforge doctor` dependency summary;
- browser terminal attach/input/resize evidence;
- refresh/reconnect result;
- stop-session and restart-recovery result;
- tmux session name only when it is not sensitive;
- relevant OpenForge error names, status codes, and request paths;
- `mvp1-smoke`, `gate-d-smoke`, and focused tmux command summaries.

Classify:

- Missing `tmux`, missing local AI CLI, unsupported native Windows terminal
  mode, or unclear dependency guidance maps to UX-01.
- Native Windows can prove management UI behavior only. It cannot clear the
  physical Windows/WSL terminal `Caveat`.
- Physical Windows/WSL terminal pass requires a real WSL host with browser
  terminal attach/input/resize, WebSocket reconnect, Gateway restart recovery,
  and cleanup evidence.
- `mvp1-smoke` is stable control-plane evidence. `gate-d-smoke` is
  release/manual browser terminal evidence unless CI supplies Gateway/Web,
  tmux, and real CLI prerequisites.

Escalate when:

- Gateway restart or WebSocket disconnect kills the CLI process instead of
  preserving the tmux session;
- terminal ownership or attach-token checks leak cross-tenant session access;
- terminal output appears in SQLite or diagnostics exports;
- terminal logs include secrets or raw transcripts that should be summarized.

Redact:

- sensitive terminal output;
- full auth/config files;
- attach tokens;
- JWTs;
- private keys;
- unrelated project secrets;
- raw command output that includes credentials.

## Feishu Failures

Run or request:

```bash
lark-cli auth status --verify
lark-cli doctor
pnpm smoke:feishu-public-webhook
pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts
```

For the real callback gate, verify in the Feishu developer console that the
event subscription URL reaches:

```text
https://<public-host>/api/v1/integrations/feishu/webhook/<publicWebhookId>
```

Collect these redacted artifacts:

- `lark-cli auth status --verify` summary and `lark-cli doctor` summary;
- sanitized `pnpm smoke:feishu-public-webhook` output: enabled state, identity
  mode, allowed chat count, mapping count, public id shape, and callback path;
- developer-console URL verification status and timestamp;
- Gateway audit status or safe event marker for the callback;
- automated regression summary from
  `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts`;
- owner and next action.

Classify:

- `lark-cli` preflight and long-running event consumption are not real
  developer-console callback evidence.
- Simulated signed Gateway requests are local regression evidence, not Feishu
  developer-console proof.
- The real callback remains `Blocked` until a public HTTPS URL routes to
  Gateway and Feishu developer-console URL verification hits the public webhook
  route.
- v1.1 public webhook support is local or single Gateway with SQLite-backed
  replay/rate storage. Multi-instance public exposure requires shared replay
  and shared rate-limit stores before enablement.
- Top-level encrypted Feishu payloads fail closed with
  `feishu_webhook_encrypted_payload_unsupported`. Tenants requiring encrypted
  app mode must keep public webhook enablement off until decrypt support is
  separately implemented and security-reviewed.

Escalate when:

- free-form Feishu text can approve pending actions, send terminal input, or
  mutate project-manager state;
- chat allowlist, user mapping, project visibility, replay, or rate limits are
  bypassed;
- multi-instance public webhook exposure is enabled without shared replay and
  shared rate-limit stores;
- encrypted Feishu app mode is enabled without decrypt support and tests;
- callback evidence includes raw signatures, verification token values, event
  encryption keys, app secrets, raw callback body, or private chat content.

Redact:

- Feishu app secrets;
- verification token values;
- event encryption keys;
- raw signatures;
- raw callback body;
- private chat content;
- mapped user secrets;
- JWTs and browser auth token values.

## Redaction Checklist

Before attaching diagnostics, confirm all of these are removed or summarized:

- raw provider keys;
- Feishu secrets, verification token values, event encryption keys, and app
  secrets;
- JWTs, browser auth token values, attach tokens, and `openforge.token` values;
- plaintext passwords and private keys;
- raw provider request bodies and raw provider response bodies;
- raw callback body content;
- sensitive terminal output or full terminal transcripts;
- full auth/config files;
- unrelated project secrets;
- private chat content;
- full model outputs.

Secret-like scan matches are acceptable only when they are placeholder names,
environment variable names without values, forbidden-category wording, or
synthetic tests that intentionally verify redaction behavior.

## Escalation Boundaries

Escalate to engineering immediately when the evidence suggests:

- tenant isolation failure;
- unauthenticated REST or WebSocket access to tenant data;
- secrets in diagnostics, logs, provider output, terminal evidence, or Feishu
  callback evidence;
- terminal persistence no longer depends on tmux;
- Copilot or Feishu can execute or approve without the pending-action boundary;
- Feishu public webhook is exposed in a multi-instance topology without shared
  replay and shared rate-limit stores;
- encrypted Feishu payload handling is enabled outside the documented fail-closed
  boundary.

Route to maintainer/operator when the issue is missing external evidence:

- no disposable live provider credential or explicit model id;
- no physical Windows/WSL host;
- no public HTTPS Gateway URL;
- no Feishu developer-console URL verification action;
- no completed first-user feedback packet.
