# Phase 5: Remote Execution Architecture - Discussion Log

**Date:** 2026-05-20T17:05:00Z
**Phase:** 5-Remote Execution Architecture
**Mode:** Auto-selected recommended defaults per user instruction to continue without waiting.
**Decision Source:** `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/DECISIONS-INDEX.md`, prior Phase 3/4 contexts, and `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md`.

## Areas Discussed

- Scope and product boundary
- Remote execution shape
- Remote agent and terminal authority
- Credentials, host keys, and path safety
- Codex app-server boundary
- Failure taxonomy, diagnostics, and rollback

## Decision Matrix

| Area | Selected Direction | Rejected Alternatives | Rationale |
| --- | --- | --- | --- |
| Scope | Design-only architecture package for Phase 5 | Implement remote runtime now; fold remote into beta gates | Remote execution is explicitly a separate product/security milestone. Planning first reduces security drift before runtime work. |
| Product Positioning | Local-first AI CLI control plane with explicit user-owned remote targets | Hosted autonomous platform; cloud worker product; billing/telemetry milestone | Current wedge is trusted local control. Remote should extend where the user's CLI runs, not change OpenForge into a hosted service. |
| Remote Shape | SSH execution target plus remote agent over SSH stdio | Raw `ssh host "tmux ..."` wrappers; full remote OpenForge instance as first product | A typed remote agent keeps validation, lifecycle, and failure boundaries explicit while preserving the Gateway/Web split. |
| Browser Contract | Web talks only to Gateway HTTP/WebSocket; terminal WebSocket messages stay unchanged | Direct browser-to-SSH; separate browser remote-terminal protocol | The existing terminal security model and UI contract remain valid. Target-aware transport belongs behind Gateway. |
| Target Binding | Explicit execution target per project; sessions inherit the project target | Implicit remote launch; automatic local/remote path sync; target chosen per attach | Session history should remain tied to the host that executed it. Explicit binding avoids confusing audit and rollback semantics. |
| Credentials | Prefer OS `ssh-agent` or user-selected key path for first implementation | Plaintext SSH passwords; private key import first; copying local provider keys to remote host | The first release should avoid creating a new credential vault problem before encryption, passphrase, and deletion semantics are reviewed. |
| Host Keys | Fail-closed host key pinning after explicit first-use approval or preconfiguration | `StrictHostKeyChecking=no`; silent host-key replacement | Remote execution must not normalize man-in-the-middle risk as convenience behavior. |
| Path Safety | Remote `safeResolve`/realpath against explicit allowed roots on the remote host | Trusting frontend paths; trusting a single project path; local-only path validation | Symlink and traversal rules must execute where the filesystem actually exists. |
| Terminal Authority | Existing authenticated terminal WebSocket/attach-token path remains the only terminal input authority | Copilot/Feishu/direct project-manager remote terminal control | Remote execution must not expand automation authority without a separate approval and safety design. |
| Codex Boundary | Keep Codex app-server `/turn` disabled and out of first remote architecture | Remote Codex app-server control plane; Web prompt/turn UI | `COD-01` requires transcript retention, consent, rate-limit, and security review before exposure. |
| Diagnostics | Stable layer-specific remote error codes plus redacted diagnostics | Raw SSH stderr, terminal transcripts, private paths, secrets, attach tokens in diagnostics | Remote issues need user-actionable errors without leaking sensitive host details. |
| Rollback | Additive local-safe rollout; remote launch can be disabled while local sessions continue | Migrations or defaults that make local sessions depend on remote tables | Remote must be reversible and must not weaken the proven local beta path. |

## User Choice

The user authorized continuing with recommended defaults without waiting for further confirmation. The selected defaults therefore favor the conservative architecture path: preserve local-first beta readiness, design the remote boundary before runtime implementation, and defer hosted/cloud/Codex-turn surfaces.

## Deferred Items

- Runtime implementation of execution target APIs, repositories, migrations, Web UI, and terminal transports.
- Hosted OpenForge cloud workers, collaboration, billing, telemetry, and hosted marketplace.
- Codex app-server remote control plane and Web prompt/turn input.
- Private key import until encryption-at-rest, passphrase handling, deletion semantics, and audit coverage are specified.
- Automatic local-to-remote file synchronization or path mapping.
- Any raw shell command API or autonomous remote development loop.

## Planning Implications

- The plan should produce an architecture/spec supplement, threat model, rollback plan, and verification strategy.
- The plan should update or supplement `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` rather than creating a competing remote-execution design source.
- Future implementation should be staged: target registry and connection test, remote dependency/project discovery, remote terminal sessions, then hardening and release evidence.
- Verification should include source-of-truth drift checks and explicit evidence that local execution remains unaffected by the remote architecture package.

---

*Phase: 5-Remote Execution Architecture*
*Discussion captured: 2026-05-20T17:05:00Z*
