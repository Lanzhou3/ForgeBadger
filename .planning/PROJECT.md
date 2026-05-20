# OpenForge

## What This Is

OpenForge is a local-first AI programming IDE control platform for developers who run AI CLI tools such as Claude Code, OpenCode, and Codex on their own machine or development host. The product combines a Gateway service and a Web console for project setup, config injection, session management, terminal access, provider/model management, Copilot assistance, Feishu collaboration entry points, diagnostics, and release evidence.

The current product stage is v1.0 Post-Beta Trust Closure, archived on 2026-05-20. The next milestone should remove the remaining real-world beta caveats with live-provider, physical Windows/WSL, and completed first-user feedback evidence before broad runtime expansion.

## Core Value

Developers can reliably control and recover local AI CLI coding sessions from a browser without losing tenant isolation, credential boundaries, terminal persistence, or auditability.

## Requirements

### Validated

- [x] Local-first Gateway/Web split with all product APIs under `/api/v1`.
- [x] tmux-backed terminal persistence with browser reconnect and Gateway restart recovery.
- [x] Project create/import, config preview/apply, templates, Agents, Skills, model/provider management, and diagnostics have shipped with repository tests and smoke reports.
- [x] Codex Background Tasks are accepted only as an observable control-plane prototype; Web prompt/turn input remains disabled by default.
- [x] Platform AI Copilot first-release contract is provider-backed, read-heavy, approval-gated, tenant-scoped, redacted, and regression-gated.
- [x] Feishu integration supports safe diagnostics, tenant configuration, user mappings, approval-gated outbound actions, and a guarded inbound command bridge.
- [x] v1.0 closed stale release/source-of-truth drift and aligned post-beta documentation with the merged PR #2 state.
- [x] v1.0 recorded live-provider, physical Windows/WSL, and first-user evidence as explicit caveats with owners and rerun paths instead of false pass claims.
- [x] v1.0 implemented public Feishu webhook boundary controls with raw-body signature verification, replay/rate persistence, fail-closed policy gates, redaction, and audit rows.
- [x] v1.0 hardened dependency, adapter, provider, Settings, Copilot, and Web E2E failure states for first-user recovery.
- [x] v1.0 added a tenant-scoped project-manager ledger backend with atomic audit writes, safe diagnostics, and Copilot read tools.
- [x] v1.0 produced a remote execution architecture, threat model, rollback plan, and verification report while keeping runtime implementation deferred.

### Active

- [ ] Plan v1.1 around the remaining external beta evidence: disposable live Copilot provider smoke, physical Windows/WSL terminal smoke, and completed first-user feedback.
- [ ] Decide public Feishu live exposure readiness, including real developer-console callback verification, encrypted payload policy, and shared replay/rate storage for multi-instance deployment.
- [ ] Decide whether the project-manager ledger needs a first-class Web workflow or remains a Copilot/diagnostics support surface.
- [ ] If remote execution is prioritized, plan implementation from the Phase 5 architecture package with SSH target registry, remote agent protocol, terminal transport, and rollback gates.

### Out of Scope

- Hosted collaboration, cloud deployment, billing, hosted marketplace, and telemetry — require separate architecture and security review.
- Autonomous remote execution, raw shell execution, direct filesystem writes, unattended terminal control, or self-directed coding loops — outside the current local-first beta scope.
- Codex app-server Web prompt/turn workflow — `/turn` stays default-disabled behind `OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1` and is not a user-facing workflow.
- Provider API-key/model override injection for Codex launch paths — Codex remains subscription/SDK-managed.
- Feishu free-form approvals, Feishu terminal input, or Feishu as execution authority — Feishu is only a controlled collaboration channel into Copilot.
- SSH/remote execution runtime implementation — now architecture-reviewed, but still not part of the local-first beta unless selected as a separate future milestone.

## Context

- Source of truth docs: `CLAUDE.md`, `MEMORY.md`, `docs/DEVELOPMENT-PLAN.md`, `docs/TECH-ARCHITECTURE.md`, `docs/TEST-PLAN.md`, `docs/CI-CD-PLAN.md`, `docs/API.md`, and the relevant `docs/reports/*.md`.
- Approved post-RC sequence was A -> B -> C: close local-first RC evidence, guarded Codex app-server prototype, then product experience hardening.
- PR #2 (`post-beta-release-gates`) merged on 2026-05-19 after Copilot/Feishu release-gate hardening and green remote CI.
- v1.0 Post-Beta Trust Closure is archived in `.planning/milestones/` with a passed milestone audit and 23/23 traced requirements satisfied.
- Remaining acceptance gaps are explicit external evidence caveats and later-scope product decisions, not broad local implementation gaps.
- GSD planning is ready for the next milestone cycle. Root `MEMORY.md` remains the project progress memory for non-GSD sessions.

## Constraints

- **Architecture**: Gateway owns HTTP/WebSocket/API behavior; Web remains a pure SPA client.
- **API**: REST endpoints stay under `/api/v1` and use `{ code, data, message }` / `{ code, message, details }` envelopes.
- **Terminal**: tmux is the persistence layer; terminal history is recovered from tmux, not SQLite.
- **Security**: all tenant-owned rows require `user_id` scoping; all boundary inputs require schema validation; no hardcoded secrets or secret logs.
- **Credential Boundary**: stored provider keys are encrypted; Codex subscription-managed flows do not consume provider API keys.
- **Product Scope**: first-user trust, local diagnostics, and release evidence outrank new autonomous or hosted capabilities.
- **Evidence**: do not remove caveats until the documented real-host/manual evidence exists.
- **Testing**: CI-green is not sufficient when release docs require a real provider, real terminal, or physical platform smoke.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Preserve local-first AI CLI control plane as the product wedge | The strongest validated value is reliable browser control over local AI CLI sessions | Good |
| Keep Codex app-server as observable prototype only | Prompt/turn workflows add transcript, retention, and autonomy risks | Good |
| Treat Copilot as approval-gated assistant, not autonomous agent | Reduces blast radius while still enabling operational help and bounded proposals | Good |
| Treat Feishu as collaboration ingress, not execution authority | Prevents chat messages from becoming terminal or approval control | Good |
| Close external evidence before expanding scope | CI-green is not enough for live provider, physical Windows/WSL, or first-user trust | Good - caveats preserved and next actions recorded in v1.0 |
| Track SSH/remote execution separately | Remote execution changes threat model and should not be bundled into local beta hardening | Good - Phase 5 kept it architecture-only |
| Require public Feishu ingress to fail closed before exposure | Chat input must not become approval, terminal, or cross-tenant authority | Good |
| Keep project-manager state OpenForge-owned | Ledger events need auditability and tenant scope, not Feishu text authority | Good |

---
*Last updated: 2026-05-21 after v1.0 milestone close.*
