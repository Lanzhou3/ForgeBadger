# ForgeBadger Support Diagnostics

> Historical protocol note (2026-08-31): Copilot commands and test filenames in
> this v1.5 packet are retained evidence identifiers, not supported current
> runtime entry points. Current incidents should be reproduced through
> `/copilot`, `/api/v1/copilot/*`, Project Manager, and current Feishu account tests.

Use this packet when a first-user trial reports provider, runtime/terminal, or
Feishu failures. The goal is to collect enough redacted evidence for triage
without exposing credentials, auth tokens, provider payloads, Feishu secrets, or
sensitive terminal output.

## Before Collecting

- Confirm the report uses `docs/TRIAL-CHECKLIST.md` and either
  `docs/TRIAL-FEEDBACK.md` or the GitHub issue form
  `ForgeBadger first-user trial feedback`.
- Check `docs/EXTERNAL-EVIDENCE-GATES.md` before reclassifying live-provider,
  Windows/WSL, Feishu bot long-connection, or first-user feedback evidence.
- Prefer the Web Settings diagnostics export. The local API is
  `GET /api/v1/diagnostics/export`; it is authenticated, tenant scoped,
  local-only, and redacted.
- Record ForgeBadger version or commit, startup path, OS, shell, browser, Node,
  selected terminal runtime (`tmux -V` or `psmux -V`), Claude Code, and package
  manager versions.
- Share summaries, counts, statuses, sanitized error names, public metadata, and
  file paths. Do not share raw secrets or full payload bodies.
- Keep `Caveat` statuses visible when the missing evidence depends on external
  credentials, physical Windows/WSL hosts, Feishu bot/developer-console access,
  or a real first-user packet.

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
- exact ForgeBadger request path and status code for failing
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

Canonical gate: `docs/EXTERNAL-EVIDENCE-GATES.md` gate `LIVE-PROVIDER`.

Use `/models` provider readiness and the focused provider/cli-config-apply
regression tests. A live-provider result requires an explicitly authorized
disposable credential and is never inferred from unit tests.

Collect these redacted artifacts:

- smoke status: passed / skipped / failed;
- provider name and model id when non-sensitive;
- visible readiness reason from Model Center/Web: no compatible provider, missing
  active credential, missing active model, disabled provider, or provider
  request failure class;
- `/models` Provider Health fields: `readiness.status`, `readiness.code`,
  `checks.remoteModelList`, `remote.errorCode`, matched model id, and next-step
  text. Do not collect plaintext credentials, Authorization headers, provider
  request/response bodies, or raw provider payloads.
- diagnostics export summary from `GET /api/v1/diagnostics/export`;
- browser console/network failure names, status codes, and ForgeBadger request
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
- `endpoint_or_network_failure` means ForgeBadger could not reach the configured
  endpoint or model-list route; verify base URL, proxy, DNS, and models support.
- `remote_model_missing` means the selected model id was not returned by the
  provider model list; sync models or pick a returned model id.
- For Codex `native_cli_login`, collect only normalized `ready`,
  `not_authenticated`, `cli_missing`, or `unknown` plus `chatgpt`, `api`, or
  `unknown`. Codex login is Codex-owned; never collect `auth.json`,
  keyring content, raw status output, or account labels.
- For apply-provider writes, confirm the target CLI config path, that the
  preview masked credential values and wrote nothing to disk, and that the
  apply produced a `0600` atomic write with an AES-256-GCM-encrypted backup
  that rollback can restore. Never collect plaintext credential values.
- If a session still uses the old provider/model after a config change, re-run
  `POST /api/v1/cli-config/:adapter/apply-provider` (or the Web equivalent) and
  restart the session. Historical sessions always restart as plain
  host-environment sessions; there is no frozen launch environment to bypass
  or restore.
- A configured provider that returns a recoverable auth, quota, network,
  unsupported-model, timeout, or outage error is a provider readiness issue.
  Preserve the provider error class, not raw provider request or response
  bodies.
- Copilot exposing unapproved terminal input or raw shell execution is a
  product contract failure and should be escalated to engineering.
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

Canonical gate: `docs/EXTERNAL-EVIDENCE-GATES.md` gate `WINDOWS-WSL` when the
report claims physical Windows/WSL terminal evidence.

Run or request:

```bash
forgebadger doctor
node --version
claude --version
pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium --reporter=line
pnpm --dir packages/web exec playwright test e2e/gate-d-smoke.spec.ts --project=chromium --reporter=line
RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts
```

Also record `tmux -V` on macOS/Linux/WSL or `psmux -V` on native Windows.
The focused `RUN_TMUX_TESTS` command is Linux/macOS tmux evidence only; it is
not native Windows psmux coverage.

Collect these redacted artifacts:

- startup command, Web URL, Gateway URL, and health envelope status;
- `forgebadger doctor` dependency summary;
- browser terminal attach/input/resize evidence;
- refresh/reconnect result;
- stop-session and restart-recovery result;
- selected multiplexer session name only when it is not sensitive;
- relevant ForgeBadger error names, status codes, and request paths;
- `mvp1-smoke`, `gate-d-smoke`, and focused tmux command summaries.

Classify:

- Missing tmux/psmux, psmux below 3.3.8, missing local AI CLI, install-confirmation
  failure, or unclear dependency guidance maps to UX-01.
- Physical Windows/WSL remains `Caveat` until a native ConPTY + psmux and/or
  real WSL tmux run records browser + real AI CLI attach/input/output/resize,
  WebSocket reconnect, Gateway restart recovery, stop, and cleanup evidence.
- `forgebadger start`/`init` must exit non-zero without state/process side
  effects when runtime readiness remains false. `doctor` must remain read-only,
  including against an absent state directory. Direct Gateway startup must fail
  before recovery/database/listen side effects.
- `mvp1-smoke` is stable control-plane evidence. `gate-d-smoke` is
  release/manual browser terminal evidence unless CI supplies Gateway/Web,
  tmux, and real CLI prerequisites.

Escalate when:

- Gateway restart or WebSocket disconnect kills the CLI process instead of
  preserving the platform-multiplexer session;
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

Canonical gate: `docs/EXTERNAL-EVIDENCE-GATES.md` gate `FEISHU-BOT-WS`.

Run or request:

```bash
lark-cli auth status --verify
lark-cli doctor
pnpm --dir packages/gateway test test/feishu-bot-bridge.test.ts test/feishu-integration.test.ts test/copilot-routes.test.ts
pnpm smoke:feishu-bot-websocket
pnpm smoke:feishu-bot-live -- --require-gate-evidence --output <report.json>
pnpm evidence:feishu-bot-live-audit -- <report.json>
pnpm evidence:feishu-bot-live-report -- --report <report.json> --output <report.md>
```

For the primary Feishu gate, configure the self-built Feishu bot to receive
events through persistent connection/WebSocket mode, subscribe to
`im.message.receive_v1`, set `FORGEBADGER_GATEWAY_URL`, `FORGEBADGER_TOKEN`,
`FEISHU_APP_ID`, and `FEISHU_APP_SECRET`, then start
`pnpm smoke:feishu-bot-live -- --require-gate-evidence --output <report.json>`.
Send one allowed bounded command such as `/forgebadger status`, then send a
terminal-control probe such as `/forgebadger terminal session-1 continue`, and
force a reconnect or restart observation before saving the redacted JSON
report. Run
`pnpm evidence:feishu-bot-live-audit -- <report.json>` before maintainer gate
review, then generate
`pnpm evidence:feishu-bot-live-report -- --report <report.json> --output
<report.md>` for the maintainer evidence packet.

If a deployment intentionally uses public webhook compatibility mode, verify in
the Feishu developer console that the event subscription URL reaches:

```text
https://<public-host>/api/v1/integrations/feishu/webhook/<publicWebhookId>
```

Collect these redacted artifacts:

- `lark-cli auth status --verify` summary and `lark-cli doctor` summary;
- Feishu bot persistent-connection mode and subscribed event summary;
- authenticated Gateway bot-websocket smoke output from
  `pnpm smoke:feishu-bot-websocket`, including
  `/api/v1/integrations/feishu/bot-websocket/events` and
  `/api/v1/integrations/feishu/bot-websocket/connection-events`, showing the
  normalized event id, route, reply plan or rejection code, and reconnect
  state;
- sanitized real SDK long-connection smoke output from
  `pnpm smoke:feishu-bot-live -- --require-gate-evidence --output
  <report.json>`, including connected/reconnecting/reconnected state, event
  name, allowed DM or group path, redacted receive/reply marker, and
  terminal-input rejection marker;
- audit output from `pnpm evidence:feishu-bot-live-audit -- <report.json>`
  showing `readyForHumanReview=true` and `gateClearingEvidence=false`;
- generated Markdown maintainer review report from
  `pnpm evidence:feishu-bot-live-report -- --report <report.json> --output
  <report.md>`;
- optional public webhook compatibility output, if that topology is under test:
  enabled state, identity mode, allowed chat count, mapping count, public id
  shape, callback path, and developer-console URL verification status;
- Gateway audit status or safe event marker for the Feishu message;
- automated regression summary from
  `pnpm --dir packages/gateway test test/feishu-bot-bridge.test.ts test/feishu-integration.test.ts test/copilot-routes.test.ts`;
- owner and next action.

Classify:

- `lark-cli` preflight proves CLI availability only; it does not prove the bot
  long-connection receive/reply path.
- Simulated signed Gateway requests and `pnpm smoke:feishu-bot-websocket` are
  authenticated local Gateway regression evidence, not Feishu long-connection
  evidence by themselves.
- `pnpm smoke:feishu-bot-live -- --require-gate-evidence --output
  <report.json>` is the real SDK long-connection collection command. It still
  leaves the gate as `Caveat` if the run does not include real receive, bounded
  reply, reconnect, and terminal rejection evidence.
- `pnpm evidence:feishu-bot-live-audit -- <report.json>` validates a saved
  live report for completeness and redaction before maintainer review. The
  audit is not itself gate-clearing evidence.
- `pnpm evidence:feishu-bot-live-report -- --report <report.json> --output
  <report.md>` formats an audited saved report for maintainer review. The
  Markdown report is not itself gate-clearing evidence.
- The Feishu gate remains `Caveat` until a real bot persistent-connection run
  records receive, routing, reply or pending-action, and reconnect evidence.
- Public webhook URL verification is optional compatibility evidence. It is not
  required for the primary local-first Feishu bot gate.
- Public webhook support is local or single Gateway with SQLite-backed
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
- Feishu evidence includes raw WebSocket frames, raw signatures, verification
  token values, event encryption keys, app secrets, raw callback body, or
  private chat content.

Redact:

- Feishu app secrets;
- verification token values;
- event encryption keys;
- raw WebSocket frames;
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
- JWTs, browser auth token values, attach tokens, and `forgebadger.token` values;
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
- terminal persistence no longer depends on the selected tmux/psmux runtime;
- Copilot or Feishu can execute or approve without the pending-action boundary;
- Feishu public webhook is exposed in a multi-instance topology without shared
  replay and shared rate-limit stores;
- encrypted Feishu payload handling is enabled outside the documented fail-closed
  boundary.

Route to maintainer/operator when the issue is missing external evidence:

- no disposable live provider credential or explicit model id;
- no physical Windows/WSL host;
- no Feishu bot long-connection/WebSocket operator access;
- no real `im.message.receive_v1` receive/reply/reconnect evidence;
- no public HTTPS Gateway URL or Feishu developer-console URL verification
  action, when the optional public webhook compatibility path is under test;
- no completed first-user feedback packet. Use `docs/TRIAL-FEEDBACK.md` or
  `.github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml`, then run
  `pnpm trial:feedback-audit -- <packet.md>` for Markdown packets or
  `pnpm trial:feedback-issue-audit -- --issue=<number>` for GitHub issue-form
  feedback before maintainer triage. Use `pnpm trial:feedback-issues-audit` to
  scan non-tracker GitHub `trial-feedback` issue candidates. Use
  `docs/EXTERNAL-EVIDENCE-GATES.md` gate `FIRST-USER-FEEDBACK` for the required
  packet shape.
