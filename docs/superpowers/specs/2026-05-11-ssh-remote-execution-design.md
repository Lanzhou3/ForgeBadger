# SSH Remote Execution Design

Date: 2026-05-11
Status: Confirmed; ready for implementation-plan breakdown
Scope: architecture review for future SSH-backed execution targets

## Roadmap Context

OpenForge is currently a local-first control plane. The accepted release shape
is one Gateway process, one Web console process, local SQLite state, and
tmux-backed terminal sessions on the host running the Gateway.

Existing release and MVP documents explicitly keep SSH/remote execution outside
the current beta release gates. This design is the architecture review required
before that scope can move into implementation. It does not change the current
`post-beta-release-gates` acceptance criteria, and it should be implemented in
a separate feature slice after the release-gate PR is stable.

## Phase 5 Architecture Package

Phase 5 is a docs-only architecture and security package. It does not implement
runtime routes, database migrations, Web UI, terminal transports, Codex
app-server runtime behavior, package manifests, or dependency lockfiles. The
package preserves OpenForge's local-first product position: today's Gateway,
Web console, local SQLite state, and tmux-backed sessions remain the protected
default path, while remote execution stays an explicit user-owned `ssh`
execution target extension.

Hosted collaboration, cloud deployment, billing, telemetry, hosted marketplace,
and cloud workers remain later-milestone scope and must not enter local-first
runtime paths from this phase. Existing beta caveats for live providers,
physical Windows/WSL smoke, and first-user feedback also remain separate
evidence topics.

Phase 5 artifacts:

- [Remote execution threat model](2026-05-21-remote-execution-threat-model.md)
- [Remote execution rollback plan](2026-05-21-remote-execution-rollback-plan.md)
- [Remote execution architecture verification report](../../reports/remote-execution-architecture-verification-2026-05-21.md)

The package keeps the execution target model explicit: `local` is the implicit
Gateway-host target, and `ssh` is a user-managed remote host. Projects bind to
one execution target at create/import time, and sessions copy the project target
at launch. Browser traffic still reaches only Gateway HTTP/WebSocket APIs; no
browser-to-SSH path is introduced. The terminal WebSocket message contract
remains unchanged behind a target-aware Gateway transport.

Remote execution continues to require an SSH remote agent over stdio. Raw
`ssh host "tmux ..."` wrappers, direct browser-to-SSH connections, generic
arbitrary shell APIs, SQLite terminal scrollback storage, and unapproved Codex
Web prompt/turn enablement remain rejected. The remote agent owns remote path
validation, dependency discovery, tmux lifecycle, and remote cleanup on the
remote host. Terminal input authority stays on the authenticated
WebSocket/session attach-token path.

## Goal

Add user-managed remote machines as explicit execution targets while preserving
OpenForge's Gateway/Web split, tmux persistence model, tenant isolation,
adapter discovery, and diagnostics story.

A user should eventually be able to:

1. Register an SSH-accessible remote host.
2. Verify host identity and connection health.
3. Discover remote dependencies such as `tmux`, `claude`, `opencode`, and
   `codex`.
4. Import a project path that lives on that remote host.
5. Launch and reattach browser terminal sessions backed by remote tmux.
6. Export diagnostics that identify whether a failure happened locally,
   over SSH, in the remote agent, or in the remote CLI.

## Non-Goals

- No hosted OpenForge cloud worker or multi-tenant cloud runtime.
- No autonomous remote execution beyond user-created sessions.
- No direct browser-to-SSH connection.
- No Next.js API routes for Gateway behavior.
- No terminal log persistence in SQLite.
- No raw shell command builder that interpolates user input into `ssh ...`.
- No Codex app-server remote control-plane support in the first remote
  execution release.
- No automatic project file synchronization between local and remote machines.

## Options Considered

### Recommended: SSH target plus remote agent boundary

The local Gateway stores target metadata, authenticates to SSH, and starts a
minimal OpenForge remote agent on the remote host over an SSH stdio channel.
The remote agent owns remote path validation, dependency discovery, tmux
session creation, terminal attach, resize, history capture, and stop behavior.

Pros:

- Preserves the existing browser terminal contract while introducing a clear
  execution target boundary.
- Keeps remote filesystem and tmux operations on the host where they are valid.
- Avoids command-injection-prone `ssh host "tmux ..."` string assembly.
- Allows typed request/response validation, audit metadata, and redaction.
- Leaves room for a later installed agent service without changing Web APIs.

Cons:

- Requires shipping, versioning, and testing a remote agent package.
- Needs a bootstrap story for users whose remote host does not yet have the
  agent installed.
- Adds transport failure modes that local-only sessions do not have.

### Alternative: SSH command wrapper

The Gateway could keep today's local launch path and prefix tmux commands with
`ssh host ...`.

Pros:

- Faster first prototype.
- No separate remote agent package.

Cons:

- Blurs the boundary between local validation and remote execution.
- Makes quoting, environment injection, and path validation fragile.
- Encourages shell string construction around user-controlled paths and args.
- Makes remote diagnostics and version compatibility difficult.

This option is rejected for product implementation.

### Alternative: full remote OpenForge instance

The user can run the full Gateway and Web stack on the remote machine and reach
it through SSH port forwarding or a private network.

Pros:

- Works today as an operational workaround.
- Keeps each OpenForge instance local-first relative to its own host.

Cons:

- Does not give one local console a unified view of local and remote targets.
- Leaves setup, auth, ports, and diagnostics as manual user work.

This remains a documented workaround, not the product architecture.

## Architecture

### Execution target domain

Introduce an explicit execution target concept:

- `local` target: the current Gateway host. It is implicit and always present.
- `ssh` target: a user-owned remote host reached through SSH.

Projects are bound to exactly one execution target at import/create time. A
remote project path is a path on that remote target, not a local path. Local
projects should not silently launch on a remote target unless a later path
mapping or sync design is approved.

Sessions inherit the project execution target. Runtime CLI selection remains a
session launch choice, but it is selected from the adapter discovery results for
the session's target.

### Gateway responsibilities

The Gateway remains the only API and WebSocket service that Web talks to.

Gateway owns:

- `/api/v1/execution-targets` CRUD and tenant filtering.
- SSH credential metadata and encrypted secret storage.
- Host key pinning and connection-test orchestration.
- Audit/activity rows for target CRUD, connection tests, dependency discovery,
  remote session launch, remote attach, remote stop, and remote failures.
- Local WebSocket authentication, single active terminal connection, message
  size limits, and input rate limits.
- Translation between Web terminal messages and the selected target transport.
- Redacted diagnostics export that includes target and transport status.

Gateway does not own:

- Remote path resolution through local filesystem APIs.
- Remote tmux lifecycle through shell string assembly.
- Remote CLI configuration writes unless the remote agent exposes a typed,
  validated operation for that exact purpose.

### Remote agent responsibilities

The remote agent is a small Node.js package that runs on the remote host. The
first implementation should use SSH stdio, not a listening remote port:

```text
Browser xterm.js
  -> Gateway WebSocket
  -> Gateway target transport
  -> SSH stdio channel
  -> openforge-remote-agent
  -> tmux attach/create/capture/stop
  -> AI CLI process
```

Remote agent owns:

- Protocol version handshake.
- Zod or equivalent schema validation for every request.
- Remote `safeResolve` and realpath checks against configured allowed roots.
- Dependency checks for `tmux`, `claude`, `opencode`, and `codex`.
- Adapter launch status for the remote host.
- tmux session naming, creation, attach, resize, capture, stop, and orphan
  cleanup for OpenForge-managed remote sessions.
- Secret redaction in logs and response details.

The remote agent must not expose a generic "run arbitrary shell command" API.
Its operation list should be explicit, typed, and covered by tests.

### Data model direction

Initial tables should be additive:

- `execution_targets`
  - `id`
  - `user_id`
  - `type`: `local` or `ssh`
  - `name`
  - `host`
  - `port`
  - `username`
  - `auth_method`
  - `known_host_fingerprint`
  - `allowed_roots_json`
  - `agent_version`
  - `last_status`
  - `last_checked_at`
  - timestamps

- `execution_target_credentials`
  - `id`
  - `user_id`
  - `target_id`
  - `kind`: `private_key`, `ssh_agent`, or future `password`
  - encrypted secret material only when the user imports key material
  - redacted display metadata
  - timestamps

- `projects`
  - add nullable `execution_target_id`, defaulting to the implicit local target
    for existing rows.

- `sessions`
  - add nullable `execution_target_id`, copied from the project at launch time
    so historical sessions remain tied to the target they actually used.

Repository classes must keep user-scoped filtering. Existing local rows should
continue to behave as local sessions without requiring migration-time remote
configuration.

### API surface

All APIs stay under `/api/v1` and use the existing response envelope.

Proposed first APIs:

- `GET /api/v1/execution-targets`
- `POST /api/v1/execution-targets`
- `GET /api/v1/execution-targets/:id`
- `PATCH /api/v1/execution-targets/:id`
- `DELETE /api/v1/execution-targets/:id`
- `POST /api/v1/execution-targets/:id/test`
- `GET /api/v1/execution-targets/:id/adapters/discovery`
- `GET /api/v1/execution-targets/:id/diagnostics`

Remote project import can extend the existing project import API with an
optional `executionTargetId`. Gateway validates target ownership, asks the
remote agent to resolve the path, and stores the project only after the remote
path check succeeds.

Session creation can keep today's `/api/v1/sessions` route. It resolves the
project target, checks adapter launch status for that target, and returns `409`
before creating tmux state when the target, SSH connection, remote agent, tmux,
or selected CLI is unavailable.

### Terminal transport

The WebSocket message contract should not change:

- Client input remains `terminal_input`.
- Client resize remains `terminal_resize`.
- Server output remains `terminal_output`.
- Server errors remain `terminal_error`.

Gateway should introduce a target-aware terminal transport interface:

- `LocalTmuxTransport`: today's node-pty attach path.
- `SshAgentTerminalTransport`: SSH stdio channel to the remote agent.

Both transports must preserve:

- one active WebSocket per session;
- reconnect without killing the tmux session;
- history restore from tmux capture;
- input rate limits;
- message size limits;
- terminal resize behavior;
- attach-token authorization and tenant ownership checks.

## Credential And Host-Key Policy

SSH support must fail closed.

Required rules:

- Never set `StrictHostKeyChecking=no`.
- Pin the server host key fingerprint on first successful explicit user
  approval or require the user to provide the expected fingerprint before the
  first connection.
- Treat host key mismatch as a hard error that requires user action.
- Prefer OS `ssh-agent` or a user-selected key path for the first release.
- If private key import is supported, encrypt it with the existing OpenForge
  master key service and never log key material or passphrases.
- Do not store plaintext passwords in the first release.
- Keep remote CLI account state on the remote host. For example, Codex
  subscription state is discovered remotely, not copied from the local host.

## Error Handling

Every remote failure should identify the failing layer:

- `target_not_found`
- `host_key_untrusted`
- `host_key_mismatch`
- `ssh_auth_failed`
- `ssh_unreachable`
- `remote_agent_missing`
- `remote_agent_version_unsupported`
- `remote_tmux_missing`
- `remote_cli_missing`
- `remote_path_denied`
- `remote_session_launch_failed`
- `remote_terminal_attach_failed`
- `remote_terminal_disconnected`

Web copy should show a short user-facing summary and a diagnostics-friendly
code. Diagnostics export should include the code, target id, target type,
remote agent version if known, terminal runtime status, adapter discovery
status, and redacted stderr snippets.

## Security Review Focus

Implementation must receive a dedicated security review before exposing remote
session launch.

Review areas:

- Host key verification and mismatch handling.
- Credential encryption, redaction, and deletion.
- Tenant filtering for target and credential repositories.
- Remote path traversal and symlink escape prevention.
- SSH command construction: no user-controlled shell string interpolation.
- Remote agent protocol schema validation.
- Terminal input rate and message size behavior over SSH.
- Audit coverage for remote target changes and launches.
- Diagnostics redaction for hostnames, usernames, paths, tokens, keys, and
  bearer values.

## Phased Delivery

### Phase 0: design and ADR

Deliver this design and convert it into an implementation plan only after
review. No runtime code changes are required in this phase.

### Phase 1: target registry and connection test

Implement execution target CRUD, encrypted credential metadata, host key
pinning, connection test, audit logs, diagnostics, and Settings UI. This phase
does not launch remote sessions.

Acceptance:

- Users can register a remote target.
- Users can test SSH connectivity and host key state.
- Diagnostics export redacts credentials and summarizes target status.
- Unit tests cover validation, tenant filtering, redaction, and host key
  mismatch handling.

### Phase 2: remote dependency and project discovery

Ship the remote agent bootstrap path and remote dependency discovery. Extend
project import to bind a project to an execution target after remote path
validation.

Acceptance:

- Users can see remote `tmux` and AI CLI availability.
- Remote project import rejects denied, missing, or unsafe paths.
- Local projects remain local unless explicitly imported as remote projects.
- Tests cover remote path validation and adapter discovery mapping.

### Phase 3: remote terminal sessions

Add target-aware terminal transports and launch remote tmux-backed terminal
sessions through the remote agent.

Acceptance:

- Browser terminal I/O works through the unchanged WebSocket contract.
- Browser refresh reattaches to the remote tmux session.
- Gateway restart does not kill remote tmux.
- Stopping a session stops the remote OpenForge tmux session.
- Manual smoke covers Linux remote host and WSL remote host.

### Phase 4: hardening and release gate

Add SSH/remote smoke reports, security review evidence, troubleshooting docs,
and Windows/WSL notes for remote targets.

Acceptance:

- Dedicated security review has no unresolved high-severity issues.
- Trial docs explain local vs remote target setup.
- Release notes clearly mark SSH remote as beta or supported based on evidence.

## Testing Strategy

Automated tests:

- Repository tests for target and credential tenant filtering.
- Route tests for API envelope, validation, and status codes.
- Unit tests for host key policy and redaction.
- Remote agent protocol parser tests for malformed frames and unknown methods.
- Path safety tests for traversal, symlink escape, and denied roots.
- Terminal transport tests with a mocked SSH channel.
- Adapter discovery tests for remote missing `tmux`, missing CLI, and agent
  version mismatch.

Manual smoke:

- Local Gateway to Linux remote host.
- Local Gateway to WSL target if supported by the user's environment.
- Browser terminal create, resize, input, refresh reattach, Gateway restart,
  stop, and orphan cleanup.
- Diagnostics export after a healthy run and after each expected failure class.

## Open Questions For Review

1. Should the first release require OS `ssh-agent`/key path only, or should it
   also support encrypted private key import?
2. Should the remote agent be installed as part of `openforge doctor --remote`,
   or should users install it manually on each remote host?
3. Should remote projects require explicit allowed roots per target from day
   one, or should the first release allow a single project path after user
   confirmation?
4. Should WSL be treated as a remote SSH target for smoke coverage, or as a
   separate local-runtime remediation path?

## Decision

Proceed with SSH remote execution only through an explicit execution target and
remote agent boundary. Do not implement remote session launch by wrapping the
existing local tmux commands in raw `ssh` command strings.
