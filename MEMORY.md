# OpenForge Project Memory

> Updated: 2026-05-07

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
  frames with `codex-cli 0.128.0` generated bindings instead of a standard
  JSON-RPC wrapper.

## Source Of Truth

- Release decision: `docs/reports/release-candidate-2026-05-06.md`
- Post-RC sequence: `docs/superpowers/specs/2026-05-06-openforge-post-rc-roadmap-design.md`
- Codex app-server boundary: `docs/reports/codex-app-server-architecture-2026-05-06.md`
- API surface: `docs/API.md`

## Next Work

1. Continue Phase B with transport-level real `codex app-server` initialize
   response capture. Zero-quota validation on 2026-05-07 used an isolated
   `/tmp/openforge-codex-isolated` HOME/CODEX_HOME, confirmed `codex-cli
   0.128.0`, generated protocol bindings, and short-lived Unix-socket startup,
   but one-shot initialize over stdio/proxy did not emit a response yet.
2. Extend the guarded Web prototype only after initialize response capture.
   Current Web surface supports lifecycle, initialize, thread creation, and stop;
   prompt/turn input remains intentionally hidden to avoid accidental quota use.
3. Keep SSH/remote execution as a separate architecture item, not part of the
   local Codex app-server prototype.
