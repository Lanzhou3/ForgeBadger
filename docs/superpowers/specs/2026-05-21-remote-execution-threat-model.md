# Remote Execution Threat Model

Date: 2026-05-21
Status: Phase 5 architecture package
Scope: SSH-backed execution targets before runtime implementation

## Context

OpenForge remains a local-first AI CLI control plane. Remote execution is a
future user-owned target extension that must preserve the current Gateway/Web
split, tenant isolation, tmux persistence, diagnostics redaction, and Codex
app-server disabled-turn boundary.

This document supports REM-01, REM-02, and COD-01. It is design evidence only.
It does not add Gateway routes, Web UI, migrations, terminal transports,
package manifests, lockfiles, cloud deployment, billing, telemetry, hosted
marketplace operations, or Codex Web prompt/turn controls.

## System Model

```text
Browser xterm.js
  -> Gateway HTTP/WebSocket auth and tenant checks
  -> project execution target lookup
    -> local target
      -> LocalTmuxTransport
      -> node-pty
      -> local tmux
      -> local AI CLI
    -> ssh target
      -> SSH connection with pinned host key
      -> remote agent over SSH stdio
      -> typed remote-agent operation
      -> remote safeResolve/realpath against allowed roots
      -> remote tmux
      -> remote AI CLI account state
```

The browser never connects directly to SSH. Gateway remains the only HTTP and
WebSocket service. Remote filesystem, dependency, tmux, and cleanup authority
belongs to the remote agent because those checks must run on the host where the
filesystem and sessions exist.

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser to Gateway HTTP/WebSocket | Authenticated but untrusted REST bodies, route params, WebSocket messages, and terminal input enter Gateway. |
| Gateway to target metadata repositories | Target, credential, project, and session state must remain tenant-scoped by `user_id`. |
| Gateway to SSH target | Gateway crosses from local control plane into a user-owned remote host and must fail closed on host identity, reachability, and auth errors. |
| Gateway to remote agent stdio | Structured protocol messages cross a process and host boundary; every frame must be versioned, schema-validated, and method-allowlisted. |
| Remote agent to remote filesystem/tmux/CLI | Remote path, dependency, tmux, and CLI operations execute where symlink and account state actually exist. |
| Diagnostics/reporting to user or support | Operational evidence may be shared and must not expose secrets, raw SSH stderr, terminal transcripts, attach tokens, bearer tokens, or sensitive full paths. |
| Web/Codex app-server control plane to `/turn` | Codex Web prompt/turn input remains disabled until retention, consent, rate limiting, model usage, and security review are designed. |

## Assets

| Asset | Protection Goal |
|-------|-----------------|
| SSH host identity | Prevent spoofed or changed remote hosts from receiving OpenForge sessions. |
| SSH credentials and agent access | Prevent key, passphrase, password, and agent misuse or disclosure. |
| Target, project, and session ownership | Prevent cross-tenant target selection, launch, diagnostics, or terminal attach. |
| Remote project paths | Prevent traversal, encoded traversal, and symlink escape outside allowed roots. |
| Terminal input and output | Preserve authenticated user authority, rate limits, message-size limits, and tmux-only persistence. |
| Remote CLI account state | Keep Claude, OpenCode, and Codex account state on the remote host; do not copy local provider keys to remote targets. |
| Diagnostics evidence | Provide stable failure codes and bounded status without leaking credentials or transcripts. |
| Codex app-server turn boundary | Prevent accidental Web prompt/turn exposure, transcript retention gaps, and model cost surprises. |
| Local-first runtime | Preserve local projects, local sessions, local tmux recovery, and local diagnostics when remote execution is disabled. |

## STRIDE Threat Register

| Threat ID | Asset | Trust Boundary | STRIDE | Abuse Case | Required Control | Stable Failure Code | Release Blocker |
|-----------|-------|----------------|--------|------------|------------------|---------------------|-----------------|
| REM-T01 | SSH host identity | Gateway to SSH target | Spoofing | DNS, IP reuse, or malicious network path presents a different host key. | Fail closed; never use `StrictHostKeyChecking=no`; never use `UserKnownHostsFile=/dev/null`; pin the expected host key after explicit approval or require preconfigured fingerprint; host key mismatch requires user action. | `host_key_untrusted`, `host_key_mismatch` | Yes, if mismatch can be bypassed or downgraded. |
| REM-T02 | SSH credentials and agent access | Gateway to SSH target | Information Disclosure / Elevation of Privilege | Private key, passphrase, plaintext password, or agent socket leaks through config, logs, diagnostics, or copied remote setup. | Prefer OS `ssh-agent` or selected key path; no plaintext SSH passwords; defer private key import unless encryption-at-rest, passphrase handling, deletion semantics, and security review are designed; never copy local provider API keys to remote targets. | `ssh_auth_failed` | Yes, if secret material can be logged or persisted plaintext. |
| REM-T03 | Remote launch command integrity | Gateway to remote agent stdio | Tampering / Elevation of Privilege | User-controlled path or CLI args are interpolated into raw `ssh host "tmux ..."` wrappers or a generic shell API. | Reject raw `ssh host "tmux ..."` wrappers, direct shell strings, and any generic shell API; use typed remote-agent operations with validated parameters. | `remote_session_launch_failed` | Yes, if arbitrary shell execution is available through the target API. |
| REM-T04 | Remote agent protocol | Gateway to remote agent stdio | Tampering / Denial of Service | Malformed frame, unknown method, version mismatch, oversized payload, or replayed request abuses the stdio protocol. | Require version handshake, schema validation, method allowlist, message-size handling, unknown-method rejection, contextual error codes, and no generic command method. | `remote_agent_missing`, `remote_agent_version_unsupported` | Yes, for unresolved high-severity protocol abuse. |
| REM-T05 | Remote project paths | Remote agent to remote filesystem/tmux/CLI | Tampering / Information Disclosure | Path traversal, encoded traversal, or symlink escape reaches outside the configured remote allowed roots. | Require explicit allowed roots per SSH target; run remote `safeResolve`/realpath checks on the remote host; allow symlinks only when resolved path stays inside allowed roots. | `remote_path_denied` | Yes, if a remote path can escape allowed roots. |
| REM-T06 | Terminal input authority | Browser to Gateway HTTP/WebSocket | Tampering / Denial of Service | Unauthorized client, duplicate socket, oversized message, or high-rate input floods a remote terminal. | Preserve JWT/session ownership, attach-token authorization, one active WebSocket per session, heartbeat, message-size limit, and terminal input rate limits before forwarding to the target transport. | `remote_terminal_attach_failed` | Yes, if terminal input can bypass authenticated attach-token authority. |
| REM-T07 | Tenant target/session binding | Gateway to target metadata repositories | Elevation of Privilege / Information Disclosure | A user launches, attaches, tests, or exports diagnostics for another tenant's target or project. | Target, credential, project, session, audit, and diagnostics repositories must filter by `user_id`; projects bind to one target; sessions copy target at launch; cross-tenant ids return not found. | `target_not_found`, `remote_session_launch_failed` | Yes, if cross-tenant target use is possible. |
| REM-T08 | Diagnostics evidence | Diagnostics/reporting to user or support | Information Disclosure | Export includes private keys, passphrases, raw SSH stderr, bearer tokens, attach tokens, terminal transcripts, full sensitive paths, or raw remote command output. | Diagnostics may include target id/type, host-key state, agent version, dependency status, adapter status, stable code, and redacted summary only. Terminal scrollback in SQLite remains rejected. | all D-23 codes as bounded values | Yes, if diagnostics leak sensitive data. |
| REM-T09 | Codex `/turn` boundary | Web/Codex app-server control plane to `/turn` | Information Disclosure / Repudiation / Denial of Wallet | Web exposes prompt input, send prompt action, `promptInputExposed: true`, or `/turn` requests without transcript retention, consent, rate limiting, model usage, and security review. | Keep Codex /turn disabled and Codex Web prompt/turn enablement rejected until a separate reviewed design exists; remote Codex app-server control-plane support is excluded from the first remote package. | n/a, existing `/turn` remains disabled | Yes, if Web can send prompt/turn input. |
| REM-T10 | Rollback and local recovery | Local-first runtime and future remote metadata | Denial of Service | Remote launch failure, bad migration, disabled feature flag, or rollback procedure breaks existing local projects, local sessions, or tmux recovery. | Future target metadata must be additive, nullable, and default-local; remote launch can be disabled; older local-only runtime can ignore remote target records; do not delete local tmux sessions during rollback unless proven orphaned remote sessions. | `ssh_unreachable`, `remote_tmux_missing`, `remote_cli_missing`, `remote_terminal_attach_failed` | Yes, if rollback can break local recovery. |

## Required Controls

- Host key verification fails closed. `StrictHostKeyChecking=no` and
  `UserKnownHostsFile=/dev/null` are rejected in runtime code, docs intended as
  commands, and troubleshooting snippets.
- SSH target connection tests return stable layer-specific codes:
  `host_key_untrusted`, `host_key_mismatch`, `ssh_auth_failed`,
  `ssh_unreachable`, `remote_agent_missing`,
  `remote_agent_version_unsupported`, `remote_tmux_missing`,
  `remote_cli_missing`, `remote_path_denied`,
  `remote_session_launch_failed`, and `remote_terminal_attach_failed`.
- First implementation planning uses `ssh-agent` or selected key path before
  any private-key import. Plaintext SSH passwords are out of scope.
- Remote CLI account state remains on the remote host. Local provider API keys,
  Codex subscription state, Claude login state, and OpenCode auth are not copied
  to remote targets.
- Every remote-agent operation is typed, schema-validated, and method
  allowlisted. Generic arbitrary shell execution and a generic shell API are
  rejected.
- Remote path validation runs on the remote host with realpath semantics
  against explicit target allowed roots.
- Terminal WebSocket messages remain unchanged. Gateway owns auth, ownership,
  attach-token checks, single-active-socket replacement, input rate limits,
  message size limits, and heartbeat.
- SQLite may store structured target/session metadata only. Terminal scrollback
  in SQLite, raw transcripts, raw SSH stderr, and remote command output are
  rejected.
- Diagnostics are bounded and redacted. They exclude private keys,
  passphrases, raw SSH stderr, bearer tokens, attach tokens, terminal
  transcripts, and full sensitive paths.
- Codex /turn and Codex Web prompt/turn enablement stay disabled until
  transcript retention, consent, rate limiting, model usage, and security review
  are designed.

## Verification Map

| Requirement | Threats | Required Evidence |
|-------------|---------|-------------------|
| REM-01 | REM-T01 through REM-T10 | Architecture addendum, this threat model, rollback plan, static runtime-scope scan, no-runtime-code evidence, and future implementation security review. |
| REM-02 | REM-T08, REM-T10 | Hosted/cloud/billing/telemetry/marketplace scan classifies matches as deferred/boundary text or scope leak. |
| COD-01 | REM-T09 | Codex boundary scan and focused Codex app-server tests prove `/turn` remains disabled and Web exposes no prompt/send controls. |
| D-14 and D-15 | REM-T01 | Static scan rejects `StrictHostKeyChecking=no` and `UserKnownHostsFile=/dev/null` in runtime paths. |
| D-19 and D-20 | REM-T05 | Future remote path tests must cover traversal, encoded traversal, and symlink escape against remote allowed roots. |
| D-24 | REM-T08 | Diagnostics tests and report review prove redaction of keys, tokens, raw SSH stderr, attach tokens, transcripts, and sensitive paths. |
| D-25 | REM-T10 | Rollback plan proves remote disablement preserves local projects, sessions, tmux recovery, and local diagnostics. |

## Release Blockers

- Any unresolved high-severity REM-T01 through REM-T10 issue is a release
  blocker for remote execution implementation.
- Any design or code path that permits `StrictHostKeyChecking=no`,
  `UserKnownHostsFile=/dev/null`, raw `ssh host "tmux ..."` wrappers, direct
  browser-to-SSH, generic shell API, terminal scrollback in SQLite, or Codex Web
  prompt/turn enablement is a release blocker.
- Any remote target implementation that lacks tenant-scoped repository
  filtering, remote allowed roots, remote realpath checks, host-key mismatch
  hard errors, or diagnostics redaction is a release blocker.
- Any claim that WSL SSH smoke replaces physical Windows/WSL local terminal
  caveat evidence is a release blocker for caveat removal.

## Out Of Scope

- Runtime remote routes, database migrations, Web UI, terminal transports,
  remote agent package implementation, package manifests, and lockfiles.
- Hosted collaboration, cloud deployment, billing, telemetry, hosted
  marketplace, and cloud workers.
- Raw shell command APIs, direct browser-to-SSH, automatic local-to-remote file
  synchronization, and autonomous remote development loops.
- Private key import until encryption, passphrase handling, deletion semantics,
  and security review are designed.
- Remote Codex app-server control-plane support and Codex Web prompt/turn UI.
