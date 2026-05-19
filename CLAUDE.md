# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenForge is an AI programming IDE control platform. It provides a unified Web console to manage AI CLI instances (Claude Code, OpenCode, Codex), handling project scaffolding, configuration injection, session management, and agent orchestration.

**Architecture:** Gateway service (Node.js/Express) + Web console (Next.js App Router). The Gateway runs as a background service managing all AI CLI instances via tmux + node-pty. The Web console is a pure SPA that communicates with the Gateway over HTTP and WebSocket.

**Current Phase:** MVP-8 through MVP-10 are implemented to local-first release-candidate/user-test-ready status, and the Phase A release evidence is accepted as of 2026-05-07 by the real browser terminal smoke and real Claude Code permission prompt reports. Phase B Codex Background Tasks are accepted for beta feedback as a guarded observable control-plane prototype: Web does not expose prompt/turn input, `/turn` remains a default-disabled feature-flag Gateway route, and Codex launch paths stay subscription/SDK-managed instead of provider API-key/model managed. MVP-8 added a repeatable local smoke command planner and refreshed regression gate; MVP-9 added a guarded Gateway-only Codex app-server lifecycle prototype; MVP-10 added local diagnostics export, npm package build/verify/smoke evidence, and a release risk register. Server-persisted notifications, cross-device read state, browser notification opt-in, Agent/session activity streams, gated Claude/OpenCode/Codex session launching, remote catalog refresh, session snapshots and restore, usage analytics, local Skill and plugin command discovery/rescan with root diagnostics, session-scoped Claude Code permission notification hooks, plugin materialization and plugin purpose copy, role-scoped library visibility with Web controls, audit visibility, admin member/role management, Agent quick-create templates, Skill quick-create templates, project config compliance reporting, catalog template install, catalog Skill/plugin install, CLI init bootstrap, project Agent orchestration sequence planning, session history/snapshot Web UI, usage/cost settings Web UI, shared library governance UI, terminal focus mode, sidebar keyboard toggle, command palette prototype, release plan, CI/CD workflow, manual smoke checklist, scaffold docs/rules/guard hooks, one-click default Agent pack, template creation from existing project config, direct Skill source install hardening, local role-model ADR, Codex app-server control-plane routes, and diagnostics export are implemented with focused automated coverage. Auth, SQLite repositories, config generation, API key encryption, terminal WebSocket safety, Web console shell, model CRUD/default, API Key create/rotate/delete, model/key-aware session launch, template clone/edit/apply/import/export/version history, Agent CRUD/injection, Skill CRUD/project enablement/source installation, Dashboard summary/health, model readiness checks, external endpoint health checks, Agent permission preview, Skill content preview, Claude Code plugin enablement, adapter discovery, global `/ws/events`, and cache refresh are implemented. Future hosted collaboration, cloud deployment, billing, hosted marketplaces, autonomous remote execution, Web prompt input for Codex app-server, SSH/remote execution, and richer plugin executable/MCP/LSP package execution require a separate architecture review. The current follow-up focus is beta release gates, physical Windows/WSL evidence, and Phase C first-user hardening. See `MEMORY.md`, `docs/MVP-0-ACCEPTANCE.md`, `docs/reports/gate-d-mvp0-acceptance-2026-04-29.md`, `docs/API.md`, `docs/MVP-1-TASKS.md`, `docs/MVP-2-TASKS.md`, `docs/MVP-3-TASKS.md`, `docs/MVP-4-TASKS.md`, `docs/MVP-5-TASKS.md`, `docs/MVP-6-TASKS.md`, `docs/MVP-7-TASKS.md`, `docs/MVP-8-TASKS.md`, `docs/MVP-9-TASKS.md`, `docs/MVP-10-TASKS.md`, `docs/reports/regression-2026-05-06.md`, `docs/reports/release-candidate-2026-05-06.md`, `docs/reports/beta-handoff-2026-05-10.md`, `docs/reports/phase-b-codex-app-server-acceptance-2026-05-10.md`, `docs/RELEASE-PLAN.md`, `docs/CI-CD-PLAN.md`, and `docs/SMOKE-TEST.md`.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16 (App Router), shadcn/ui, Tailwind CSS, TypeScript |
| Gateway | Node.js 20+, Express, TypeScript |
| Terminal | xterm.js, WebSocket (`ws`), node-pty, tmux |
| Database | SQLite (better-sqlite3), Drizzle ORM + drizzle-kit |
| Auth | JWT (jsonwebtoken) + bcrypt |
| Encryption | AES-256-GCM (API Key storage) |
| Tests | Vitest (frontend), node:test (backend) |
| Package Manager | pnpm (monorepo workspace) |

## Common Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Start all packages in dev mode
pnpm -r dev

# Run all tests
pnpm -r test

# Gateway specific
cd packages/gateway
npx drizzle-kit generate      # Generate DB migration
npx drizzle-kit migrate       # Run DB migration
npx tsx src/index.ts          # Start Gateway directly
pnpm test [pattern]           # Run backend tests (node:test)

# Web specific
cd packages/web
pnpm dev                      # Start Next.js dev server
pnpm vitest run [pattern]     # Run frontend tests
```

## High-Level Architecture

### Terminal Data Flow (Most Critical Path)

The terminal is the most complex cross-layer component in this project. Understanding the full data flow requires reading multiple files:

```
Browser xterm.js
    |
    | WebSocket (UTF-8 text frames)
    v
Gateway WebSocket Server (ws)
    |
    | node-pty.write(data) / node-pty.on('data')
    v
node-pty (spawns `tmux attach -t <session>`)
    |
    | tmux client-server protocol
    v
tmux session (named: `of-{user_id_short}-{session_id_short}`)
    |
    | pty
    v
AI CLI process (claude / opencode / codex)
```

**Key Design Decisions (see `docs/TECH-ARCHITECTURE.md` §4 for details):**

- **tmux is the session persistence layer.** Gateway restarts do not kill CLI sessions. WebSocket disconnects do not stop CLI processes. Reconnection is achieved via `tmux attach`.
- **Terminal history is NOT stored in SQLite.** Deleted `terminal_logs` table per architecture review. History recovery uses `tmux capture-pane -e -S -500` to fetch scrollback from tmux itself.
- **Environment variable injection uses tmux `-e` flag.** No intermediate bash wrapper. API Keys are decrypted in Gateway memory and injected via `tmux new-session -e KEY=value`. This avoids signal forwarding issues and shell injection risks.
- **Single WebSocket per terminal session.** New connections kick out old ones to prevent multi-writer display corruption.
- **Gateway startup scans for orphan tmux sessions.** All `of-*` sessions are compared against the database; orphans are killed to prevent resource leaks.

### Gateway / Web Separation

Next.js does NOT serve API routes. The Gateway is a standalone Express application. Reasons:

- Gateway needs long-running WebSocket connections, pty process management, and tmux lifecycle control — responsibilities of a background service, not a serverless API route.
- Express is lighter and deploys as `node dist/server.js`.
- Frontend Next.js is purely a SPA. All API calls go to the Gateway.

### Multi-Tenant Isolation

Row-level isolation: every business table has a `user_id` foreign key with CASCADE delete.

- **API layer:** `authMiddleware` parses JWT and injects `req.userId` into all requests.
- **Data layer:** Repository classes automatically append `WHERE user_id = ?` to all queries. Business code does not manually filter by user.
- **tmux layer:** Session names include the user ID prefix to prevent cross-user session access.
- **Filesystem layer:** All path operations must use `safeResolve(baseDir, userPath)` to prevent directory traversal. See `docs/TECH-ARCHITECTURE.md` §4.6.2.

### Config Generation Engine

Used when creating projects or importing existing ones. Flow:

1. **Template Renderer** — Reads template files from `template_files` table, renders with project variables.
2. **Conflict Detector** — Checks if target files already exist. Generates a conflict report for user confirmation.
3. **Config Writer** — Backs up the target directory, writes new files, auto-rollback on error.

Claude Code, OpenCode, and Codex adapters can launch sessions when their local
commands are available. Gateway must gate launch by adapter discovery before
creating or starting tmux-backed sessions.

### AI CLI Adapter Interface

Defined in `packages/gateway/src/adapters/`. Each adapter implements:

- `getLaunchCommand(projectPath, options)` — How to start the CLI
- `generateConfig(project, template)` — Produce config files (e.g., `.claude/CLAUDE.md`)
- `scanProject(projectPath)` — Detect existing AI tool installations
- `formatAgentConfig(agent)` — Convert agent form data to CLI-specific format
- `formatSkillInjection(skill)` — Convert skill data to CLI-specific format

## API Conventions

All REST APIs are under `/api/v1`.

**Response envelope:**
```json
{ "code": 0, "data": {}, "message": "" }
{ "code": 1, "message": "error description", "details": {} }
```

**Auth:** JWT Bearer Token via `Authorization: Bearer <token>` header.

**HTTP Methods:** GET (query, idempotent), POST (create), PUT (full update), PATCH (partial update), DELETE (delete, idempotent).

**WebSocket paths:**
- `/ws/terminal/:sessionId` — Terminal I/O
- `/ws/events` — Real-time status push (session status, agent status, errors)

See `docs/TECH-ARCHITECTURE.md` §3 for the full API reference.

## WebSocket Message Format

```typescript
interface WSMessage {
  type: string;
  payload: Record<string, any>;
  id?: string;
}
```

**Terminal messages:**
- Client → Server: `{ type: "terminal_input", payload: { data: "..." } }`
- Server → Client: `{ type: "terminal_output", payload: { data: "..." } }`
- Resize: `{ type: "terminal_resize", payload: { cols: 120, rows: 40 } }`

**Heartbeat:** 30s ping/pong. 90s timeout disconnects.

## Development Workflow (Harness Engineering)

This project uses a 3-Gate review process. The workflow is enforced via `.claude/skills/` and `.claude/agents/`.

### Sub-Agent Boundaries

| Agent | Scope | Restriction |
|-------|-------|-------------|
| `backend-dev` | API, services, DB, migrations | Do not touch frontend files (`*.tsx`, `*.jsx`, CSS) |
| `frontend-dev` | Pages, components, API client hooks | Do not touch backend files (`src/server/**`, `src/services/**`, `src/repository/**`) |
| `test-writer` | Tests, test execution reports | Reports bugs, does not fix implementation |
| `code-reviewer` | Gate 1/2/3 reviews | Read-only |
| `doc-sync` | Documentation updates | Does not modify code files |
| `business-analyst` | Codebase analysis | Read-only |

### Three-Gate Flow

```
Requirement → Gate 1 (Plan Review) → Step 2 (Implementation)
            → Gate 2 (Implementation Review) → Step 3 (Testing)
            → Gate 3 (Zero-Trust Acceptance) → Step 4/5 (Docs + Commit)
```

**Rules:**
- Gate 1 must pass before implementation starts.
- Backend and frontend are implemented in dependency order. Frontend cannot start before backend API is ready.
- Backend uses TDD: write failing test first, then implementation.
- After test failures are fixed, you must re-run Gate 2 before proceeding.
- One commit per logical change. Format: `<type>: <description>` (types: feat, fix, refactor, perf, docs, test, chore, ci).

**Process scaling:**
- Complex (cross-module): Full flow (Gate 1→2→3)
- Simple (single file): Step 2 → Gate 2 → Step 3
- Hotfix: Quick fix → verify → deploy → retroactive review
- Pure docs: doc-sync directly

## Security Rules (from `.claude/rules/`)

**Hardcoded secrets are absolutely forbidden.** API keys, tokens, database passwords, JWT secrets, and private keys must come from environment variables.

**Input validation is mandatory at all boundaries.** Use schema validation (zod) for API parameters. Use parameterized queries — string concatenation in SQL is forbidden.

**API Key storage:** Encrypted with AES-256-GCM. The master key is read from `OPENFORGE_MASTER_KEY` environment variable; prefer a 64-character hex key from `openssl rand -hex 32`, while legacy 32-byte strings remain supported for existing local installs. Keys are decrypted in Gateway memory and injected into CLI processes via environment variables. Plaintext keys are never written to disk, logs, or the database.

**Path safety:** All filesystem operations must validate paths with `safeResolve(baseDir, userPath)` to prevent directory traversal. Symlinks must be resolved with `fs.realpathSync()` and checked against allowed prefixes. Sensitive system paths (`/etc`, `/proc`, `/sys`, `/root`) are rejected regardless of prefix match.

**Log safety:** Never log passwords, tokens, or API keys.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENFORGE_PORT` | No | 3000 | Gateway HTTP/WebSocket port |
| `OPENFORGE_DB_PATH` | No | `~/.openforge/openforge.db` | SQLite database path |
| `OPENFORGE_MASTER_KEY` | Yes | — | AES-256-GCM encryption key, preferred 64 hex characters |
| `OPENFORGE_JWT_SECRET` | Yes | — | JWT signing secret |
| `OPENFORGE_LOG_LEVEL` | No | info | Log level |
| `OPENFORGE_TMUX_PREFIX` | No | `of-` | tmux session name prefix |

## Monorepo Structure

```
OpenForge/
├── packages/
│   ├── gateway/          # Express + WebSocket + node-pty + Drizzle
│   │   ├── src/
│   │   │   ├── index.ts              # Entry point
│   │   │   ├── server.ts             # Express server setup
│   │   │   ├── routes/               # REST API routes
│   │   │   ├── websocket/            # WS hub, terminal handler, events
│   │   │   ├── services/             # Business logic
│   │   │   │   ├── session-manager.ts   # tmux lifecycle
│   │   │   │   ├── terminal-proxy.ts    # I/O forwarding
│   │   │   │   ├── config-generator.ts  # Template rendering + conflict detection
│   │   │   │   ├── project-scanner.ts   # Detect existing AI tools
│   │   │   │   └── crypto.ts            # AES-256-GCM encrypt/decrypt
│   │   │   ├── adapters/             # AI CLI adapters (claude.ts first)
│   │   │   ├── db/                   # Drizzle schema + migrations + repositories
│   │   │   └── middleware/           # auth, error, tenant
│   │   └── package.json
│   └── web/              # Next.js 16 App Router
│       ├── src/
│       │   ├── app/                  # App Router pages
│       │   ├── components/           # React components (shadcn/ui)
│       │   ├── hooks/                # Custom hooks
│       │   └── lib/                  # Utils, API client, WS client
│       └── package.json
├── docs/                 # PRD, architecture, development plan
├── .claude/              # Agent definitions, rules, skills, hooks
├── pnpm-workspace.yaml
└── package.json
```

## Key Documents

| File | Purpose |
|------|---------|
| `docs/PRD-v1.1-MVP.md` | Product requirements, feature modules, P0/P1/P2 priorities |
| `docs/TECH-ARCHITECTURE.md` | Full architecture: data model, API design, terminal/pty/tmux details, ADRs |
| `docs/DEVELOPMENT-PLAN.md` | 26-day schedule, daily breakdown, milestones, risk mitigation |
| `.claude/settings.json` | Claude Code permissions and agent definitions |
| `.claude/rules/*.md` | Security, API, frontend, backend, testing rules |
| `.claude/agents/*.md` | Agent role definitions and constraints |
| `.claude/skills/*.md` | Workflow skills (plan, review, verify, commit) |
