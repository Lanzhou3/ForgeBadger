# Phase 05: Remote Execution Architecture - Research

**Researched:** 2026-05-21
**Domain:** SSH remote execution design, threat modeling, rollback, and Codex turn boundary
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

The following section is copied from `.planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md`. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- Hosted OpenForge cloud workers, billing, telemetry, hosted marketplace, and cloud deployment.
- Remote terminal session implementation in this Phase 5 planning step; implementation belongs in later phases after architecture verification.
- Codex app-server remote control plane and any Web prompt/turn UI.
- Private key import unless the implementation plan includes encryption, deletion, passphrase, and security-review coverage.
- Automatic local-to-remote file synchronization and path mapping.
- Autonomous remote development loops or raw shell execution APIs.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REM-01 | SSH/remote execution has its own architecture review, threat model, and implementation phase. | Plan one docs-only architecture package: update the SSH design seed, create a dedicated threat model, create rollback/evidence gates, and explicitly defer runtime implementation. [CITED: .planning/REQUIREMENTS.md] [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] |
| REM-02 | Hosted collaboration, cloud deployment, billing, telemetry, and marketplace operations are handled in later milestones. | Add static verification that Phase 5 docs do not add hosted/cloud/billing/telemetry implementation commitments or code paths. [CITED: .planning/REQUIREMENTS.md] [CITED: docs/CI-CD-PLAN.md] |
| COD-01 | Codex app-server Web prompt/turn input requires explicit transcript retention controls, security review, and user-facing consent before exposure. | Preserve current `/turn` disabled-by-default contract and require any future enablement to design retention, consent, rate limit, and security controls first. [CITED: docs/API.md] [CITED: packages/gateway/src/routes/codex-app-server.ts] |
</phase_requirements>

## Summary

Phase 05 should be planned as a single docs/spec/security plan, not a runtime implementation plan. The planner should require exactly the artifacts future implementers need before touching Gateway routes, Web UI, migrations, or terminal transports: a Phase 5 addendum to the existing SSH design seed, a threat model, a rollback plan, and a verification/evidence report. [CITED: .planning/ROADMAP.md] [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]

The remote architecture should keep today's local-first control plane intact: Browser still talks only to Gateway, REST stays under `/api/v1`, terminal WebSocket message shapes stay unchanged, tmux remains the persistence layer, and remote execution is modeled as a target-aware transport behind Gateway. [CITED: docs/API.md] [CITED: docs/TECH-ARCHITECTURE.md] [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md]

**Primary recommendation:** Use plan `05-01` to update `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md`, create `docs/superpowers/specs/2026-05-21-remote-execution-threat-model.md`, create `docs/superpowers/specs/2026-05-21-remote-execution-rollback-plan.md`, and create `docs/reports/remote-execution-architecture-verification-2026-05-21.md`; do not edit runtime code. [ASSUMED]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Execution target registry | API / Backend | Database / Storage | Gateway owns REST, tenant filtering, validation, audit, and future target metadata; SQLite should only store structured metadata, not terminal scrollback. [CITED: AGENTS.md] [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] |
| SSH host-key pinning | API / Backend | OS / SSH client | Gateway should orchestrate connection tests and persist approved fingerprints, while the SSH client/agent performs SSH protocol authentication. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] [CITED: https://man.openbsd.org/ssh_config] |
| Remote path safety | Remote Agent | API / Backend | Path validation must run on the host where the filesystem and symlinks exist; Gateway verifies target ownership and stores only approved metadata. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] [CITED: packages/gateway/src/lib/safe-resolve.ts] |
| Remote dependency discovery | Remote Agent | API / Backend | Remote availability of `tmux`, `claude`, `opencode`, and `codex` must be discovered on the remote target, then summarized through Gateway diagnostics. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] [CITED: packages/gateway/src/lib/dependency-check.ts] |
| Terminal I/O | API / Backend | Remote Agent | Browser terminal messages remain Gateway WebSocket messages; Gateway selects local tmux or remote-agent transport behind the same contract. [CITED: docs/API.md] [CITED: packages/gateway/src/websocket/terminal.ts] |
| Diagnostics and evidence | API / Backend | Docs / Reports | Current diagnostics are authenticated, tenant-scoped, local-only, redacted, and no-telemetry; remote diagnostics should extend that pattern with safe target summaries. [CITED: docs/API.md] [CITED: packages/gateway/src/services/diagnostics.ts] |
| Codex app-server `/turn` | API / Backend | Web / Client | Gateway owns `/turn` enablement; Web must not expose prompt/send controls unless capability, consent, retention, and security controls are designed. [CITED: docs/API.md] [CITED: packages/web/e2e/codex-app-server.spec.ts] |

## Project Constraints (from AGENTS.md)

- Preserve Gateway/Web separation; Next.js must not own Gateway API behavior. [CITED: AGENTS.md]
- REST APIs stay under `/api/v1` and use the OpenForge envelope `{ code, data, message }` or `{ code, message, details }`. [CITED: AGENTS.md] [CITED: docs/API.md]
- Terminal architecture remains Browser xterm.js -> WebSocket -> Gateway -> node-pty -> tmux attach -> AI CLI for local sessions. [CITED: AGENTS.md] [CITED: CLAUDE.md]
- `tmux` remains the persistence layer; Gateway/WebSocket disconnects must not kill CLI sessions. [CITED: AGENTS.md] [CITED: CLAUDE.md]
- Terminal history must not be stored in SQLite; recovery uses `tmux capture-pane -e -S -500`. [CITED: AGENTS.md] [CITED: packages/gateway/src/services/tmux.ts]
- Environment variables must be injected with `tmux new-session -e KEY=value`, not shell wrappers. [CITED: AGENTS.md] [CITED: packages/gateway/src/services/tmux.ts]
- One active WebSocket is allowed per terminal session; a new connection replaces the previous one. [CITED: AGENTS.md] [CITED: packages/gateway/src/websocket/terminal.ts]
- On startup, OpenForge-managed orphan tmux sessions are scanned and killed if absent from the database. [CITED: AGENTS.md] [CITED: packages/gateway/src/services/session-manager.ts]
- Input validation is mandatory at API, HTML, shell, path, and WebSocket boundaries. [CITED: AGENTS.md] [CITED: .claude/rules/security.md]
- File paths must use `safeResolve` and symlink realpath checks; sensitive roots such as `/etc`, `/proc`, `/sys`, and `/root` are denied. [CITED: AGENTS.md] [CITED: packages/gateway/src/lib/safe-resolve.ts]
- Hardcoded secrets, plaintext credential logs, SQL concatenation, shell command concatenation, skipped tenant filtering, and skipped validation are red lines. [CITED: AGENTS.md] [CITED: .claude/rules/security.md]
- Backend functions should stay focused, prefer early returns, and keep API/service/repository ownership separated. [CITED: AGENTS.md] [CITED: .claude/rules/backend.md]
- Tests should cover error and boundary paths; terminal/WebSocket coverage should include auth, reconnect, ordering, limits, and isolation. [CITED: AGENTS.md] [CITED: .claude/rules/testing.md]

## Standard Stack

### Core

| Standard / Existing Component | Version | Purpose | Why Standard |
|-------------------------------|---------|---------|--------------|
| OpenForge docs/spec package | Current repo docs | Phase 5 deliverable surface | The roadmap expects one plan that produces architecture, threat model, rollback, and verification artifacts before implementation. [CITED: .planning/ROADMAP.md] |
| Existing SSH remote design seed | 2026-05-11 | Primary architecture seed | It already locks explicit execution targets, remote agent over SSH stdio, unchanged browser terminal contract, failure taxonomy, and phased delivery. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] |
| OWASP Threat Modeling Cheat Sheet | Current web page checked 2026-05-21 | Threat model process | OWASP frames threat modeling around system modeling, threat identification/ranking, mitigations, and review/validation, matching Phase 5 needs. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html] |
| OWASP ASVS | 5.0.0, May 2025 | Verification control taxonomy | OWASP identifies ASVS as an open application security standard for modern web applications and services, with latest stable 5.0.0. [CITED: https://github.com/OWASP/ASVS] |
| OpenSSH client configuration model | OpenSSH_9.6p1 installed locally; OpenBSD manual current 2026-03-23 | SSH host key and agent policy reference | `ssh_config` defines `StrictHostKeyChecking`, `UserKnownHostsFile`, `IdentityAgent`, and `IdentityFile` semantics; remote design should align with those controls instead of bypassing them. [VERIFIED: local command `ssh -V`] [CITED: https://man.openbsd.org/ssh_config] |
| OpenForge terminal stack | Node 24.14.1 available locally; project engine Node >=20 | Existing local terminal baseline | Local terminal code already uses `ws`, node-pty, tmux, attach tokens, rate limits, size limits, heartbeat, and tmux capture. [VERIFIED: local command `node --version`] [CITED: packages/gateway/src/websocket/terminal.ts] |
| OpenForge validation stack | pnpm 10.33.2; node:test, Vitest, Playwright | Design verification commands | Current package scripts expose backend node:test, web Vitest, Playwright E2E, typecheck, and build commands. [VERIFIED: local command `pnpm --version`] [CITED: package.json] [CITED: packages/gateway/package.json] [CITED: packages/web/package.json] |

### Supporting

| Existing Library / Tool | Version | Purpose | When to Use |
|-------------------------|---------|---------|-------------|
| `zod` | gateway `^3.24.1`, web `^3.25.76` | Schema validation | Future remote-agent operation schemas and Gateway route payloads should use existing schema-validation patterns; Phase 5 should specify this but not implement it. [CITED: packages/gateway/package.json] [CITED: packages/web/package.json] |
| `ws` | `^8.18.0` | Existing Gateway WebSocket server | Future transport must preserve existing terminal WebSocket contract and safety controls. [CITED: packages/gateway/package.json] [CITED: docs/API.md] |
| `node-pty` | `^1.0.0` | Existing local tmux attach | Future local transport should remain the local implementation; remote transport should be separate behind a target-aware interface. [CITED: packages/gateway/package.json] [CITED: packages/gateway/src/websocket/terminal.ts] |
| `tmux` | 3.4 installed locally | Session persistence | Local verification and future remote smoke require real tmux behavior; Phase 5 should keep tmux as the persistence primitive. [VERIFIED: local command `tmux -V`] [CITED: packages/gateway/src/services/tmux.ts] |
| `rg` | 15.1.0 installed locally | Scope-leak verification | Use static checks to prove no runtime remote routes, cloud/billing/telemetry scope, or Codex Web turn controls were added. [VERIFIED: local command `rg --version`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SSH target plus remote agent | Raw `ssh host "tmux ..."` wrapper | Rejected because it blurs local vs remote validation, encourages shell string construction, and weakens diagnostics. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] [CITED: https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html] |
| Gateway-mediated browser terminal | Direct browser-to-SSH | Rejected because current Web talks only to Gateway HTTP/WebSocket and Gateway owns auth, tenant isolation, attach tokens, and connection safety. [CITED: docs/API.md] [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] |
| Local-first remote target extension | Hosted cloud workers / billing / telemetry | Deferred because current release gates are local/self-hosted and cloud/telemetry/marketplace need separate architecture review. [CITED: docs/CI-CD-PLAN.md] [CITED: .planning/REQUIREMENTS.md] |
| Current Codex app-server safe surface | Web prompt/turn input | Deferred because `/turn` is disabled by default and Web E2E asserts no prompt/turn/send controls or `/turn` requests. [CITED: docs/API.md] [CITED: packages/web/e2e/codex-app-server.spec.ts] |

**Installation:** none. Phase 5 must not install runtime packages. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]

## Package Legitimacy Audit

No new external packages should be installed in Phase 5 because this is a docs/spec/threat-model/rollback phase. Package legitimacy gate is not required for the recommended plan. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | n/a | n/a | n/a | n/a | n/a | No install in Phase 5 |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

If a later runtime phase selects a Node SSH library or remote-agent package, that later phase must run `slopcheck install <pkg> --json`, `npm view <pkg> version`, and `npm view <pkg> scripts.postinstall` before recommending installation. [CITED: package legitimacy protocol in researcher instructions]

## Architecture Patterns

### System Architecture Diagram

```text
User action in Web
  -> Gateway REST `/api/v1/*` or `/ws/terminal/:sessionId`
  -> Gateway auth, tenant ownership, attach-token checks
  -> Project execution target lookup
      -> local target
          -> LocalTmuxTransport
          -> node-pty attach
          -> local tmux session
          -> local AI CLI
      -> ssh target
          -> SSH connection with pinned host key
          -> remote agent over SSH stdio
          -> remote schema validation and allowed-root realpath checks
          -> remote tmux session
          -> remote AI CLI account state on remote host
  -> Gateway redacted diagnostics and activity/audit metadata
  -> Web receives unchanged terminal output/status messages
```

This data-flow preserves the existing browser contract and moves remote filesystem/tmux authority to the remote host where those checks are meaningful. [CITED: docs/API.md] [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md]

### Recommended Artifact Structure

```text
docs/
├── superpowers/
│   └── specs/
│       ├── 2026-05-11-ssh-remote-execution-design.md        # update in place
│       ├── 2026-05-21-remote-execution-threat-model.md      # create
│       └── 2026-05-21-remote-execution-rollback-plan.md     # create
└── reports/
    └── remote-execution-architecture-verification-2026-05-21.md  # create
```

The exact filenames are researcher recommendations, not locked user decisions. [ASSUMED]

### Pattern 1: Design-Only Addendum

**What:** Update the existing SSH remote execution design seed rather than creating a competing architecture source. Add a "Phase 5 Architecture Package" section that points to the threat model, rollback plan, and verification report. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]

**When to use:** Use this pattern for plan `05-01` because the roadmap expects a separate architecture review before implementation, and existing design content already covers target shape, agent boundary, credentials, host keys, errors, and phased delivery. [CITED: .planning/ROADMAP.md] [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md]

**Planning rule:** The implementation plan should not include tasks that edit `packages/gateway/src/routes`, `packages/gateway/src/db/migrations`, `packages/web/src`, or terminal transport code, except static read/verification tasks. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]

### Pattern 2: STRIDE-Based Threat Model With Testable Mitigations

**What:** Use a table with asset, trust boundary, STRIDE category, abuse case, required control, evidence command, and release blocker. OWASP recommends system modeling, threat identification/ranking, mitigations, and review/validation as core threat-modeling activities. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html]

**Required categories for Phase 5:**

| Category | STRIDE | Required Design Control |
|----------|--------|-------------------------|
| SSH target identity and host-key pinning | Spoofing | Pin host key after explicit approval or preconfiguration; mismatch is hard error. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] [CITED: https://man.openbsd.org/ssh_config] |
| SSH credential handling | Information Disclosure / Elevation of Privilege | Prefer `ssh-agent` or selected key path first; no plaintext passwords; private-key import remains deferred unless lifecycle and encryption are designed. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md] [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html] |
| Raw SSH/tmux command construction | Tampering / Elevation of Privilege | Reject generic shell strings; use explicit operations and parameterized args. OWASP and Node docs both warn about shell command injection through externally influenced input. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html] [CITED: https://nodejs.org/api/child_process.html] |
| Remote agent stdio protocol | Tampering / Denial of Service | Require protocol version handshake, schema validation, method allowlist, size limits, malformed-frame handling, and no generic command method. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] |
| Remote path traversal and symlink escape | Tampering / Information Disclosure | Remote `safeResolve` equivalent must normalize, decode, realpath, and enforce target allowed roots on the remote host. [CITED: packages/gateway/src/lib/safe-resolve.ts] [CITED: https://owasp.org/www-community/attacks/Path_Traversal] |
| Terminal input authority and flooding | Tampering / Denial of Service | Keep JWT plus attach token, one active socket, message size limits, heartbeat, and input rate limit. [CITED: docs/API.md] [CITED: packages/gateway/src/websocket/terminal.ts] |
| Tenant target/session isolation | Elevation of Privilege / Information Disclosure | Target, credential, project, and session metadata must be `user_id` scoped; cross-tenant target ids return not found. [CITED: AGENTS.md] [CITED: docs/API.md] |
| Diagnostics leakage | Information Disclosure | Diagnostics may include bounded target state but must not include private keys, passphrases, raw SSH stderr, attach tokens, terminal transcripts, bearer tokens, or secret-like values. [CITED: docs/API.md] [CITED: packages/gateway/src/services/diagnostics.ts] |
| Rollback failure | Denial of Service | Remote migrations must be nullable/default-local and remote launch must be feature-disableable without breaking local recovery. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md] |
| Codex `/turn` boundary | Information Disclosure / Repudiation / Denial of Wallet | Keep Web turn input disabled until transcript retention, consent, rate limiting, model usage, and security review are designed. [CITED: docs/API.md] [CITED: packages/gateway/src/routes/codex-app-server.ts] |

### Pattern 3: Rollback-As-Architecture

**What:** Rollback must be specified before implementation so later migrations, flags, diagnostics, and UI states can fail local-safe. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]

**Required rollback scenarios:**

- Remote feature disabled after target records exist. Local projects and sessions still load as `local`. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]
- Host key mismatch appears after a target was trusted. Existing local sessions still work; remote launch/test returns `host_key_mismatch`. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md]
- Remote agent missing or unsupported. Project import/session launch fail before tmux state with `remote_agent_missing` or `remote_agent_version_unsupported`. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md]
- Remote target table/migrations exist but are ignored by an older local runtime. The design should require nullable/default-local fields for future implementation. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]
- Codex `/turn` remains disabled and Web does not expose send controls during rollback or local-first operation. [CITED: packages/gateway/test/codex-app-server-routes.test.ts] [CITED: packages/web/e2e/codex-app-server.spec.ts]

### Anti-Patterns to Avoid

- **Creating a second competing remote execution spec:** Update or supplement the existing 2026-05-11 SSH design seed. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]
- **Raw `ssh host "tmux ..."` wrappers:** This creates shell quoting and validation ambiguity; the remote agent should expose typed operations. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] [CITED: https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html]
- **Direct browser-to-SSH:** This bypasses Gateway auth, tenant, attach-token, and connection safety controls. [CITED: docs/API.md]
- **Current API docs that imply unimplemented routes are live:** If `docs/API.md` is edited, mark remote routes as future design only or keep them in the remote spec until implementation. [ASSUMED]
- **Codex remote app-server scope creep:** Remote terminal Codex may remain subscription-managed on the remote host later, but remote Codex app-server control plane and Web `/turn` are deferred. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSH cryptography and host authentication | Custom SSH protocol, custom key exchange, or disabled checking | OpenSSH/ssh-agent semantics or a vetted future SSH library after package audit | SSH identity rules are security-critical; OpenSSH documents strict host key and agent configuration behavior. [CITED: https://man.openbsd.org/ssh_config] |
| Remote shell command quoting | Escaping a user-controlled command string | Typed remote-agent operations with structured args and schema validation | OWASP treats command construction from external input as command-injection risk; Node warns shell metacharacters can trigger arbitrary command execution when shell is enabled. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html] [CITED: https://nodejs.org/api/child_process.html] |
| Remote filesystem safety | Local-only path checks or frontend path validation | Remote `safeResolve`/realpath against explicit allowed roots | Path traversal can use `../`, absolute paths, encoding, and platform-specific variants; OpenForge already tests local traversal and symlink escapes. [CITED: https://owasp.org/www-community/attacks/Path_Traversal] [CITED: packages/gateway/test/safe-resolve.test.ts] |
| Terminal persistence | SQLite terminal logs or raw transcript storage | tmux capture and structured session metadata only | Current architecture removed terminal logs from SQLite and uses tmux scrollback for recovery. [CITED: docs/TECH-ARCHITECTURE.md] [CITED: packages/gateway/src/services/tmux.ts] |
| Diagnostics redaction | Free-form raw dumps | Existing `buildLocalDiagnosticsExport` redaction pattern plus remote-safe fields | Existing diagnostics redacts secret-like keys and values and exposes bounded status/count metadata. [CITED: packages/gateway/src/services/diagnostics.ts] |
| Codex turn consent/retention | Hidden prompt storage or implicit enablement | Explicit transcript retention, user consent, rate limit, and security review design before exposure | Current Gateway disables `/turn` by default and Web E2E asserts no prompt/send controls. [CITED: docs/API.md] [CITED: packages/web/e2e/codex-app-server.spec.ts] |

**Key insight:** Remote execution is not a string prefix on local tmux. It changes the trust boundary from "Gateway host filesystem/processes" to "Gateway plus remote host plus SSH identity plus remote agent protocol," so the plan must design the boundary before runtime tasks. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md]

## Common Pitfalls

### Pitfall 1: Design Docs Accidentally Promise Runtime APIs

**What goes wrong:** `docs/API.md` or roadmap text lists `/api/v1/execution-targets` as current behavior before code exists. [ASSUMED]
**Why it happens:** Architecture planning borrows future route names from the seed spec without marking implementation status. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md]
**How to avoid:** Keep future route contracts in the remote execution spec until implementation or label them as "future remote execution design, not implemented." [ASSUMED]
**Warning signs:** Static grep finds `/api/v1/execution-targets` in current API docs or runtime code after Phase 5. [ASSUMED]

### Pitfall 2: Host-Key TOFU Becomes Silent Trust

**What goes wrong:** A connection-test flow auto-accepts first host keys or uses `StrictHostKeyChecking=no`. [ASSUMED]
**Why it happens:** Convenience defaults are treated as "developer local" shortcuts. [ASSUMED]
**How to avoid:** Require explicit first-use approval or preconfigured fingerprint, then treat mismatch as hard error. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md] [CITED: https://man.openbsd.org/ssh_config]
**Warning signs:** Grep finds `StrictHostKeyChecking=no`, `UserKnownHostsFile=/dev/null`, or "auto accept" language. [ASSUMED]

### Pitfall 3: Remote Path Validation Runs Locally

**What goes wrong:** Gateway validates `/home/user/project` using local `fs.realpathSync`, which says nothing about the remote host. [ASSUMED]
**Why it happens:** Existing local `safeResolve` patterns are reused in the wrong tier. [CITED: packages/gateway/src/lib/safe-resolve.ts]
**How to avoid:** The remote agent owns remote realpath/allowed-root checks; Gateway owns target ownership and response handling. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md]
**Warning signs:** Future implementation mentions `safeResolve` in Gateway for a remote target path without a remote-agent operation. [ASSUMED]

### Pitfall 4: Diagnostics Leak Raw Remote Details

**What goes wrong:** Remote failures dump raw SSH stderr, full paths, usernames, tokens, or terminal output into diagnostics. [ASSUMED]
**Why it happens:** Remote failures are harder to debug than local failures, so implementers over-log. [ASSUMED]
**How to avoid:** Use stable error codes and bounded summaries; extend existing diagnostics redaction. [CITED: docs/API.md] [CITED: packages/gateway/src/services/diagnostics.ts]
**Warning signs:** Logs or diagnostics include raw private key, passphrase, `Bearer`, `sk-`, attach token, or terminal transcript strings. [CITED: packages/gateway/src/services/diagnostics.ts]

### Pitfall 5: Codex `/turn` Sneaks In Through Remote Planning

**What goes wrong:** Remote Codex is treated as a chance to enable Web prompt input, remote app-server control, or model usage. [ASSUMED]
**Why it happens:** OpenAI's current App Server is a bidirectional JSON-RPC integration surface, but OpenForge's current accepted surface is observable control plane only. [CITED: https://openai.com/index/unlocking-the-codex-harness/] [CITED: docs/API.md]
**How to avoid:** Keep Phase 5 remote terminal Codex separate from Codex app-server `/turn`; require a distinct COD-01 design before any prompt input. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]
**Warning signs:** Web code exposes "send", "prompt", or "turn" controls, or E2E no longer asserts that `/turn` is not requested. [CITED: packages/web/e2e/codex-app-server.spec.ts]

## Code Examples

### Threat Model Row Template

```markdown
| Threat ID | Asset | Trust Boundary | STRIDE | Abuse Case | Required Control | Evidence |
|-----------|-------|----------------|--------|------------|------------------|----------|
| REM-T01 | SSH host identity | Gateway -> SSH target | Spoofing | Attacker presents a different host key after DNS/IP change | `host_key_mismatch` hard error; no `StrictHostKeyChecking=no`; explicit user action required | `rg -n "StrictHostKeyChecking=no|UserKnownHostsFile=/dev/null" docs packages -g '!node_modules'` returns no unsafe runtime changes |
```

Source: OWASP threat-model phases and OpenForge host-key decision. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html] [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]

### Future Remote-Agent Operation Shape

```typescript
type RemoteAgentRequest =
  | { method: "initialize"; params: { protocolVersion: string } }
  | { method: "checkDependencies"; params: { adapters: Array<"claude" | "opencode" | "codex"> } }
  | { method: "resolveProjectPath"; params: { path: string; allowedRoots: string[] } }
  | { method: "createTmuxSession"; params: { sessionName: string; cwd: string; adapterId: string; env: Record<string, string> } }
  | { method: "attachTmuxSession"; params: { sessionName: string } }
  | { method: "resizeTmuxSession"; params: { sessionName: string; cols: number; rows: number } }
  | { method: "captureTmuxPane"; params: { sessionName: string; maxLines: number } }
  | { method: "stopTmuxSession"; params: { sessionName: string } };
```

This is an illustrative planning contract, not implementation code; exact method names are not locked. The important design constraint is a finite allowlist and no generic shell-command method. [ASSUMED] [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md]

### Scope-Leak Verification Commands

```bash
rg -n "/api/v1/execution-targets|executionTargetId|SshAgentTerminalTransport|remote_agent|StrictHostKeyChecking=no|UserKnownHostsFile=/dev/null" packages/gateway/src packages/web/src
rg -n "OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1|/turn|promptInputExposed: true|send prompt|turn input" docs packages -g '!node_modules'
rg -n "cloud deployment|hosted telemetry|billing|marketplace|cloud worker" docs packages -g '!node_modules'
```

These commands should be used as review gates, with expected matches documented rather than blindly requiring zero matches because existing docs already mention deferred scope and `/turn` disablement. [ASSUMED] [CITED: docs/CI-CD-PLAN.md] [CITED: docs/API.md]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Treat SSH as `ssh host "tmux ..."` wrapper | Treat SSH as explicit execution target plus remote agent over SSH stdio | Confirmed in seed spec dated 2026-05-11 | Planner must design target, agent protocol, host key, path safety, diagnostics, and rollback before runtime work. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] |
| Accept host keys for convenience or disable checking | Fail closed with explicit approval/preconfigured fingerprint and hard mismatch | Locked in Phase 5 context | Planner must include host-key threat model and static checks for unsafe SSH options. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md] [CITED: https://man.openbsd.org/ssh_config] |
| Store terminal logs/transcripts in app database | Store only structured metadata; recover scrollback from tmux | Current architecture and code | Remote design must not add remote terminal transcript storage. [CITED: docs/TECH-ARCHITECTURE.md] [CITED: packages/gateway/src/services/tmux.ts] |
| Codex app-server prompt/turn input as UI control | Observable control-plane prototype with `/turn` disabled by default | Current API and tests | Phase 5 must not enable prompt input or remote Codex app-server control. [CITED: docs/API.md] [CITED: packages/gateway/test/codex-app-server-routes.test.ts] |
| Hidden telemetry or cloud worker expansion | Local/self-hosted release gates with cloud/telemetry deferred | Current CI/CD plan | Verification must prove hosted/cloud/billing/telemetry decisions stayed out of local-first code paths. [CITED: docs/CI-CD-PLAN.md] |
| Special-case Codex UI protocol | Codex App Server uses client-friendly bidirectional JSON-RPC / JSONL over stdio for rich agent surfaces | OpenAI article published 2026-02-04 | This increases the need for explicit OpenForge consent/retention/security design before exposing `/turn`, because turns, threads, and events are richer than terminal status metadata. [CITED: https://openai.com/index/unlocking-the-codex-harness/] |

**Deprecated/outdated:**
- Raw SSH command wrappers: rejected for OpenForge product implementation. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md]
- Direct browser-to-SSH: rejected by Gateway/Web split and WebSocket safety baseline. [CITED: docs/API.md]
- `StrictHostKeyChecking=no`: explicitly forbidden by Phase 5 context. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]
- Web Codex prompt/turn controls: deferred until COD-01 design is complete. [CITED: .planning/REQUIREMENTS.md] [CITED: docs/API.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recommended new artifact filenames use 2026-05-21 and existing `docs/superpowers/specs`/`docs/reports` folders. | Summary, Recommended Artifact Structure | Planner may need to choose different filenames, but artifact responsibilities remain valid. |
| A2 | `docs/API.md` should not list unimplemented remote routes as current behavior. | Anti-Patterns, Common Pitfalls | If the project prefers future API contracts in API.md, planner should label status clearly to avoid false implementation claims. |
| A3 | Future remote-agent method names in the example are illustrative only. | Code Examples | Future implementation may use different names, but must preserve typed operation allowlist and schema validation. |
| A4 | Static scope-leak commands require human interpretation of expected matches. | Code Examples, Validation Architecture | A zero-match policy would fail on existing legitimate deferred-scope docs and `/turn` disabled references. |

## Open Questions (RESOLVED)

1. **RESOLVED - Future SSH transport selection**
   - What we know: Phase 5 should not install packages, and future implementation must not hand-roll SSH crypto. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]
   - Resolution: Phase 5 does not choose or install an SSH transport. Runtime implementation must choose OpenSSH binary versus a Node SSH library in a later implementation phase, with package legitimacy audit and security review before any install. [ASSUMED]
   - Planning impact: Treat SSH transport choice as a deferred runtime-phase decision, not a blocker for the architecture package. [ASSUMED]

2. **RESOLVED - Remote agent bootstrap mechanism**
   - What we know: The seed spec lists `openforge doctor --remote` versus manual install as an open question. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md]
   - Resolution: Phase 5 documents bootstrap risks and required controls only. The final remote-agent bootstrap UX is deferred to the runtime implementation phase. [ASSUMED]
   - Planning impact: Threat model must cover bootstrap abuse cases, but no installer or bootstrap implementation belongs in Phase 5. [ASSUMED]

3. **RESOLVED - Private key import**
   - What we know: Phase 5 context defers private key import unless encryption, passphrase, deletion, and security review are included. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]
   - Resolution: Private key import is explicitly deferred. First implementation architecture should prefer `ssh-agent` or user-selected key path unless a later phase includes encryption-at-rest, passphrase handling, deletion semantics, and security review. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]
   - Planning impact: The Phase 5 architecture package must record private key import as a later design gate, not as a planned first-release capability. [ASSUMED]

4. **RESOLVED - WSL as remote smoke**
   - What we know: WSL can be an optional explicit SSH smoke host but does not replace physical Windows/WSL local terminal caveat evidence. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]
   - Resolution: Phase 5 specifies smoke categories only. WSL may be used as an optional explicitly configured SSH smoke host in a later runtime phase, but it cannot substitute for physical Windows/WSL local terminal caveat evidence. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]
   - Planning impact: Verification must not claim remote smoke availability or close local Windows/WSL caveats during this design phase. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Package scripts and backend tests | yes | v24.14.1 | Project engine requires >=20; current host exceeds it. [VERIFIED: local command `node --version`] [CITED: package.json] |
| pnpm | Monorepo scripts | yes | 10.33.2 | none needed. [VERIFIED: local command `pnpm --version`] [CITED: package.json] |
| git | Diff/status/commit | yes | 2.43.0 | none needed. [VERIFIED: local command `git --version`] |
| rg | Static scope checks | yes | 15.1.0 | `grep -R` if unavailable, but rg is present. [VERIFIED: local command `rg --version`] |
| tmux | Existing local terminal evidence and future remote smoke baseline | yes | 3.4 | Remote runtime phase must also check remote host separately. [VERIFIED: local command `tmux -V`] |
| OpenSSH client | Host-key policy reference and future connection-test design | yes | OpenSSH_9.6p1 Ubuntu-3ubuntu13.15 | Runtime phase may use OpenSSH binary or audited library; Phase 5 should not choose/install. [VERIFIED: local command `ssh -V`] |

**Missing dependencies with no fallback:** none for this design phase. [VERIFIED: local command probes]

**Missing dependencies with fallback:** Graphify context is unavailable; `.planning/graphs/graph.json` is absent and graphify reports disabled. Research used explicit phase context, docs, and code scans instead. [VERIFIED: local command `ls .planning/graphs/graph.json`] [VERIFIED: local command `node /root/.codex/get-shit-done/bin/gsd-tools.cjs graphify status`]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Backend framework | `node:test` through `pnpm --dir packages/gateway test`. [CITED: packages/gateway/package.json] |
| Web unit framework | Vitest through `pnpm --dir packages/web test`. [CITED: packages/web/package.json] |
| E2E framework | Playwright through `packages/web/playwright.config.ts`. [CITED: packages/web/package.json] |
| Quick run command | `pnpm --dir packages/gateway test test/codex-app-server-routes.test.ts test/diagnostics.test.ts test/safe-resolve.test.ts test/terminal-ws.test.ts` |
| Web Codex boundary command | `pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line` |
| Static scope command | `rg -n "/api/v1/execution-targets|executionTargetId|SshAgentTerminalTransport|remote_agent|StrictHostKeyChecking=no|UserKnownHostsFile=/dev/null" packages/gateway/src packages/web/src` |
| Full suite command | `pnpm -r test` |

### Research-Time Validation Notes

- Required research sections and requirement mappings were found in `05-RESEARCH.md` with `rg`. [VERIFIED: local command]
- Runtime remote scope scan over `packages/gateway/src` and `packages/web/src` found no matches for `/api/v1/execution-targets`, `executionTargetId`, `SshAgentTerminalTransport`, `remote_agent`, `StrictHostKeyChecking=no`, or `UserKnownHostsFile=/dev/null`. [VERIFIED: local command]
- Codex `/turn` static scan returned existing deferred/disabled references in docs and tests; no new runtime enablement was introduced by this research file. [VERIFIED: local command]
- `pnpm --dir packages/gateway test test/diagnostics.test.ts test/safe-resolve.test.ts` passed: 2 files passed. [VERIFIED: local command]
- `pnpm --dir packages/gateway test test/codex-app-server-routes.test.ts test/terminal-ws.test.ts` did not pass under the local Node v24.14.1 runtime; `codex-app-server-routes.test.ts` hit a Node native assertion in `InternalCallbackScope::Close`, and `terminal-ws.test.ts` failed at file level without a captured JS assertion. Planner should rerun these under the project's supported CI/Node runtime before using them as a phase gate. [VERIFIED: local command]
- `pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line` initially failed inside the sandbox because the dev server could not bind `127.0.0.1:48732` with `listen EPERM`; rerun with approved local server binding passed 1 Chromium test. [VERIFIED: local command]

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REM-01 | Architecture package exists and covers target registry, remote agent, host-key policy, path safety, diagnostics, error taxonomy, phased implementation, and no runtime code. | docs/static | `test -f docs/superpowers/specs/2026-05-21-remote-execution-threat-model.md && test -f docs/superpowers/specs/2026-05-21-remote-execution-rollback-plan.md` | no - Wave 0 |
| REM-01 | Runtime remote APIs/transports were not implemented in Phase 5. | static | `rg -n "/api/v1/execution-targets|executionTargetId|SshAgentTerminalTransport|remote_agent" packages/gateway/src packages/web/src` and document expected no runtime additions. | yes |
| REM-01 | Threat model includes required SSH/agent/path/credential/diagnostic/rollback categories. | docs/static | `rg -n "host_key_mismatch|ssh_auth_failed|remote_agent_missing|remote_path_denied|remote_terminal_attach_failed|rollback" docs/superpowers/specs/2026-05-21-remote-execution-threat-model.md docs/superpowers/specs/2026-05-21-remote-execution-rollback-plan.md` | no - Wave 0 |
| REM-02 | Hosted/cloud/billing/telemetry remains deferred, not implemented in local-first paths. | static | `rg -n "cloud deployment|hosted telemetry|billing|marketplace|cloud worker" docs packages -g '!node_modules'` and verify matches are deferred/boundary text only. | yes |
| COD-01 | Codex app-server `/turn` remains disabled by default and Web does not call it. | automated | `pnpm --dir packages/gateway test test/codex-app-server-routes.test.ts` and `pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line` | yes |
| COD-01 | Prompt/response transcript persistence and consent remain unimplemented until designed. | static/docs | `rg -n "transcriptPersistence|promptInputExposed|OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED|/turn" docs/API.md packages/gateway/src/routes/codex-app-server.ts packages/web/e2e/codex-app-server.spec.ts` and verify disabled/default-safe language. | yes |

### Sampling Rate

- **Per task commit:** Run static scope checks and the focused backend Codex/diagnostics/path/WebSocket tests. [ASSUMED]
- **Per wave merge:** Run `pnpm -r test` plus Playwright Codex app-server smoke if browser dependencies are available. [CITED: docs/CI-CD-PLAN.md]
- **Phase gate:** Verification report must include command outputs or exact skipped reasons, and must explicitly state no runtime remote implementation was added. [ASSUMED]

### Wave 0 Gaps

- [ ] `docs/superpowers/specs/2026-05-21-remote-execution-threat-model.md` - covers REM-01 and COD-01 threat categories. [ASSUMED]
- [ ] `docs/superpowers/specs/2026-05-21-remote-execution-rollback-plan.md` - covers REM-01 rollback and REM-02 local-safe deferral. [ASSUMED]
- [ ] `docs/reports/remote-execution-architecture-verification-2026-05-21.md` - records static checks, focused tests, and no-scope-leak evidence. [ASSUMED]
- [ ] Update `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` with Phase 5 addendum links and accepted decisions. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md]

## Security Domain

Security enforcement is enabled in `.planning/config.json`, ASVS level is 1, and Phase 5 is security-design-heavy. [CITED: .planning/config.json]

### Applicable ASVS / OWASP Control Areas

| Control Area | Applies | Standard Control |
|--------------|---------|------------------|
| Architecture, design, and threat modeling | yes | STRIDE-oriented threat model with DFD, trust boundaries, mitigations, and validation evidence. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html] |
| Authentication | yes | JWT auth remains Gateway-owned; terminal attach also requires per-session attach token. [CITED: docs/API.md] |
| Session management | yes | One active terminal WebSocket per session, heartbeat, timeout, and attach token checks remain required. [CITED: docs/API.md] [CITED: packages/gateway/src/websocket/terminal.ts] |
| Access control | yes | Target, credential, project, session, diagnostics, and Codex app-server state must be tenant-scoped by `user_id`. [CITED: AGENTS.md] [CITED: docs/API.md] |
| Input validation and injection prevention | yes | Use schema validation and avoid shell command construction from user input; future remote-agent protocol must be typed. [CITED: .claude/rules/api.md] [CITED: https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html] |
| File/path handling | yes | Remote paths require remote realpath and allowed-root validation; symlink escapes and encoded traversal must be rejected. [CITED: packages/gateway/src/lib/safe-resolve.ts] [CITED: https://owasp.org/www-community/attacks/Path_Traversal] |
| Cryptography and secrets | yes | Do not hand-roll SSH crypto; do not store plaintext passwords; private-key import requires encryption, passphrase, deletion, and review. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md] [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html] |
| Error handling and logging | yes | Stable remote failure codes and redacted diagnostics only; no raw stderr, transcripts, tokens, keys, or secret-like values. [CITED: docs/API.md] [CITED: packages/gateway/src/services/diagnostics.ts] |
| Privacy / consent for Codex turns | yes | `/turn` remains disabled until transcript retention, consent, rate limit, and security review are designed. [CITED: .planning/REQUIREMENTS.md] [CITED: docs/API.md] |

### Known Threat Patterns for Remote Execution

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Host key spoofing / MITM | Spoofing | Pin host key after explicit approval or preconfiguration; mismatch blocks remote action. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] |
| SSH credential leakage | Information Disclosure | Use `ssh-agent`/key path first; no plaintext passwords; redacted diagnostics; private-key import deferred. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md] |
| Remote shell/argument injection | Tampering / Elevation of Privilege | No generic shell command API; no raw SSH wrapper; structured operations and argument arrays. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html] [CITED: https://nodejs.org/api/child_process.html] |
| Remote path traversal and symlink escape | Tampering / Information Disclosure | Remote realpath and allowed roots; reject traversal and encoded variants. [CITED: https://owasp.org/www-community/attacks/Path_Traversal] [CITED: packages/gateway/test/safe-resolve.test.ts] |
| Protocol abuse / malformed frames | Tampering / Denial of Service | Version handshake, schema validation, method allowlist, message size limits, unknown-method rejection. [CITED: docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md] |
| Terminal input flood | Denial of Service | Preserve 50 terminal input messages per second per connection, message size limit, heartbeat, and connection caps. [CITED: docs/API.md] [CITED: packages/gateway/src/websocket/terminal.ts] |
| Tenant target confusion | Elevation of Privilege | User-scoped repositories and route ownership checks before target/project/session actions. [CITED: AGENTS.md] |
| Diagnostics oversharing | Information Disclosure | Bounded failure codes and redacted summaries only. [CITED: docs/API.md] [CITED: packages/gateway/src/services/diagnostics.ts] |
| Codex turn transcript exposure | Information Disclosure / Repudiation | Keep Web prompt/turn disabled until retention and consent are designed and reviewed. [CITED: docs/API.md] [CITED: packages/web/e2e/codex-app-server.spec.ts] |
| Rollback breaking local sessions | Denial of Service | Additive nullable/default-local future data model and remote feature disablement. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md` - locked Phase 5 decisions, boundaries, deferred scope.
- `.planning/phases/OF-05-remote-execution-architecture/05-DISCUSSION-LOG.md` - decision audit log and rejected alternatives.
- `.planning/REQUIREMENTS.md` - REM-01, REM-02, COD-01.
- `.planning/ROADMAP.md` - Phase 5 goal, success criteria, and one-plan expectation.
- `.planning/STATE.md` and `.planning/DECISIONS-INDEX.md` - project state and locked cross-phase decisions.
- `AGENTS.md`, `CLAUDE.md`, `.claude/rules/security.md`, `.claude/rules/api.md`, `.claude/rules/backend.md`, `.claude/rules/testing.md` - project rules and constraints.
- `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` - primary SSH remote design seed.
- `docs/TECH-ARCHITECTURE.md`, `docs/API.md`, `docs/CI-CD-PLAN.md` - local terminal/API/Codex/release gate constraints.
- `packages/gateway/src/websocket/terminal.ts`, `packages/gateway/src/services/session-manager.ts`, `packages/gateway/src/services/tmux.ts`, `packages/gateway/src/lib/safe-resolve.ts`, `packages/gateway/src/lib/dependency-check.ts`, `packages/gateway/src/services/diagnostics.ts`, `packages/gateway/src/routes/codex-app-server.ts` - current code patterns.
- `packages/gateway/test/codex-app-server-routes.test.ts`, `packages/gateway/test/safe-resolve.test.ts`, `packages/gateway/test/terminal-ws.test.ts`, `packages/web/e2e/codex-app-server.spec.ts` - current verification surfaces.
- OpenSSH `ssh_config(5)` manual - host key, identity, agent, and shell-token cautions: https://man.openbsd.org/ssh_config
- OWASP Threat Modeling Cheat Sheet - process and validation structure: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
- OWASP ASVS project - ASVS 5.0.0 current stable statement: https://github.com/OWASP/ASVS
- OWASP OS Command Injection Defense Cheat Sheet - command/argument injection controls: https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html
- OWASP Path Traversal - path traversal variants and protection guidance: https://owasp.org/www-community/attacks/Path_Traversal
- OWASP Secrets Management Cheat Sheet - secrets lifecycle and least-privilege guidance: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- Node.js child_process docs - shell metacharacter warning and spawn/exec distinction: https://nodejs.org/api/child_process.html
- OpenAI Codex App Server article - Codex App Server JSON-RPC/stdio and turn/thread primitives: https://openai.com/index/unlocking-the-codex-harness/

### Secondary (MEDIUM confidence)

- Local environment probes for Node, pnpm, git, rg, tmux, and OpenSSH. [VERIFIED: local commands]
- Memory registry note that prior OpenForge SSH planning treated remote as a separate execution target with remote-agent boundary. This was used only as a continuity hint and reverified against current repo files. [CITED: /root/.codex/memories/MEMORY.md]

### Tertiary (LOW confidence)

- Artifact filenames and exact doc placement are researcher recommendations where not locked by CONTEXT.md. [ASSUMED]
- Future SSH transport implementation library/binary selection is intentionally deferred. [ASSUMED]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - no new packages; existing local stack, docs, package scripts, and environment were verified. [CITED: package.json] [VERIFIED: local commands]
- Architecture: HIGH - locked decisions, existing seed spec, API docs, terminal docs, and current code all agree on Gateway/Web split, tmux persistence, and Codex `/turn` boundary. [CITED: .planning/phases/OF-05-remote-execution-architecture/05-CONTEXT.md] [CITED: docs/API.md]
- Threat model: HIGH - categories are grounded in locked Phase 5 decisions, OWASP threat modeling, OpenSSH docs, OWASP command/path/secrets guidance, and current OpenForge controls. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html]
- Validation: MEDIUM - commands are concrete and existing tests are present, but new threat model/rollback/report files do not exist until plan execution. [CITED: packages/gateway/package.json] [ASSUMED]

**Research date:** 2026-05-21
**Valid until:** 2026-06-20 for local docs/architecture; 2026-05-28 for external OpenSSH/OWASP/OpenAI references because security and Codex documentation can change.
