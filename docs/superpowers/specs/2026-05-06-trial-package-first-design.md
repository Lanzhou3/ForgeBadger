# Trial Package First Design

Date: 2026-05-06
Status: Draft for review
Scope: A stage of the A -> B -> C roadmap

## Roadmap Context

The next development sequence is:

1. A: release closure for first-user trial.
2. B: core experience polish.
3. C: capability expansion.

This spec covers A only. B and C must not start until A has a clear readiness
decision. A is not a public release process; it is a first-user trial package
that proves local users can install, start, exercise, and report OpenForge.

## Goal

OpenForge should be ready for a small first-user trial. A trial user should be
able to install or start the app locally, follow a short guided path, run a real
browser terminal session, export diagnostics if needed, and submit actionable
feedback.

The primary trial path is npm/CLI startup. Source startup remains the developer
fallback for debugging and local contribution.

## Non-Goals

A does not include:

- Hosted collaboration, cloud deployment, billing, or hosted marketplaces.
- Public release tagging, formal release notes, rollback process, or package
  registry publishing.
- Codex app-server prompt UI, JSON-RPC Web control-plane, or richer plugin
  executable/MCP/LSP execution.
- Broad UI/IA redesign beyond minimal first-run and trial guidance.
- Moving Gateway responsibilities into Next.js API routes.

## Users And Entry Paths

### Primary: npm/CLI Trial User

The user installs or unpacks the OpenForge package, runs `openforge doctor`,
starts OpenForge through the CLI, opens the Web console, and follows the first
run checklist.

The docs must state required local dependencies:

- Node.js compatible with the package.
- A local shell environment where OpenForge can bind loopback ports.
- `tmux`.
- Claude Code for the hard terminal smoke path.
- Optional OpenCode and Codex CLIs for later feature exploration only.

### Fallback: Source Trial Developer

The user clones the repository, installs dependencies, starts Gateway and Web in
development mode, and follows the same first-run checklist. This path is for
contributors and for reproducing trial defects.

## User Trial Flow

The trial flow is organized around observable user progress:

1. Install or start OpenForge.
2. Open `/login`.
3. Register or log in.
4. Create or import a local project.
5. Select the Claude Code template.
6. Preview and apply project config.
7. Create a Claude Code session.
8. Interact through the browser terminal.
9. Refresh the browser and reattach to the same session.
10. Export diagnostics.
11. Submit feedback with environment, command, screenshot/log, and reproduction
    details.

The real browser terminal path is the hard evidence gate for A. Real Claude Code
permission prompt notification is tracked as a caveat and first-user validation
focus because it can vary with Claude Code version and local user configuration.

## Deliverables

### 1. Trial Runbook

Create or update a single entry point for first-user trial startup. It should
cover:

- npm/CLI primary startup.
- source fallback startup.
- required dependencies and versions.
- required environment variables.
- default ports and how to change them.
- startup, shutdown, and cleanup commands.
- links to smoke checklist, diagnostics export, troubleshooting, and feedback
  template.

The runbook must not require users to read the full development plan before
starting.

### 2. Browser Terminal Smoke Report

Record real browser evidence for the terminal workflow. The report should
include:

- date and environment.
- browser name and version.
- Node, tmux, Claude Code, and OpenForge package/source versions.
- Gateway and Web ports.
- project path used for trial.
- terminal input/output observations.
- terminal resize behavior.
- refresh/reconnect result.
- stop-session behavior.
- Gateway/Web restart and session recovery result.
- browser console and network notes.
- screenshots or written observations for each terminal step.
- failures and follow-up defects.

This report is required before A can be marked ready.

### 3. First-Run Checklist

Create a concise checklist that first users can follow and attach to feedback.
It should cover:

- install/start.
- health checks.
- register/login.
- create/import project.
- config preview/apply.
- session create.
- browser terminal attach and interaction.
- refresh reconnect.
- diagnostics export.
- Claude permission prompt behavior if encountered.

### 4. Troubleshooting Guide

Add focused troubleshooting for the trial path:

- `tmux` missing or unusable.
- Claude Code missing or wrong version.
- loopback port binding failures or port conflicts.
- missing or weak `OPENFORGE_MASTER_KEY` / `OPENFORGE_JWT_SECRET`.
- database path not writable.
- WebSocket auth or terminal attach failures.
- restricted-sandbox Next/Turbopack build limitations.
- Skill discovery showing unexpected local sources.
- proxy interference with loopback HTTP checks.

Each entry should include symptom, likely cause, check command, and fix or
workaround.

### 5. Diagnostics And Feedback Template

Diagnostics export already exists as a local authenticated API. The trial flow
must make it easy for users to generate and attach diagnostics without uploading
anything automatically.

The feedback template should request:

- operating system and shell.
- startup path: npm/CLI or source.
- OpenForge version or commit.
- Node, tmux, Claude Code versions.
- diagnostics export.
- browser console/network observations.
- screenshots if useful.
- exact reproduction steps.
- expected and actual behavior.

### 6. Trial Readiness Gate

Create a readiness gate that maps evidence to the trial decision. It should
produce one of:

- `ready for first users`
- `ready with caveats`
- `blocked`

Known caveats must explain why they do not block first-user trial and what the
trial user should validate.

## Runtime Architecture

A does not change the runtime architecture:

- Gateway remains the only HTTP/WebSocket/API service.
- Web remains a pure Next.js console.
- Terminal remains Browser xterm -> Gateway WebSocket -> node-pty -> tmux ->
  Claude Code.
- npm/CLI startup wraps the same Gateway/Web components.
- Source startup is an equivalent development mode, not a separate product
  architecture.

## Error Handling Strategy

A should favor clear diagnosis over automatic repair.

Environment failures should be caught by `openforge doctor` or the runbook's
manual checks. Startup failures should point to port, environment, database, or
dependency causes. Terminal failures should ask users to collect session id,
browser console, network state, Gateway logs, and tmux/Claude observations.

Claude permission prompt behavior remains a caveat. The trial materials must
make this explicit and request real-user feedback, without presenting the hook
path as universally proven.

## Acceptance Gates

### Package Gate

- package build succeeds in an unrestricted environment.
- package verifier rejects credentials, local databases, caches, and user
  config directories.
- npm smoke startup succeeds with disposable state.
- `openforge doctor` output is recorded for required dependencies, including
  Node, tmux, Claude Code, and optional OpenCode/Codex CLI status.

### Source Gate

- source startup path reaches Web `/login`.
- Gateway `/api/v1/health` returns the standard success envelope.

### Regression Gate

- Gateway tests pass.
- Web tests pass.
- Gateway typecheck passes.
- Web typecheck passes.
- Gateway build passes.
- `git diff --check` passes.
- Web production build either passes in an unrestricted environment or is
  explicitly reported as restricted-sandbox-limited with separate evidence.

### Browser Terminal Gate

- real browser terminal attach succeeds.
- real terminal interaction is recorded.
- terminal resize is exercised and recorded.
- browser refresh/reconnect succeeds.
- session stop behavior is exercised and recorded.
- Gateway/Web restart recovery is exercised and recorded.
- evidence report records environment, commands, observations, and failures.

### Trial Docs Gate

- runbook exists and links all trial materials.
- first-run checklist exists.
- troubleshooting guide exists.
- feedback template exists.
- diagnostics export instructions exist.
- caveats are explicit.

## B And C Transition Gates

B may start only after A has a readiness decision. If A is `blocked`, B starts
only after blockers are fixed. If A is `ready with caveats`, B can start while
caveats remain tracked only if they are not terminal-core blockers.

C may start only after B's core user-flow issues are triaged and after Codex
app-server or JSON-RPC expansion has a focused architecture review. C must not
weaken the existing tmux terminal boundary.

## Testing Plan

Use the existing split between automated and manual evidence:

- Unit/integration tests for Gateway and Web behavior.
- Package verifier and smoke scripts for package contents and startup.
- Source startup smoke for developer fallback.
- Manual real browser smoke for terminal behavior.
- Manual caveat tracking for real Claude Code permission prompt behavior.

The final A audit must map every deliverable and acceptance gate to concrete
evidence before declaring the trial package ready.
