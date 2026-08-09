# AGENTS.md

This file provides repository instructions for AI coding agents working in OpenForge.

## Project Snapshot

OpenForge is an AI programming IDE control platform. It provides a local-first Web console for managing AI CLI instances (Claude Code, OpenCode, Codex): project scaffolding, configuration injection, session management, terminal access, model management, Agent/Skill/template management — plus an in-product AI Copilot, a guarded Codex app-server prototype, a Project Manager board, and a Feishu bridge.

Current phase: post-beta external-evidence closure and first-user trial operations. Phase state lives in `MEMORY.md` and `.planning/`; sequencing in `docs/DEVELOPMENT-PLAN.md` and `.planning/ROADMAP.md`.

## Source Of Truth

Read these documents before making non-trivial changes:

- `CLAUDE.md` - project overview, commands, architecture decisions, workflow rules
- `MEMORY.md` - current phase tracker, accepted evidence, next-work list (keep it updated)
- `.claude/CLAUDE.md` - Harness Engineering workflow and role boundaries
- `.claude/rules/*.md` - security, backend, frontend, API, and testing rules
- `.claude/skills/*.md` - plan, review, verify, and commit workflows
- `.claude/agents/*.md` - role-specific agent responsibilities
- `docs/PRD-v1.1-MVP.md` - product scope and P0/P1/P2 priorities
- `docs/TECH-ARCHITECTURE.md` - architecture, data model, terminal design, ADRs
- `docs/API.md` - API surface reference
- `docs/DEVELOPMENT-PLAN.md` - MVP schedule and module breakdown
- `docs/TEST-PLAN.md` - TDD strategy and test coverage requirements
- `docs/UI-DESIGN.md` - UI information architecture and visual design rules

If documents conflict, use this priority:

1. Direct user instruction for the current task
2. `CLAUDE.md` at repository root and `docs/TECH-ARCHITECTURE.md`
3. `.claude/CLAUDE.md`
4. `.claude/rules/*.md`
5. Other `docs/*.md`

OpenForge APIs must use the project envelope:

```json
{ "code": 0, "data": {}, "message": "" }
{ "code": 1, "message": "error description", "details": {} }
```

## Tech Stack

- Monorepo: pnpm workspace (`packages/*`), Node >= 20 (CI runs 22), pnpm pinned via `packageManager` (10.x)
- Gateway: Express, TypeScript ESM, `ws`, `node-pty`, `tmux`, SQLite (`better-sqlite3`), Drizzle ORM + `drizzle-kit`
- Web: Next.js 16 App Router, React 19, shadcn/ui, Tailwind CSS, xterm.js, TanStack Query, zod
- Auth: JWT (`jsonwebtoken`) + `bcryptjs`; API keys encrypted with AES-256-GCM
- Tests: `node:test` (backend), Vitest (frontend), Playwright (E2E)

## Common Commands

```bash
pnpm install
pnpm -r typecheck    # all packages (web typecheck runs `next typegen` first)
pnpm -r build
pnpm -r test         # runs each package's test script; does NOT cover scripts/*.test.mjs
pnpm -r dev          # gateway + web in parallel
```

Gateway (`packages/gateway`):

```bash
pnpm --dir packages/gateway test                        # all backend tests (node --test)
pnpm --dir packages/gateway test test/<file>.test.ts    # single test file
RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test       # enable real-tmux integration tests
pnpm --dir packages/gateway exec drizzle-kit generate   # schema change -> new migration
pnpm --dir packages/gateway dev                         # tsx watch
```

Web (`packages/web`):

```bash
pnpm --dir packages/web test <path/to/test>             # single vitest test
pnpm --dir packages/web dev
```

E2E (Playwright, `packages/web/e2e/*.spec.ts`) — the Gateway must already be running; Playwright's `webServer` only starts Next:

```bash
pnpm --dir packages/gateway exec tsx src/index.ts &      # gateway on OPENFORGE_PORT
pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium
```

Root script harness (`scripts/*.mjs`) — has its own tests, NOT covered by `pnpm -r test`; CI runs them explicitly:

```bash
node --test scripts/<file>.test.mjs
pnpm evidence:gates-validate    # external evidence gate registry drift guard
pnpm trial:intake-validate      # trial runbook/checklist contract guard
```

Published CLI pipeline (`packages/cli`, npm package `openforge` with `doctor`/`init`/`start`): `pnpm build:npm` -> `pnpm verify:npm` -> `pnpm smoke:npm`.

Do not claim completion without running the relevant verification command or clearly stating why it could not be run.

## Environment And Ports

- All dev/build/start scripts run through `scripts/run-with-root-env.mjs`, which loads the gitignored root `.env` and lets command-prefix env vars override it.
- The Gateway zod-validates env (`src/config/env.ts`) and refuses to start without `OPENFORGE_MASTER_KEY` and `OPENFORGE_JWT_SECRET`.
- Ports: Gateway default `3000`; web dev server default `48732`; the web SPA's default gateway URL is `http://127.0.0.1:48731`. Set `OPENFORGE_PORT=48731` (CI and root `.env` convention) or export `NEXT_PUBLIC_GATEWAY_URL`, otherwise web cannot reach the Gateway.

## Architecture Rules

OpenForge is split into:

- Gateway service: standalone Express HTTP/WebSocket server
- Web console: pure Next.js SPA that talks to Gateway over HTTP and WebSocket

Do not implement Gateway API behavior in Next.js API routes.

All REST APIs live under `/api/v1`. WebSocket paths:

- `/ws/terminal/:sessionId` for terminal I/O
- `/ws/events` for real-time status events

Terminal architecture is critical:

```text
Browser xterm.js
  -> WebSocket
  -> Gateway ws handler
  -> node-pty
  -> tmux attach
  -> AI CLI process
```

Required terminal decisions:

- `tmux` is the persistence layer.
- Gateway restart or WebSocket disconnect must not kill CLI sessions.
- Do not store terminal history in SQLite; use `tmux capture-pane -e -S -500`.
- Inject environment variables with `tmux new-session -e KEY=value`; do not use an intermediate shell wrapper.
- Allow only one active WebSocket per terminal session; a new connection replaces the previous one.
- On startup, scan `of-*` tmux sessions and kill orphan sessions that are not present in the database.

## Repository Structure

```text
packages/
  gateway/                       Express + WebSocket + node-pty + tmux + Drizzle
    src/
      index.ts, server.ts        entrypoints
      routes/                    REST /api/v1 handlers
      websocket/                 /ws/terminal/:sessionId, /ws/events
      services/                  business logic: session-manager, tmux, startup,
                                 adapter-discovery, catalog, codex-app-server,
                                 copilot/, integrations/
      adapters/                  AI CLI launch plans
      config/                    zod env schema (env.ts)
      config-generation/         template rendering / config writing
      auth/, crypto/, secrets/   JWT, AES-256-GCM, API key store
      db/                        schema, migrations, repositories
      runtime/                   start-gateway
      middleware/                auth, error handling, validation
      cli/                       `pnpm openforge` init bootstrap
  web/                           Next.js 16 App Router SPA
    src/app, components, hooks, lib
    e2e/                         Playwright specs
  cli/                           published npm package `openforge`; bundles the Gateway
scripts/                         root harness scripts + their own *.test.mjs
templates/                       bundled claude-code-best-practice template
docs/  .claude/  .planning/
```

Gateway ownership: API routes and handlers, services and business logic, repositories/schema/migrations, WebSocket hub and terminal proxy, CLI adapters, backend tests.

Web ownership: Next.js pages and layouts, React components, hooks, stores, API client, WebSocket client, frontend tests, styling.

Keep backend and frontend changes separated unless the task explicitly requires a full-stack change.

## Development Workflow

Use the Harness Engineering three-gate flow for substantial work:

```text
Requirement
  -> Gate 1 Plan Review
  -> Step 2 Layered Implementation
  -> Gate 2 Implementation Review
  -> Step 3 Testing
  -> Gate 3 Zero-Trust Acceptance
  -> Step 4/5 Docs + Commit
```

Scaling rules:

- Complex cross-module tasks: full Gate 1 -> Gate 2 -> Gate 3 flow
- Simple single-file changes: implement -> review -> test
- Hotfix: reproduce -> minimal fix -> verify -> document follow-up
- Pure docs: update docs directly, still verify file content

Backend work should follow TDD where practical: failing test first, implementation second, refactor third.

After fixing a test failure caused by implementation changes, re-review the implementation before claiming final acceptance.

## Agent Role Boundaries

When using role-based agents, keep these boundaries:

- `business-analyst`: read-only analysis; never modifies files
- `planner`: implementation planning before development
- `backend-dev`: Gateway/API/services/db/migrations/backend tests; does not touch frontend files
- `frontend-dev`: pages/components/hooks/API client/styles/frontend tests; does not touch backend internals
- `test-writer`: writes and runs tests; reports business defects but does not fix implementation
- `code-reviewer`: read-only Gate 1/2/3 review with file/line evidence
- `security-reviewer`: read-only security review for auth, input validation, data protection, common vulnerabilities
- `debugger`: reproduce first, identify root cause, then apply minimal fix
- `doc-sync`: updates documentation only; does not modify code files

Do not blur ownership boundaries to save time. If a task grows across boundaries, pause and split the work.

## Security Rules

Hardcoded secrets are forbidden: API keys and tokens, database passwords, JWT secrets, encryption keys, third-party credentials, private keys or certificates. Use environment variables and validate them with zod or equivalent.

Sensitive environment variables (validated in `packages/gateway/src/config/env.ts`):

- `OPENFORGE_MASTER_KEY` - required; 64 hex chars preferred, legacy 32-byte strings accepted
- `OPENFORGE_JWT_SECRET` - required, min 32 chars
- `OPENFORGE_PORT` - optional, default `3000`
- `OPENFORGE_HOST` - optional, default `127.0.0.1`
- `OPENFORGE_STATE_DIR` - optional, default `~/.openforge`
- `OPENFORGE_DB_PATH` - optional, default `~/.openforge/openforge.db`
- `OPENFORGE_TMUX_PREFIX` - optional, default `of-`, must match `^[a-zA-Z0-9_-]+$`

Input validation is mandatory at all boundaries:

- API params and bodies use schema validation, preferably zod
- SQL must use parameterized queries or ORM-safe APIs
- User-controlled HTML must be escaped
- File paths must be resolved through `safeResolve(baseDir, userPath)`
- Symlinks must be resolved with `fs.realpathSync()` and checked against allowed prefixes
- Reject sensitive system paths such as `/etc`, `/proc`, `/sys`, and `/root`

Never log passwords, tokens, API keys, decrypted secrets, or plaintext credentials.

## Backend Standards

- Keep functions focused and usually under 50 lines.
- Keep nesting under 4 levels; prefer early returns.
- API layer performs auth, validation, and routing only.
- Service layer owns business logic.
- Repository layer owns data access and tenant filtering.
- All business tables must be scoped by `user_id`; repositories automatically apply `WHERE user_id = ?`.
- Async operations must have meaningful error handling and contextual logging (fields like `userId`, `action`, `duration`, `timestamp`, without sensitive data).
- Do not concatenate shell commands or SQL with user input.

AI CLI adapter interface (`src/adapters/`):

- `createAdapterLaunchPlan(input)` returns a `LaunchPlan` (`{ command, args, cwd, env, secretEnvNames, credentialMode }`); `AdapterId = "claude" | "opencode" | "codex"`.
- Session launch must be gated by `adapter-discovery` (available + launch-enabled + terminal support) before creating tmux-backed sessions.
- Claude is the fully implemented adapter; opencode/codex have basic launch plans. The Codex app-server control plane is a guarded prototype: `/turn` is default-403 unless the Gateway starts with `OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1`, and Web must not expose prompt/turn input.

## Frontend Standards

Use the UI direction from `docs/UI-DESIGN.md`:

- Dark theme first, professional developer tooling style
- Dense, functional layouts inspired by VS Code, Linear, Vercel Dashboard, GitHub Codespaces
- Terminal is the core differentiated screen
- Desktop gets full management functionality
- Mobile is for status viewing and simple operations; do not assume full terminal use

React conventions:

- Component names use PascalCase; files use `ComponentName.tsx`; prefer `interface Props` before the component.
- Hooks start with `use`, have one responsibility, complete dependency arrays, and clean up side effects.
- Use React Query or equivalent for server state; handle loading, empty, and error states.
- Lists must have stable keys; virtualize large lists when needed.
- Use Tailwind CSS or local component styles; avoid inline styles unless unavoidable.
- Use shadcn/ui and lucide-react where appropriate.

Navigation should follow the documented information architecture:

- `/` dashboard, `/projects`, `/projects/new`, `/projects/import`, `/projects/:id`
- `/sessions`, `/sessions/:id`, `/agents`, `/skills`, `/templates`, `/models`, `/settings`

## API And WebSocket Standards

REST:

- `GET` for idempotent queries, `POST` for create/action, `PUT` for full update, `PATCH` for partial update, `DELETE` for idempotent delete
- JWT Bearer auth via `Authorization: Bearer <token>`

WebSocket message format:

```ts
interface WSMessage {
  type: string;
  payload: Record<string, any>;
  id?: string;
}
```

Terminal messages:

- Client to server: `{ type: "terminal_input", payload: { data: "..." } }`
- Server to client: `{ type: "terminal_output", payload: { data: "..." } }`
- Resize: `{ type: "terminal_resize", payload: { cols: 120, rows: 40 } }`

Heartbeat: 30 second ping/pong, 90 second timeout disconnect.

Connection safety:

- Authenticate WebSocket connections.
- Enforce tenant isolation on terminal and event channels.
- Enforce single active terminal connection per session.
- Limit message size, input rate, total connections, and per-user connections.

## Testing Standards

Use `docs/TEST-PLAN.md` as the test source of truth. Test structure follows Arrange, Act, Assert:

```ts
describe("module", () => {
  describe("method", () => {
    it("does the expected behavior", () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

Coverage targets:

- Core business logic: 80%+
- Crypto service: higher coverage, especially auth tag and key length errors
- WebSocket terminal layer: high coverage for auth, reconnect, ordering, limits, and isolation
- Error paths and boundary cases are required

Mocking rules:

- Mock external dependencies for unit tests; do not mock internal implementation to make tests pass.
- tmux/node-pty integration tests use real `tmux` (they skip unless `RUN_TMUX_TESTS=1`).
- Use in-memory SQLite for database integration tests where appropriate.

Important security and correctness cases to cover:

- JWT `alg:none` rejection, multi-tenant isolation, SQL injection attempts
- Path traversal including encoded Unicode variants, symlink escape prevention
- XSS escaping for Skill/template content, API key encryption at rest
- WebSocket flood/rate/message-size limits, terminal output ordering

## Product Scope Priorities

P0 MVP includes:

- User auth and multi-tenant isolation
- Database schema, migrations, repositories
- Project creation/import and config generation
- Claude Code template support
- Session dashboard, session creation, terminal, session status
- Agent list and basic creation, Skill list and enable/disable
- Template list and editing
- Model list, model switching, model creation, API key management

P1/P2 features should not be pulled into MVP unless explicitly requested.

## Git And Documentation

Commit format:

```text
<type>: <description>
```

Allowed types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `ci`.

Rules:

- One logical change per commit; title under 50 Chinese characters or an equivalently short English sentence; explain why in the body when needed.
- Before committing, review `git diff --staged` and recent history.
- Run typecheck, relevant tests, and build before commit, or state exactly what was not run. (No lint script exists.)

Repository gotchas:

- `.gitignore` ignores most of `docs/` and `.claude/`; only whitelisted files are tracked. A new file under `docs/` will not be committed without adding a `!docs/...` exception. `opencode.json`, `AGENTS.local.md`, `AGENTS.override.md`, and `.codex/` are ignored as local-override conventions.
- Some doc files are machine-validated (trial runbook/checklist, external evidence gate registry). Editing them can break CI: rerun `pnpm evidence:gates-validate`, `pnpm trial:intake-validate`, and the matching `node --test scripts/<name>.test.mjs`.

Documentation must be updated when behavior, architecture, workflow, or phase status changes. Phase/state changes belong in `MEMORY.md` and `.planning/`; handoff notes belong in `CLAUDE.md`.

## Hard Red Lines

Do not:

- Hardcode secrets
- Log sensitive data
- Concatenate SQL strings
- Trust user input at API, HTML, shell, path, or WebSocket boundaries
- Use `any` where a specific type is reasonable
- Add Next.js API routes for Gateway responsibilities
- Store terminal logs in SQLite
- Use shell wrappers for secret injection into CLI sessions
- Skip tenant filtering
- Skip validation because "frontend already validates"
- Claim tests passed without running them
- Modify unrelated modules while completing a focused task
- Revert user changes unless explicitly asked

Must:

- Prefer existing repository patterns
- Keep changes scoped
- Preserve Gateway/Web separation
- Preserve tmux-based terminal persistence
- Validate and sanitize inputs
- Cover error and boundary paths
- Provide verification evidence before calling work complete
