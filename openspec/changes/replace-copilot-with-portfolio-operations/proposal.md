## Why

The current Copilot is a generic, conversation-centred tool loop and the current Project Manager board is not yet a durable portfolio workflow. Together they cannot safely act as the project-group manager: neither provides one canonical path from a user requirement to evidence-backed execution, owner-governed permissions, progress tracking, and channel delivery.

ForgeBadger now needs a clean replacement that treats project work, authorization, evidence, and delivery as tenant-scoped operational facts. The prior `add-project-manager-agent-control-loop` proposal is a useful implementation reference, but its Copilot entry point and compatibility period conflict with the accepted Clean Cutover direction.

## What Changes

- Introduce Portfolio Operations as the local-first project-group manager and the sole new control plane for explicitly enrolled projects.
- Add immutable Portfolio Requests, recorded Intake Decisions, Project Dossiers, and evidence-driven Project Manager workflow semantics.
- Add governed Task Attempts, deterministic Task Packets, assignment leases, three-tier Execution Authorizations, and acceptance decisions.
- Add Observation Profiles with platform facts and bounded Git-state probes, durable Workflow Wakeups, and an optional, default-off Portfolio Heartbeat.
- Add a native Feishu Channel Connector with bound identities, allowed conversation scope, signed single-use actions, and idempotent Outbox delivery.
- **BREAKING**: replace the `/api/v1/copilot/**` contract and generic Copilot runtime/state with `/api/v1/portfolio/**` and Portfolio Operations at a single Clean Cutover; no compatibility adapter, dual write, fallback read, or legacy-state migration is allowed. `/portfolio` is the complete primary workspace and `/copilot` is its Portfolio-only alias. The pet opens a Portfolio-only floating companion Dialog: its submitted text creates a Portfolio Request and it renders only persisted, safe Request status feedback. The alias and Dialog use Portfolio i18n and have no Copilot API or data dependency, model-chat behavior, or execution/terminal-write authority.
- **BREAKING**: retire the legacy Copilot-specific pending-action and conversation/run flow as an authority for project execution; legacy records are backed up and restore-tested separately, never imported into the new Canonical Record.

## Capabilities

### New Capabilities

- `portfolio-intake-workflow`: immutable requirement intake, project routing, dossiers, and the evidence-gated Project Manager Work Item lifecycle.
- `portfolio-governed-execution`: deterministic Task Packets, Task Attempts, assignment leases, three-tier authorization, and evidence-backed acceptance.
- `portfolio-observation-scheduling`: declared observations, evidence freshness, Risk Signals, Workflow Wakeups, and the user-configured default-off Heartbeat.
- `portfolio-feishu-channel`: authenticated Feishu ingress, identity and conversation binding, signed one-use action cards, and durable delivery projection.
- `portfolio-clean-cutover`: isolated replacement delivery, legacy inventory, backup/restore proof, and single-boundary Copilot removal requirements.

### Modified Capabilities

- None. `openspec/specs/` contains no accepted base capability specification. The in-progress `add-project-manager-agent-control-loop` change is superseded for this branch's target architecture and MUST NOT provide a compatibility obligation.

## Impact

- Gateway: new `portfolio` routes, services, repositories, forward schema/migrations, state controllers, event projections, scheduler claims, authorization, observations, and Feishu connector boundaries. The native Feishu connector adds a verified provider-account registry and tenant-scoped bindings behind one shared Gateway transport registry/selector; it never starts a parallel connection or ingress path.
- Web: add an isolated `/portfolio` Portfolio Operations workspace and evolve the Project Manager board into the canonical workflow view. At Cutover, `/portfolio` is primary and `/copilot` remains only as a Portfolio-only bookmark alias; the pet opens a Portfolio-only floating companion Dialog. Its text becomes a Portfolio Request, while immediate feedback is derived from durable safe Request state rather than a model-chat transcript. None may import, query, or recreate legacy Copilot state or runtime; the alias and Dialog use Portfolio i18n and cannot receive execution or terminal-write authority.
- Shared platform foundations: retain authentication, tenant-scoped repositories, redaction/audit, Event Bus, Outbox mechanics, Session Manager, tmux, adapter discovery, and CLI lifecycle hooks only where their invariants match this change.
- Removed at Cutover: `packages/gateway/src/services/copilot/**`, `packages/gateway/src/routes/copilot.ts`, `/api/v1/copilot/**`, legacy Copilot provider/conversation Web clients, types, events, and tests. The Portfolio-owned `/copilot` alias and pet-triggered floating companion Dialog remain as Web-only presentation. Historical Copilot persistence remains physically retained, with no runtime access, until the separately approved and restore-tested backup/export procedure is complete.
- Verification: transition, isolation, idempotency, restart/lease, bounded-probe, channel replay, permission bypass, real-tmux, Web E2E, and cutover inventory evidence.
