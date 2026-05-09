# OpenForge Project Memory

> Updated: 2026-05-09

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
- Phase B Codex app-server work is active. The Gateway now owns Codex
  app-server protocol integration for managed sessions, normalizes Codex
  app-server notifications into OpenForge activity events, and aligns outgoing
  frames with `codex-cli 0.130.0` generated bindings instead of a standard
  JSON-RPC wrapper. Real `app-server-websocket` initialize validation is closed
  for the current local toolchain through `pnpm smoke:codex-app-server`, using
  isolated temporary `HOME` and `CODEX_HOME`, capability-token WebSocket auth,
  and no prompt/thread/turn requests. The Web prototype is now framed as
  "Codex Background Tasks" and reads the Gateway capability endpoint plus
  `features.turnInputEnabled` from safe session payloads so users can see that
  real task input is disabled by default even before a background session exists.
- Model provider management has moved to provider-scoped profiles. The latest
  model work added cc-switch-inspired provider presets, dynamic model sync for
  OpenAI-compatible model-list endpoints, provider-scoped model default/update/
  delete flows, and provider credential rotate/delete flows. Current commit
  series: `c83e595 feat: 支持服务商模型同步` followed by the provider
  management closure commit.

## Source Of Truth

- Release decision: `docs/reports/release-candidate-2026-05-06.md`
- Post-RC sequence: `docs/superpowers/specs/2026-05-06-openforge-post-rc-roadmap-design.md`
- Codex app-server boundary: `docs/reports/codex-app-server-architecture-2026-05-06.md`
- API surface: `docs/API.md`

## Next Work

1. Keep extending the guarded Web prototype around observable lifecycle and
   status only. Current Web surface supports lifecycle, initialize, thread
   creation, stop, and backend-backed capability display; prompt/turn input
   remains intentionally hidden to avoid accidental quota use.
2. Keep Codex app-server turn input disabled unless the Gateway is explicitly
   started with `OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1`. Gateway does not
   persist prompt/response transcript content; add user-facing retention
   controls before exposing real turn input in Web.
3. Run release-sized build/regression evidence when preparing the next beta
   handoff; the model provider closure already has API, unit, typecheck, and
   local browser smoke coverage.
4. Keep SSH/remote execution as a separate architecture item, not part of the
   local Codex app-server prototype.
