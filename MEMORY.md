# OpenForge Project Memory

> Updated: 2026-05-10

## Current Stage

- Phase A local-first release closure is accepted by repository reports:
  `docs/reports/browser-terminal-smoke-2026-05-06.md`,
  `docs/reports/claude-permission-smoke-2026-05-07.md`, and
  `docs/reports/release-candidate-2026-05-06.md`.
- Phase C product hardening review items are closed for this pass:
  terminal WebSocket malformed frames are ignored by a typed parser,
  project creation/import payloads remain runtime-CLI-agnostic while the
  database keeps a legacy config hint for template compatibility, and Web
  session status display/filtering normalizes terminal end states to stopped.
- Phase B Codex app-server work is accepted for beta feedback as a guarded
  observable control-plane prototype. The Gateway now owns Codex
  app-server protocol integration for managed sessions, normalizes Codex
  app-server notifications into OpenForge activity events, and aligns outgoing
  frames with `codex-cli 0.130.0` generated bindings instead of a standard
  JSON-RPC wrapper. Real `app-server-websocket` initialize validation is closed
  for the current local toolchain through `pnpm smoke:codex-app-server`, using
  isolated temporary `HOME` and `CODEX_HOME`, capability-token WebSocket auth,
  no prompt/thread/turn requests, and unchanged host `~/.codex` config/auth
  fingerprints around the smoke. The Web prototype is now framed as
  "Codex Background Tasks" and reads the Gateway capability endpoint plus
  `features.turnInputEnabled` from safe session payloads so users can see that
  real task input is disabled by default even before a background session exists.
  It also shows safe session runtime status (endpoint, PID, update time, and
  error text) plus a read-only recent activity feed filtered to Codex app-server
  lifecycle, initialize/thread, notification, and process error events. The Web
  event stream refreshes that feed and the safe app-server session list when
  matching app-server activity events arrive. Natural child-process exits and
  child errors now remain observable as stopped/error manager state and activity
  rows after runtime resources and capability-token files are cleaned up. The
  activity feed now renders localized lifecycle/operation/error/notification
  labels, Gateway-generated notification summaries, and safe details only,
  without surfacing prompt/text/response-like protocol content. Unsafe process
  errors are downgraded to a generic summary before activity persistence.
  Page-level Playwright coverage now verifies the zero-quota Web boundary with
  mocked Gateway APIs: the page renders capability/session/activity status,
  hides any prompt/turn send control, avoids `/turn` requests, and does not
  display transcript-like metadata. The start API now rejects provider-managed
  credential fields (`stored_encrypted_key`, `apiKeyId`, and `modelId`) for
  Codex app-server launch, keeping this path subscription-managed instead of
  silently ignoring provider injection input. Normal Codex terminal sessions now
  enforce the same provider/model boundary during session creation/start and at
  launch-plan construction.
- Terminal persistence remains tmux-backed. Gateway dependency reporting and
  CLI doctor/start messaging now distinguish native tmux support, missing tmux,
  and native Windows environments that require WSL for the built-in browser
  terminal. `openforge start` keeps management services startable but prints a
  terminal-runtime warning when the host cannot support tmux-backed browser
  terminals.
- Model provider management has moved to provider-scoped profiles. The latest
  model work added cc-switch-inspired provider presets, dynamic model sync for
  OpenAI-compatible model-list endpoints, provider-scoped model default/update/
  delete flows, and provider credential rotate/delete flows. Current commit
  series: `c83e595 feat: 支持服务商模型同步` followed by the provider
  management closure commit.

## Source Of Truth

- Release decision: `docs/reports/release-candidate-2026-05-06.md`
- Beta handoff: `docs/reports/beta-handoff-2026-05-10.md`
- Post-RC sequence: `docs/superpowers/specs/2026-05-06-openforge-post-rc-roadmap-design.md`
- Codex app-server boundary: `docs/reports/codex-app-server-architecture-2026-05-06.md`
- Phase B acceptance: `docs/reports/phase-b-codex-app-server-acceptance-2026-05-10.md`
- API surface: `docs/API.md`

## Next Work

1. Keep Codex app-server turn input disabled unless the Gateway is explicitly
   started with `OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1`. Treat `/turn` as a
   default-403 feature-flag prototype API, not a Web-exposed user workflow.
   Gateway does not persist prompt/response transcript content; add
   user-facing retention controls before exposing real turn input in Web. Do not
   add provider API-key or model override application to this Codex app-server
   path.
2. If stopped/error app-server records grow in long-running usage, add an
   explicit TTL or pagination strategy instead of deleting them immediately and
   losing observable process state.
3. Run a physical Windows/WSL manual smoke when that platform is available; the
   current pass covers CLI mode behavior and runbook remediation, not a real
   Windows host.
4. Keep SSH/remote execution as a separate architecture item, not part of the
   local Codex app-server prototype.
