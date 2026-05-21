# Phase 5: Remote Execution Architecture - Context

**Gathered:** 2026-05-20T17:05:00Z
**Status:** Ready for planning
**Mode:** Auto-selected recommended defaults per user instruction to continue without waiting.

<domain>
## Phase Boundary

Phase 5 produces the remote execution architecture package before implementation: an updated architecture/spec, threat model, rollback plan, phased delivery gates, and verification strategy for SSH-backed execution targets.

This phase must not implement runtime remote routes, database migrations, Web UI, terminal transports, cloud hosting, billing, telemetry, marketplace operations, or Codex app-server Web prompt/turn input. The output should let a later implementation phase build remote execution without weakening the validated local-first control plane.

</domain>

<decisions>
## Implementation Decisions

### Scope And Product Boundary

- **D-01:** Treat Phase 5 as a design and security architecture phase only. It should produce docs/spec artifacts, not runtime code paths.
- **D-02:** Preserve OpenForge's product wedge as a local-first AI CLI control plane. Remote execution is an explicit user-owned target extension, not a hosted autonomous development platform.
- **D-03:** Keep hosted collaboration, cloud deployment, billing, telemetry, hosted marketplace, and multi-tenant cloud workers out of scope. If mentioned, they belong in later milestones after separate architecture and security review.
- **D-04:** Do not use Phase 5 to remove existing beta caveats for live providers, physical Windows/WSL smoke, or first-user feedback. Those remain evidence topics, not remote-architecture shortcuts.

### Remote Execution Shape

- **D-05:** Use explicit execution targets: an implicit `local` target for today's Gateway host and user-managed `ssh` targets for remote hosts.
- **D-06:** Projects are bound to exactly one execution target at create/import time. Sessions inherit the project target at launch so historical sessions remain tied to the host that actually ran them.
- **D-07:** Use the existing confirmed direction: SSH target plus remote agent over SSH stdio. Reject raw `ssh host "tmux ..."` command wrappers because they blur validation boundaries and encourage shell string construction.
- **D-08:** Do not allow direct browser-to-SSH. Web continues to talk only to Gateway HTTP/WebSocket APIs.
- **D-09:** Keep the browser terminal WebSocket contract unchanged. Gateway should select a target-aware transport behind the same `terminal_input`, `terminal_output`, `terminal_resize`, `terminal_exit`, and `terminal_error` messages.

### Remote Agent And Terminal Authority

- **D-10:** A remote agent owns remote path validation, dependency discovery, tmux create/attach/capture/resize/stop, and remote orphan cleanup on the remote host.
- **D-11:** The remote agent protocol must expose explicit typed operations only. It must not provide a generic arbitrary shell command API.
- **D-12:** Remote terminal persistence remains tmux-backed. SQLite may store structured target/session metadata, but not terminal scrollback, raw transcripts, or remote command output.
- **D-13:** Terminal input authority remains the existing authenticated WebSocket/session attach-token path. Copilot, Feishu, or future project-manager flows must not gain direct remote terminal control without explicit pending-action approval semantics in a later implementation phase.

### Credentials, Host Keys, And Path Safety

- **D-14:** SSH support must fail closed. Never set `StrictHostKeyChecking=no`.
- **D-15:** Host key identity must be pinned after explicit first-use approval or provided by the user before first connection. Host key mismatch is a hard error requiring user action.
- **D-16:** First implementation planning should prefer OS `ssh-agent` or a user-selected key path. Private key import is deferred unless the plan includes encryption-at-rest, passphrase handling, deletion semantics, and security review.
- **D-17:** Do not store plaintext SSH passwords in the first remote execution release.
- **D-18:** Remote CLI account state stays on the remote host. Codex subscription state, Claude login state, and OpenCode auth are discovered remotely; local provider API keys are not copied to remote targets.
- **D-19:** Remote project paths must be checked on the remote host with remote `safeResolve`/realpath logic against configured allowed roots. Remote symlinks are allowed only when their resolved path stays inside allowed roots.
- **D-20:** Require explicit allowed roots per SSH target from day one. A single user-confirmed project path without target roots is not enough for the security baseline.

### Codex App-Server Boundary

- **D-21:** Phase 5 must not enable Codex app-server Web prompt/turn input. `/turn` remains disabled unless transcript retention, consent, rate limiting, model usage, and security requirements are designed and reviewed.
- **D-22:** Do not include remote Codex app-server control-plane support in the first remote execution architecture. Remote terminal Codex remains subscription-managed on the remote host if and when remote terminal sessions are implemented.

### Failure Taxonomy, Diagnostics, And Rollback

- **D-23:** Remote failures must identify the failing layer with stable codes such as `host_key_untrusted`, `host_key_mismatch`, `ssh_auth_failed`, `ssh_unreachable`, `remote_agent_missing`, `remote_agent_version_unsupported`, `remote_tmux_missing`, `remote_cli_missing`, `remote_path_denied`, `remote_session_launch_failed`, and `remote_terminal_attach_failed`.
- **D-24:** Diagnostics may include target id/type, host-key state, agent version, dependency status, adapter discovery status, and redacted error summaries. They must not include private keys, passphrases, raw SSH stderr, bearer tokens, attach tokens, terminal transcripts, or full remote paths when redaction policy says to hide them.
- **D-25:** The rollback plan must be additive and local-safe: existing projects/sessions keep working as local, remote target launch can be disabled, remote migrations are nullable/default-local, and remote target records can be ignored without breaking local session recovery.
- **D-26:** Plan future delivery in phases: target registry and connection test first, remote dependency/project discovery second, remote terminal sessions third, and hardening/release evidence last.
- **D-27:** WSL remains primarily a local-runtime remediation and evidence topic. It may be used as an optional SSH smoke host if configured explicitly, but it should not replace physical Windows/WSL local terminal caveat evidence.

### the agent's Discretion

The planner may choose exact artifact names and doc structure, but the plan must cover REM-01, REM-02, and COD-01 with traceable architecture, threat model, rollback, and verification artifacts. If existing `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` already covers an area, update or supplement it instead of duplicating conflicting specs.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap And Requirements

- `.planning/PROJECT.md` - local-first product wedge, out-of-scope hosted/autonomous boundaries, and remote execution as separate architecture item.
- `.planning/REQUIREMENTS.md` - Phase 5 requirements `REM-01`, `REM-02`, and `COD-01`.
- `.planning/ROADMAP.md` - Phase 5 goal, dependencies, success criteria, and single plan `05-01`.
- `.planning/DECISIONS-INDEX.md` - locked decisions for Gateway/Web split, tmux persistence, Codex boundary, and remote execution deferral.
- `.planning/phases/OF-03-first-user-product-hardening/03-CONTEXT.md` - first-user hardening boundaries, especially no remote execution or Codex turn input in Phase 3.
- `.planning/phases/OF-04-feishu-project-manager-ledger/04-CONTEXT.md` - authority separation, no terminal history in SQLite, and no Feishu terminal/approval authority.

### Remote Execution Design Inputs

- `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` - confirmed SSH remote execution design; use as the primary seed for Phase 5, then add current threat model and rollback detail.
- `docs/TECH-ARCHITECTURE.md` - current local launch contract, credential policy, filesystem trust boundary, tmux terminal architecture, and WebSocket safety baseline.
- `docs/API.md` - current API envelope, Codex app-server disabled-turn boundary, session snapshots, activities, WebSocket contract, and terminal safety rules.
- `docs/CI-CD-PLAN.md` - local/self-hosted release gate commands, Codex app-server safe surface, and cloud/telemetry deferral.
- `docs/DEVELOPMENT-PLAN.md` - post-beta notes that SSH/remote execution has a separate confirmed design and remains outside beta release gates.
- `CLAUDE.md` - repository-level architecture and hard red lines for terminal persistence, Gateway/Web split, security, and Codex boundary.

### Existing Code Surfaces To Respect

- `packages/gateway/src/routes/index.ts` - Gateway route mount pattern; future target APIs must stay under `/api/v1`.
- `packages/gateway/src/websocket/` - terminal WebSocket handling and safety expectations.
- `packages/gateway/src/services/session-manager.ts` - local tmux session lifecycle pattern to preserve behind a local transport.
- `packages/gateway/src/lib/safe-path.ts` or current safe path utilities - local path boundary patterns to mirror remotely.
- `packages/gateway/src/lib/dependency-check.ts` - dependency/runtime discovery pattern for local host; remote discovery should map into the same user-facing concept.
- `packages/gateway/src/services/diagnostics.ts` - diagnostics redaction and local-only export pattern.
- `packages/gateway/src/routes/codex-app-server.ts` and related manager/client files - Codex app-server remains separate from tmux terminal sessions and `/turn` remains disabled by default.

### Tests And Evidence

- `docs/CI-CD-PLAN.md` - required future gate shape for tmux, browser terminal, Codex app-server, and release caveat recording.
- `packages/gateway/test/integration/tmux.test.ts` - local tmux integration precedent; future remote terminal gates need analogous mocked transport plus manual SSH smoke.
- `packages/gateway/test/codex-app-server*.test.ts` or existing Codex app-server smoke tests - preserve no-prompt/no-turn boundary.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- Gateway/Web split is already established; future remote APIs must be Gateway-owned and Web-consumed.
- The local terminal contract is xterm.js -> WebSocket -> Gateway -> node-pty -> tmux -> AI CLI. Remote design should introduce a target transport behind Gateway without changing browser message shapes.
- Existing diagnostics export already redacts sensitive values and reports local capability status; remote target diagnostics should follow that pattern with target-layer codes.
- Existing Codex app-server control-plane code is separate from terminal sessions and already keeps prompt/turn disabled from Web by default.
- The project already has strong local path safety rules; remote path safety should be equivalent but executed on the remote host.

### Established Patterns

- Business data is tenant-scoped by `user_id`.
- API input validation uses zod or equivalent schemas at boundaries.
- REST responses use OpenForge envelopes.
- Terminal history remains in tmux, not SQLite.
- Credentials are either host-managed or encrypted and never logged.
- Release evidence records caveats honestly when host capabilities are missing.

### Integration Points

- Future implementation will likely add `execution_targets` and credential metadata repositories, but Phase 5 should only specify them.
- Future project create/import should accept an explicit target id and validate remote path through the remote agent before storing a remote project.
- Future session create/start should resolve the project target and fail with `409` before tmux state when SSH, remote agent, remote tmux, or selected CLI is unavailable.
- Future terminal transport should split current local tmux behavior into `LocalTmuxTransport` and add `SshAgentTerminalTransport` behind the existing WebSocket contract.
- Future diagnostics should add remote target summaries and failure codes without uploading telemetry.

</code_context>

<specifics>
## Specific Ideas

- Update or supplement `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` instead of inventing a second competing remote execution spec.
- Add a threat model table that explicitly covers host key spoofing, SSH credential theft, path traversal, symlink escape, raw SSH command injection, remote agent protocol abuse, terminal input flooding, diagnostics leakage, stale target state, and rollback failure.
- Add a rollback plan that keeps local sessions working even when remote execution is disabled or migrations are present but unused.
- Make the first implementation plan future-facing and staged: target registry and connection test before any remote terminal launch.

</specifics>

<deferred>
## Deferred Ideas

- Hosted OpenForge cloud workers, billing, telemetry, hosted marketplace, and cloud deployment.
- Remote terminal session implementation in this Phase 5 planning step; implementation belongs in later phases after architecture verification.
- Codex app-server remote control plane and any Web prompt/turn UI.
- Private key import unless the implementation plan includes encryption, deletion, passphrase, and security-review coverage.
- Automatic local-to-remote file synchronization and path mapping.
- Autonomous remote development loops or raw shell execution APIs.

</deferred>

---

*Phase: 5-Remote Execution Architecture*
*Context gathered: 2026-05-20T17:05:00Z*
