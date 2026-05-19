# Codebase Map: Stack

## Runtime

- Monorepo package manager: `pnpm`
- Gateway: Node.js/TypeScript, Express, `ws`, `node-pty`, `tmux`, SQLite via `better-sqlite3`, Drizzle migrations, zod validation.
- Web: Next.js App Router, React, TypeScript, Tailwind CSS, shadcn-style components, TanStack Query, Vitest, Playwright.
- CLI/package layer: local `openforge` CLI packaging and smoke scripts under `scripts/`.

## Core Commands

- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm -r build`
- `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts`
- `pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium`
- `pnpm smoke:copilot-provider`
- `pnpm smoke:codex-app-server`
- `pnpm build:npm && pnpm verify:npm && pnpm smoke:npm`

## Notes For GSD

- Prefer focused package-level commands during implementation.
- Broader release gates are documented in `docs/CI-CD-PLAN.md`.
- External smokes need host capabilities and should record skips as explicit evidence, not silently pass.
