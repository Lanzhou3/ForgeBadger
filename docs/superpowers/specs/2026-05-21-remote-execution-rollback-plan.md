# Remote Execution Rollback Plan

Date: 2026-05-21
Status: Phase 5 architecture package
Scope: local-safe rollback rules for future SSH-backed execution targets

## Purpose

Define rollback and disablement rules before remote execution implementation.
Remote execution must be additive to the local-first OpenForge runtime. A bad
SSH target release, disabled remote feature flag, failed migration, or
environment outage must not break existing local projects, local sessions,
tmux-backed recovery, diagnostics export, or the Codex app-server disabled-turn
boundary.

This plan is docs-only. It does not implement remote launch, migrations, routes,
Web UI, terminal transports, cloud deployment, billing, telemetry, or
marketplace scope.

## Local-Safe Invariants

- Existing local projects and sessions continue as `local`.
- Browser terminal WebSocket messages stay unchanged:
  `terminal_input`, `terminal_output`, `terminal_resize`, `terminal_exit`, and
  `terminal_error`.
- Gateway remains the only HTTP/WebSocket service the browser talks to.
- tmux remains the persistence layer for terminal sessions.
- SQLite does not store terminal scrollback, raw transcripts, raw SSH stderr, or
  remote command output.
- Disabling remote launch does not break local session recovery, local
  diagnostics, local project import/create, or local adapter discovery.
- Terminal input authority remains the authenticated WebSocket/session
  attach-token path.
- Codex /turn remains disabled unless transcript retention, user-facing consent,
  rate limiting, model usage, and security review are designed.

## Remote Feature Disablement

Future implementation must include an operator-safe remote execution kill
switch, shaped like:

```text
OPENFORGE_REMOTE_EXECUTION_ENABLED=false
```

When disabled:

1. Target CRUD may remain readable for diagnostics and cleanup, but target
   connection tests, remote dependency discovery, remote project import, remote
   session launch, and remote terminal attach must refuse before creating tmux
   state.
2. Refusals return stable remote-disabled status plus bounded failure context.
   They must not include private keys, passphrases, raw SSH stderr, bearer
   tokens, attach tokens, terminal transcripts, or full sensitive paths.
3. Local projects and local sessions keep running through the existing local
   tmux path.
4. Diagnostics may show target id/type, feature-disabled state, host-key state
   if already known, agent version if already known, dependency status if
   already known, and redacted summaries only.
5. The Web UI must not silently reclassify local projects as remote or retry
   remote launches in a loop.

## Future Nullable/Default-Local Migration Rules

Future data-model changes must be additive, nullable, and default-local:

- Execution target metadata is additive.
- Existing projects default to `local`.
- Existing sessions default to `local`.
- Projects bind to one execution target at create/import time.
- Sessions copy the project target at launch so historical sessions stay tied
  to the host that actually ran them.
- Future migrations must document that remote target records can be ignored by
  an older local-only runtime without
  breaking local recovery.
- Deleting or disabling a remote target must not mutate historical local
  sessions.
- Remote credential metadata must be tenant-scoped and independently
  redaction-safe.
- No migration may require a live SSH target, remote agent, or remote tmux to
  boot the local Gateway.

## Failure Scenarios

Scenario labels use these exact operator tokens: SSH auth failure,
unreachable host, missing/unsupported remote agent, missing remote tmux/CLI,
denied remote path, terminal attach failure, diagnostics oversharing risk,
rollback failure, and Codex /turn boundary drift.

| Scenario | Expected Behavior | Stable Code Or Boundary |
|----------|-------------------|-------------------------|
| Host key mismatch after prior trust | Refuse remote connection/test/launch and require user action. Existing local sessions continue. | `host_key_mismatch` |
| SSH auth failure | Refuse before remote tmux state is created; diagnostics show bounded auth failure only. | `ssh_auth_failed` |
| Unreachable host | Refuse before launch; local projects and sessions continue. | `ssh_unreachable` |
| Missing/unsupported remote agent | Refuse remote import/launch before tmux state; surface agent install/version next action. | `remote_agent_missing`, `remote_agent_version_unsupported` |
| Missing remote tmux/CLI | Refuse before session launch; do not create local fallback state for a remote project. | `remote_tmux_missing`, `remote_cli_missing` |
| Denied remote path | Refuse import/launch based on remote realpath against allowed roots. | `remote_path_denied` |
| Terminal attach failure | Keep session metadata consistent and avoid duplicate orphaned remote attach loops. | `remote_terminal_attach_failed` |
| Diagnostics oversharing risk | Disable or redact remote diagnostics fields rather than exposing raw details. | D-24 redaction boundary |
| Rollback failure | Preserve local tmux sessions and local database recovery first; mark remote targets disabled until inspected. | D-25 local-safe invariant |
| Codex /turn boundary drift | Keep Codex /turn remains disabled and remove Web prompt/send controls until separate security design is approved. | COD-01 |

## Operator Rollback Procedure

1. Set `OPENFORGE_REMOTE_EXECUTION_ENABLED=false` in the Gateway environment.
2. Restart Gateway, then verify local dashboard, local project list, local
   sessions, diagnostics export, and local terminal attach.
3. Confirm remote connection tests, remote project import, remote session
   launch, and remote terminal attach refuse with remote-disabled status before
   tmux state is created.
4. Inspect recent audit/activity rows for remote target operations and record
   affected target ids, redacted failure codes, and next actions.
5. Restore the previous release commit or build artifact if code rollback is
   required.
6. Restore the previous `.env` only if secret or port configuration changed.
7. Restore the backed-up SQLite database only if a future incompatible remote
   migration wrote state that the current runtime cannot safely ignore.
8. Start Gateway, then Web.
9. Verify existing local sessions with `tmux list-sessions` and browser
   reattach.
10. Inspect OpenForge-managed remote session names only after confirming they
    belong to the failed remote rollout.

Do not delete local tmux sessions during rollback unless they are confirmed orphaned OpenForge-managed remote sessions.

## Data Retention And Redaction

- Do not store plaintext SSH passwords.
- Prefer `ssh-agent` or selected key path for the first remote release.
- Do not implement private key import unless encryption-at-rest, passphrase
  handling, deletion semantics, and security review are designed.
- Do not copy local provider API keys to remote targets.
- Remote CLI account state stays on the remote host.
- Diagnostics exclude private keys, passphrases, raw SSH stderr, bearer tokens,
  attach tokens, terminal transcripts, and full sensitive paths.
- SQLite stores target/session metadata only, not terminal scrollback, raw
  transcripts, raw SSH stderr, or remote command output.
- Rollback notes may include stable failure codes and bounded target ids, but
  not usernames, hostnames, full remote paths, or credential previews when the
  redaction policy says to hide them.

## Verification Checklist

- `OPENFORGE_REMOTE_EXECUTION_ENABLED=false` blocks future remote test, import,
  launch, and attach paths before tmux state is created.
- Local project create/import still works as `local`.
- Existing local sessions reattach through the unchanged WebSocket contract.
- Diagnostics export shows remote-disabled status without raw SSH stderr or
  secrets.
- Remote target records can be ignored by a local-only runtime.
- Future migrations are nullable and default-local.
- Codex /turn remains disabled and Web exposes no Codex Web prompt/turn UI.
- No package manifests or lockfiles are required for rollback.
- No local tmux sessions are deleted unless confirmed orphaned
  OpenForge-managed remote sessions.

## Non-Goals

- hosted cloud workers
- cloud deployment
- billing
- telemetry
- marketplace
- raw shell command APIs
- browser-to-SSH
- automatic local-to-remote file synchronization
- autonomous remote development loops
- remote Codex app-server control-plane support
- Codex Web prompt/turn UI
