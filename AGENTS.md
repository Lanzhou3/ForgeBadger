# AGENTS.md

This file provides repository instructions for AI coding agents working in OpenForge.

## Project Snapshot

OpenForge is an AI programming IDE control platform. It provides a Web console for managing AI CLI instances such as Claude Code, OpenCode, and Codex, including project scaffolding, configuration injection, session management, terminal access, model management, Agent management, Skill management, and template management.

Current product phase: post-beta beta evidence closure / first-user readiness. Follow `docs/DEVELOPMENT-PLAN.md` and `.planning/ROADMAP.md` for sequencing and milestones.

## Source Of Truth

Read these documents before making non-trivial changes:

- `CLAUDE.md` - project overview, commands, architecture decisions, workflow rules
- `.claude/CLAUDE.md` - Harness Engineering workflow and role boundaries
- `.claude/rules/*.md` - security, backend, frontend, API, and testing rules
- `.claude/skills/*.md` - plan, review, verify, and commit workflows
- `.claude/agents/*.md` - role-specific agent responsibilities
- `docs/PRD-v1.1-MVP.md` - product scope and P0/P1/P2 priorities
- `docs/TECH-ARCHITECTURE.md` - architecture, APIs, data model, terminal design, ADRs
- `docs/DEVELOPMENT-PLAN.md` - 26-day MVP schedule and module breakdown
- `docs/TEST-PLAN.md` - TDD strategy and test coverage requirements
- `docs/UI-DESIGN.md` - UI information architecture and visual design rules

If documents conflict, use this priority:

1. Direct user instruction for the current task
2. `CLAUDE.md` at repository root and `docs/TECH-ARCHITECTURE.md`
3. `.claude/CLAUDE.md`
4. `.claude/rules/*.md`
5. Other `docs/*.md`

OpenForge APIs must use the project envelope from `CLAUDE.md`, `.claude/rules/api.md`, and architecture docs:

```json
{ "code": 0, "data": {}, "message": "" }
{ "code": 1, "message": "error description", "details": {} }
```

## Tech Stack

- Monorepo package manager: `pnpm`
- Frontend: Next.js App Router, TypeScript, shadcn/ui, Tailwind CSS, xterm.js, TanStack Query, zod, lucide-react
- Gateway: Node.js 20+, Express, TypeScript, `ws`, `node-pty`, `tmux`
- Database: SQLite via `better-sqlite3`, Drizzle ORM and `drizzle-kit`
- Auth: JWT via `jsonwebtoken`, passwords via `bcrypt`
- Encryption: AES-256-GCM for API key storage
- Tests: `node:test` for backend, Vitest for frontend, Playwright for E2E

## Common Commands

```bash
pnpm install
pnpm -r build
pnpm -r dev
pnpm -r test

cd packages/gateway
npx drizzle-kit generate
npx drizzle-kit migrate
npx tsx src/index.ts
pnpm test

cd packages/web
pnpm dev
pnpm vitest run
```

Use narrower commands when possible. Do not claim completion without running the relevant verification command or clearly stating why it could not be run.

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

Expected layout:

```text
packages/
  gateway/
    src/
      index.ts
      server.ts
      routes/
      websocket/
      services/
      adapters/
      db/
      middleware/
  web/
    src/
      app/
      components/
      hooks/
      lib/
docs/
.claude/
```

Gateway ownership:

- API routes and handlers
- Services and business logic
- Repositories, schema, migrations
- WebSocket hub and terminal proxy
- CLI adapters
- Backend tests

Web ownership:

- Next.js pages and layouts
- React components
- Hooks, stores, API client, WebSocket client
- Frontend tests
- Styling and responsive behavior

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

Hardcoded secrets are forbidden:

- API keys and tokens
- Database passwords
- JWT secrets
- Encryption keys
- Third-party credentials
- Private keys or certificates

Use environment variables and validate them with zod or equivalent.

Sensitive environment variables:

- `OPENFORGE_MASTER_KEY` - required, preferred 64-character hex key for AES-256-GCM; legacy 32-byte strings are still accepted
- `OPENFORGE_JWT_SECRET` - required
- `OPENFORGE_PORT` - optional, default `3000`
- `OPENFORGE_DB_PATH` - optional, default `~/.openforge/openforge.db`
- `OPENFORGE_LOG_LEVEL` - optional
- `OPENFORGE_TMUX_PREFIX` - optional, default `of-`

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
- All business tables must be scoped by `user_id`.
- Repository classes should automatically apply `WHERE user_id = ?`.
- Async operations must have meaningful error handling and contextual logging.
- Use structured logs with fields such as `userId`, `action`, `duration`, and `timestamp`, without sensitive data.
- Do not concatenate shell commands or SQL with user input.

AI CLI adapter interface must preserve these concepts:

- `getLaunchCommand(projectPath, options)`
- `generateConfig(project, template)`
- `scanProject(projectPath)`
- `formatAgentConfig(agent)`
- `formatSkillInjection(skill)`

MVP implements Claude Code first. OpenCode and Codex are P1 unless the current task says otherwise.

## Frontend Standards

Use the UI direction from `docs/UI-DESIGN.md`:

- Dark theme first, professional developer tooling style
- Dense, functional layouts inspired by VS Code, Linear, Vercel Dashboard, GitHub Codespaces
- Terminal is the core differentiated screen
- Desktop gets full management functionality
- Mobile is for status viewing and simple operations; do not assume full terminal use

React conventions:

- Component names use PascalCase.
- Component files use `ComponentName.tsx`.
- Prefer `interface Props` before the component.
- Hooks must start with `use`, have one responsibility, include complete dependency arrays, and clean up side effects.
- Use React Query or equivalent for server state.
- Handle loading, empty, and error states.
- Lists must have stable keys; virtualize large lists when needed.
- Use Tailwind CSS or local component styles; avoid inline styles unless unavoidable.
- Use shadcn/ui and lucide-react where appropriate.

Navigation should follow the documented information architecture:

- `/` dashboard
- `/projects`
- `/projects/new`
- `/projects/import`
- `/projects/:id`
- `/sessions`
- `/sessions/:id`
- `/agents`
- `/skills`
- `/templates`
- `/models`
- `/settings`

## API And WebSocket Standards

REST:

- `GET` for idempotent queries
- `POST` for create/action
- `PUT` for full update
- `PATCH` for partial update
- `DELETE` for idempotent delete
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

Heartbeat:

- 30 second ping/pong
- 90 second timeout disconnect

Connection safety:

- Authenticate WebSocket connections.
- Enforce tenant isolation on terminal and event channels.
- Enforce single active terminal connection per session.
- Limit message size, input rate, total connections, and per-user connections.

## Testing Standards

Use `docs/TEST-PLAN.md` as the test source of truth.

Test structure should follow Arrange, Act, Assert:

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

- Mock external dependencies for unit tests.
- Do not mock internal implementation to make tests pass.
- Integration tests for `tmux` and `node-pty` should use real `tmux` and real pty where the test plan requires it.
- Use in-memory SQLite for database integration tests where appropriate.

Important security and correctness cases to cover:

- JWT `alg:none` rejection
- Multi-tenant isolation
- SQL injection attempts
- Path traversal including encoded Unicode variants
- Symlink escape prevention
- XSS escaping for Skill/template content
- API key encryption at rest
- WebSocket flood/rate/message-size limits
- Terminal output ordering

## Product Scope Priorities

P0 MVP includes:

- User auth and multi-tenant isolation
- Database schema, migrations, repositories
- Project creation/import and config generation
- Claude Code template support
- Session dashboard, session creation, terminal, session status
- Agent list and basic creation
- Skill list and enable/disable
- Template list and editing
- Model list, model switching, model creation, API key management

P1/P2 features should not be pulled into MVP unless explicitly requested.

## Git And Documentation

Commit format:

```text
<type>: <description>
```

Allowed types:

- `feat`
- `fix`
- `refactor`
- `perf`
- `docs`
- `test`
- `chore`
- `ci`

Rules:

- One logical change per commit.
- Commit title should be under 50 Chinese characters or an equivalently short English sentence.
- Explain why in the body when needed.
- Before committing, review `git diff --staged` and recent history.
- Run relevant lint, build, and tests before commit, or state exactly what was not run.

Documentation must be updated when behavior, architecture, workflow, or phase status changes. Session handoff information belongs in `CLAUDE.md` and related docs such as `docs/CHANGELOG.md` or `docs/PLAN.md` if present.

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
