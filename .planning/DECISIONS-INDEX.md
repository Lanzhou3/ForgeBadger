# Decisions Index

This bounded index summarizes decisions that downstream GSD workflows should carry forward without re-asking.

## Product Position

- OpenForge is a local-first AI CLI control plane, not a hosted autonomous development platform.
- The strongest product wedge is reliable browser control and recovery of local AI CLI sessions.
- Copilot, Feishu, and Codex app-server features must strengthen that wedge instead of broadening into unbounded autonomy.
- AI-native project management is a traceability layer for AI CLI execution, not a generic PM-suite replacement.

## Locked Decisions

| Area | Decision | Evidence |
|------|----------|----------|
| Gateway/Web split | Gateway owns REST, WebSocket, terminal, process, repository, and integration behavior; Web stays SPA-only. | `CLAUDE.md`, `docs/TECH-ARCHITECTURE.md` |
| Terminal persistence | tmux is the persistence layer; do not store terminal logs in SQLite. | `CLAUDE.md`, `docs/TECH-ARCHITECTURE.md` |
| API contract | REST APIs live under `/api/v1` and use the OpenForge envelope. | `CLAUDE.md`, `.claude/rules/api.md` |
| Tenant isolation | Business tables and repositories must scope by `user_id`. | `CLAUDE.md`, `.claude/rules/security.md` |
| Codex boundary | Codex launch paths stay subscription/SDK-managed; no provider API-key/model injection. | `MEMORY.md`, `docs/DEVELOPMENT-PLAN.md` |
| Codex app-server | Web prompt/turn input remains disabled by default; `/turn` is a feature-flag prototype. | `MEMORY.md`, `docs/CI-CD-PLAN.md` |
| Copilot boundary | Copilot is provider-backed, read-heavy, approval-gated, redacted, and non-autonomous. | `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md`, `docs/API.md` |
| Feishu boundary | Feishu is a controlled collaboration channel into Copilot, not execution authority or approval authority. | `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md` |
| Roadmap order | Close beta evidence, then public Feishu webhook safety, then first-user hardening before ledger or remote expansion. | GSD bootstrap review, `docs/superpowers/specs/2026-05-06-openforge-post-rc-roadmap-design.md` |
| v1.3 direction | Next milestone focuses on AI-native project execution traceability: Copilot proposals, Project Manager board, terminal context, provider health, and open-source trust. | `docs/reports/pm-review-audit-2026-05-22.md`, `.planning/REQUIREMENTS.md` |

## Deferred Ideas

- Hosted collaboration, cloud deployment, billing, telemetry, and hosted marketplace.
- Autonomous remote development and raw shell/terminal control through Copilot or Feishu.
- SSH/remote execution implementation before a separate architecture/threat-model phase.
- Feishu approval links or code approval before explicit tokenized approval semantics exist.

## Canonical Current Docs

- `CLAUDE.md`
- `MEMORY.md`
- `docs/PRD-v1.1-MVP.md`
- `docs/TECH-ARCHITECTURE.md`
- `docs/DEVELOPMENT-PLAN.md`
- `docs/TEST-PLAN.md`
- `docs/CI-CD-PLAN.md`
- `docs/API.md`
- `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md`
- `docs/superpowers/specs/2026-05-06-openforge-post-rc-roadmap-design.md`
- `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md`
