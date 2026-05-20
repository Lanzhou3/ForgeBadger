# Phase 05: Remote Execution Architecture - Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 4
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` | docs/spec | request-response, streaming, file-I/O architecture | `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md`, `docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md` | exact |
| `docs/superpowers/specs/2026-05-21-remote-execution-threat-model.md` | docs/security | trust-boundary, request-response, streaming, file-I/O | `.planning/phases/OF-04-feishu-project-manager-ledger/04-01-PLAN.md`, `04-02-PLAN.md`, `05-RESEARCH.md` | role-match |
| `docs/superpowers/specs/2026-05-21-remote-execution-rollback-plan.md` | docs/runbook | rollback, batch, migration-safe recovery | `docs/RELEASE-PLAN.md`, `docs/superpowers/specs/2026-05-02-ai-cli-project-config-management-design.md` | role-match |
| `docs/reports/remote-execution-architecture-verification-2026-05-21.md` | docs/report | validation evidence, static checks, test evidence | `.planning/phases/OF-04-feishu-project-manager-ledger/04-VERIFICATION.md`, `docs/reports/post-beta-release-gates-2026-05-10.md` | exact |

## Pattern Assignments

### `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` (docs/spec, request-response + streaming + file-I/O)

**Analog:** same file, plus `docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md`

**Frontmatter/header pattern** (`docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` lines 1-5):
```markdown
# SSH Remote Execution Design

Date: 2026-05-11
Status: Confirmed; ready for implementation-plan breakdown
Scope: architecture review for future SSH-backed execution targets
```

**Context/goal/non-goal pattern** (`2026-05-11-ssh-remote-execution-design.md` lines 7-23, 36-47):
```markdown
## Roadmap Context

OpenForge is currently a local-first control plane...

## Goal

Add user-managed remote machines as explicit execution targets while preserving
OpenForge's Gateway/Web split, tmux persistence model, tenant isolation,
adapter discovery, and diagnostics story.

## Non-Goals

- No hosted OpenForge cloud worker or multi-tenant cloud runtime.
- No direct browser-to-SSH connection.
- No terminal log persistence in SQLite.
- No raw shell command builder that interpolates user input into `ssh ...`.
```

**Options pattern** (`2026-05-11-ssh-remote-execution-design.md` lines 48-90):
```markdown
## Options Considered

### Recommended: SSH target plus remote agent boundary

Pros:
- Preserves the existing browser terminal contract...

Cons:
- Requires shipping, versioning, and testing a remote agent package.

### Alternative: SSH command wrapper

This option is rejected for product implementation.
```

**Architecture/data-flow pattern** (`2026-05-11-ssh-remote-execution-design.md` lines 150-178):
````markdown
### Remote agent responsibilities

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

The remote agent must not expose a generic "run arbitrary shell command" API.
````

**Error taxonomy pattern** (`2026-05-11-ssh-remote-execution-design.md` lines 287-308):
```markdown
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
```

**Phased delivery pattern** (`2026-05-11-ssh-remote-execution-design.md` lines 328-384):
```markdown
## Phased Delivery

### Phase 0: design and ADR

Deliver this design and convert it into an implementation plan only after
review. No runtime code changes are required in this phase.

### Phase 1: target registry and connection test

Acceptance:
- Users can register a remote target.
- Users can test SSH connectivity and host key state.
```

**Apply:** keep this file as the primary remote architecture source. Add a Phase 5 addendum section, not a second competing architecture. Link the threat model, rollback plan, and verification report. Preserve explicit non-goals: no runtime routes/transports/migrations/Web UI in Phase 5, no raw SSH wrappers, no direct browser-to-SSH, no Codex app-server remote control-plane support, and no Web prompt/turn input.

---

### `docs/superpowers/specs/2026-05-21-remote-execution-threat-model.md` (docs/security, trust-boundary)

**Analog:** `.planning/phases/OF-04-feishu-project-manager-ledger/04-01-PLAN.md`, `04-02-PLAN.md`, and `05-RESEARCH.md`

**Trust boundary table pattern** (`04-02-PLAN.md` lines 270-278):
```markdown
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser/API client to Gateway REST | Authenticated but untrusted route params, query, and bodies enter project-manager handlers. |
| Gateway route to SQLite repository | Repository must enforce tenant/project scoping even if route code changes later. |
| Gateway to diagnostics export | Diagnostics may be shared for support and must not contain raw ledger/evidence/terminal/Feishu/provider secret data. |
```

**STRIDE register pattern** (`04-01-PLAN.md` lines 201-210):
```markdown
## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-01 | Information Disclosure | Project-manager routes, repository contract, Copilot read tools | mitigate | Require `user_id` on every table... |
| T-04-02 | Elevation of Privilege | Feishu ingress and Copilot pending actions | mitigate | Document that Feishu text cannot approve pending actions... |
| T-04-SC | Tampering | npm/pip/cargo installs | accept | No new package installs are planned; implementation uses existing Gateway stack. |
```

**Threat row template** (`05-RESEARCH.md` lines 311-317):
```markdown
| Threat ID | Asset | Trust Boundary | STRIDE | Abuse Case | Required Control | Evidence |
|-----------|-------|----------------|--------|------------|------------------|----------|
| REM-T01 | SSH host identity | Gateway -> SSH target | Spoofing | Attacker presents a different host key after DNS/IP change | `host_key_mismatch` hard error; no `StrictHostKeyChecking=no`; explicit user action required | `rg -n "StrictHostKeyChecking=no|UserKnownHostsFile=/dev/null" docs packages -g '!node_modules'` returns no unsafe runtime changes |
```

**Required threat categories** (`05-RESEARCH.md` lines 224-237):
```markdown
| Category | STRIDE | Required Design Control |
|----------|--------|-------------------------|
| SSH target identity and host-key pinning | Spoofing | Pin host key after explicit approval or preconfiguration; mismatch is hard error. |
| SSH credential handling | Information Disclosure / Elevation of Privilege | Prefer `ssh-agent` or selected key path first; no plaintext passwords... |
| Raw SSH/tmux command construction | Tampering / Elevation of Privilege | Reject generic shell strings; use explicit operations and parameterized args. |
| Remote path traversal and symlink escape | Tampering / Information Disclosure | Remote `safeResolve` equivalent must normalize, decode, realpath, and enforce target allowed roots on the remote host. |
| Codex `/turn` boundary | Information Disclosure / Repudiation / Denial of Wallet | Keep Web turn input disabled until transcript retention, consent, rate limiting, model usage, and security review are designed. |
```

**Security requirement style** (`docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md` lines 272-285):
```markdown
## Security Requirements

- No model-generated raw CLI command strings.
- Validate every Feishu command input with zod.
- Parse structured output only.
- Store audit rows for inbound command, pending-action creation, approval,
  execution result, and Feishu write.
- Include an emergency integration disable switch.
```

**Apply:** create a standalone threat model with sections: `Context`, `System Model`, `Trust Boundaries`, `Assets`, `STRIDE Threat Register`, `Required Controls`, `Verification Map`, `Release Blockers`, `Out Of Scope`. Use `REM-T01` through at least `REM-T10` because `05-VALIDATION.md` references `REM-T01..REM-T10`. Include host key spoofing, SSH credential theft, raw SSH command injection, remote agent protocol abuse, remote path traversal, symlink escape, terminal input flooding, diagnostics leakage, stale target state, rollback failure, and Codex `/turn` boundary.

---

### `docs/superpowers/specs/2026-05-21-remote-execution-rollback-plan.md` (docs/runbook, rollback + batch recovery)

**Analog:** `docs/RELEASE-PLAN.md` and `docs/superpowers/specs/2026-05-02-ai-cli-project-config-management-design.md`

**Release rollback sequence pattern** (`docs/RELEASE-PLAN.md` lines 204-220):
```markdown
## 9. Rollback

Rollback sequence:

1. Stop the Web console process.
2. Stop the Gateway process.
3. Restore the previous release commit or build artifact.
4. Restore the previous `.env` if secret or port configuration changed.
5. Restore the backed-up SQLite database if the new release wrote incompatible
   state.
6. Start Gateway, then Web.
7. Inspect `tmux list-sessions` and only terminate new failed `of-*` sessions
   after confirming they are not active user sessions.

Terminal scrollback is not stored in SQLite. Recovery depends on tmux sessions
remaining alive, so do not kill tmux sessions during rollback unless they are
confirmed orphaned.
```

**Config apply rollback pattern** (`docs/superpowers/specs/2026-05-02-ai-cli-project-config-management-design.md` lines 198-210):
```markdown
### Diff And Apply

Applying changes follows the existing config pipeline:

1. Build a render plan.
2. Detect conflicts.
3. Show per-file diff and conflict decision.
4. Require explicit overwrite/skip choices for modified files.
5. Write backups.
6. Apply changes.
7. Record audit rows and activity rows.
8. Offer rollback for OpenForge-created backups.
```

**Data persistence boundary pattern** (`2026-05-02-ai-cli-project-config-management-design.md` lines 345-357):
```markdown
## Data Persistence

Project files stay on disk as source of truth.

SQLite stores only:

- audit rows for preview/apply/rollback
- backup metadata
- optional last selected AI config tab/form state
- optional hash of OpenForge-managed file versions

SQLite must not store plaintext config secrets or full global config content.
```

**Research rollback scenarios** (`05-RESEARCH.md` lines 239-249):
```markdown
### Pattern 3: Rollback-As-Architecture

- Remote feature disabled after target records exist. Local projects and sessions still load as `local`.
- Host key mismatch appears after a target was trusted. Existing local sessions still work; remote launch/test returns `host_key_mismatch`.
- Remote agent missing or unsupported. Project import/session launch fail before tmux state with `remote_agent_missing` or `remote_agent_version_unsupported`.
- Remote target table/migrations exist but are ignored by an older local runtime. The design should require nullable/default-local fields for future implementation.
- Codex `/turn` remains disabled and Web does not expose send controls during rollback or local-first operation.
```

**Apply:** create rollback plan sections: `Purpose`, `Local-Safe Invariants`, `Feature Disablement`, `Future Migration Rules`, `Failure Scenarios`, `Operator Rollback Procedure`, `Data Retention And Redaction`, `Verification Checklist`, `Non-Goals`. It must state that later data model additions are nullable/default-local; remote target records can be ignored by local runtime; disabling remote launch does not break existing local sessions; terminal scrollback stays in tmux; Codex `/turn` remains disabled unless separately designed.

---

### `docs/reports/remote-execution-architecture-verification-2026-05-21.md` (docs/report, validation evidence)

**Analog:** `.planning/phases/OF-04-feishu-project-manager-ledger/04-VERIFICATION.md` and `docs/reports/post-beta-release-gates-2026-05-10.md`

**YAML frontmatter verification pattern** (`04-VERIFICATION.md` lines 1-33):
```markdown
---
phase: OF-04-feishu-project-manager-ledger
verified: 2026-05-20T16:56:49Z
status: passed
score: 32/32 must-haves verified
re_verification: false
overrides_applied: 0
requirements_verified:
  - PM-01
automated_checks:
  - command: "pnpm --dir packages/gateway test ..."
    result: "passed ..."
gaps: []
human_verification: []
notes:
  - "..."
---
```

**Observable truths pattern** (`04-VERIFICATION.md` lines 42-52):
```markdown
## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Work item and ledger tables are tenant-scoped and migration-backed. | VERIFIED | `project_manager_goals`, ... |

**Score:** 32/32 must-haves verified
```

**Requirement coverage pattern** (`04-VERIFICATION.md` lines 54-60):
```markdown
### Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| PM-01 | VERIFIED | Phase 2 is complete in `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md`... |
```

**Command/result table pattern** (`docs/reports/post-beta-release-gates-2026-05-10.md` lines 38-61):
```markdown
## Verification

Commands run from the repository root unless noted:

| Command | Result |
| --- | --- |
| `git diff --check` | Pass |
| `pnpm -r test` | Pass: CLI 64 tests, Web 106 tests, Gateway 385 tests... |
| `pnpm smoke:codex-app-server` | Pass: real app-server WebSocket initialize-only smoke, `promptOrTurnSent: false`... |
```

**Caveat/notes pattern** (`post-beta-release-gates-2026-05-10.md` lines 62-77):
```markdown
## Notes

- The first sandboxed Playwright and Gateway route-test runs failed on local
  server paths...
- Physical Windows/WSL smoke was not run in this environment...
- No Codex prompt/turn input was enabled.
```

**Validation strategy commands to copy** (`05-VALIDATION.md` lines 37-45):
```markdown
| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
| 05-01-01 | 05-01 | 1 | REM-01 | REM-T01..REM-T10 | Remote architecture package covers execution targets... | docs/static | `rg -n "host_key_mismatch|ssh_auth_failed|remote_agent_missing|remote_path_denied|remote_terminal_attach_failed|rollback" docs/superpowers/specs docs/reports` | present | pending |
| 05-01-03 | 05-01 | 1 | COD-01 | REM-T09 | Codex app-server `/turn` remains disabled by default... | automated/static | `pnpm --dir packages/gateway test test/codex-app-server-routes.test.ts` and `pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line` | present | pending |
```

**Apply:** create a verification report with frontmatter, `Goal Achievement`, `Requirements Coverage`, `Artifact Verification`, `Static Scope Checks`, `Focused Test Evidence`, `Manual Interpretation`, `No Runtime Code Evidence`, `Caveats`, `Gaps Summary`. Record exact command outputs or exact skip/failure reasons. For static grep, classify matches as `deferred/boundary text`, `expected current code`, or `scope leak`; do not blindly require zero matches because existing docs intentionally mention deferred remote/cloud/Codex-turn scope.

## Shared Patterns

### Docs-Only Scope Guard
**Source:** `05-CONTEXT.md` lines 19-23, 64-67; `05-RESEARCH.md` lines 212-219.
**Apply to:** all Phase 5 artifacts.

```markdown
- **D-01:** Treat Phase 5 as a design and security architecture phase only. It should produce docs/spec artifacts, not runtime code paths.
- **D-02:** Preserve OpenForge's product wedge as a local-first AI CLI control plane.
```

Planner should explicitly prohibit edits under `packages/gateway/src`, `packages/web/src`, database migrations, runtime terminal transports, and Web UI for this phase except read-only/static verification.

### Gateway/Web And Terminal Contract
**Source:** `CLAUDE.md` lines 58-94; `docs/API.md` lines 1404-1488; `packages/gateway/src/websocket/terminal.ts` lines 19-21, 153-343.
**Apply to:** architecture spec and threat model.

```typescript
export type TerminalMessage =
  | { type: "terminal_input"; payload: { data: string } }
  | { type: "terminal_resize"; payload: { cols: number; rows: number } };
```

Browser message shapes remain unchanged. Remote execution must sit behind Gateway target transport and still enforce JWT, attach token, ownership, one active socket, heartbeat, message-size checks, and input-rate limit.

### No Shell String Construction
**Source:** `docs/TECH-ARCHITECTURE.md` lines 32-52; `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` lines 73-90, 176-178.
**Apply to:** architecture spec, threat model, rollback plan.

```typescript
interface LaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  secretEnvNames: string[];
  credentialMode: "stored_encrypted_key" | "host_environment";
}
```

Remote design must use explicit typed remote-agent operations. Do not document raw `ssh host "tmux ..."` as an acceptable implementation path.

### Credential, Host-Key, And tmux Persistence Boundary
**Source:** `docs/superpowers/specs/2026-05-11-ssh-remote-execution-design.md` lines 269-285; `docs/TECH-ARCHITECTURE.md` lines 965-998; `CLAUDE.md` lines 80-86.
**Apply to:** architecture spec, threat model, rollback plan.

```markdown
Required rules:
- Never set `StrictHostKeyChecking=no`.
- Pin the server host key fingerprint on first successful explicit user approval
  or require the user to provide the expected fingerprint before the first connection.
- Treat host key mismatch as a hard error that requires user action.
- Prefer OS `ssh-agent` or a user-selected key path for the first release.
```

Secrets must not be copied from local provider config to remote targets. Remote CLI account state stays remote. Terminal scrollback remains tmux-backed, not SQLite.

### Diagnostics Redaction
**Source:** `packages/gateway/src/services/diagnostics.ts` lines 129-173 and 259-278; `docs/API.md` diagnostics contract as cited in `04-PATTERNS.md`.
**Apply to:** threat model, rollback plan, verification report.

```typescript
export function redactDiagnosticValue(value: unknown, key = ""): unknown {
  if (sensitivePattern.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    if (sensitiveValuePattern.test(value)) {
      return "[redacted]";
    }
    return value;
  }
```

Remote diagnostics may include bounded target type/id/state, host-key state, agent version, dependency status, adapter discovery status, and stable error codes. They must not include private keys, passphrases, raw SSH stderr, bearer tokens, attach tokens, terminal transcripts, or full sensitive paths.

### Codex App-Server Turn Boundary
**Source:** `docs/reports/codex-app-server-architecture-2026-05-06.md` lines 96-107; `packages/gateway/src/routes/codex-app-server.ts` lines 205-231 and 334-340; `packages/web/e2e/codex-app-server.spec.ts` lines 16-45.
**Apply to:** architecture spec, threat model, verification report.

```typescript
if (!isTurnInputEnabled(options)) {
  res.status(403).json({
    code: 1,
    message: "Codex app-server turn input is disabled",
    details: {
      feature: "codex_app_server_turn_input",
      enableWith: "OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1"
    }
  });
  return;
}
```

Phase 5 must not enable Web prompt/turn input, transcript persistence, or remote Codex app-server control-plane support. Verification should preserve the Web E2E expectation that prompt/turn/send controls are absent and no `/turn` path is requested.

### Static Scope Verification
**Source:** `05-RESEARCH.md` lines 337-345; `05-VALIDATION.md` lines 37-45 and 58-64.
**Apply to:** verification report.

```bash
rg -n "/api/v1/execution-targets|executionTargetId|SshAgentTerminalTransport|remote_agent|StrictHostKeyChecking=no|UserKnownHostsFile=/dev/null" packages/gateway/src packages/web/src
rg -n "OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1|/turn|promptInputExposed: true|send prompt|turn input" docs packages -g '!node_modules'
rg -n "cloud deployment|hosted telemetry|billing|marketplace|cloud worker" docs packages -g '!node_modules'
```

Treat static output as evidence requiring interpretation. Existing deferred/boundary references are allowed; runtime code additions or docs that present future routes as current implementation are scope leaks.

## No Analog Found

None. The repo already has strong analogs for architecture specs, security/trust-boundary tables, rollback/runbook structure, and verification reports.

## Metadata

**Analog search scope:** `docs/superpowers/specs`, `docs/reports`, `.planning/phases/OF-04-feishu-project-manager-ledger`, `CLAUDE.md`, `docs/API.md`, `docs/TECH-ARCHITECTURE.md`, `packages/gateway/src/websocket`, `packages/gateway/src/services/diagnostics.ts`, `packages/gateway/src/routes/codex-app-server.ts`, `packages/web/e2e/codex-app-server.spec.ts`

**Files scanned:** 50+ docs/source/test paths via `find`, `rg`, and targeted line-numbered reads. Strong analog extraction stopped after the SSH spec, Feishu/Copilot spec, AI config rollback spec, release rollback plan, Codex app-server architecture note, Phase 04 verification report, and focused current code boundaries.

**Project-local skills:** no `.codex/skills/` or `.agents/skills/` directories found in this checkout.

**Pattern extraction date:** 2026-05-21
