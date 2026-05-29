# Codebase Map: Testing

## Test Layers

- Gateway backend tests use `node:test` with `tsx`.
- Web unit tests use Vitest.
- E2E tests use Playwright under `packages/web/e2e`.
- Release smoke scripts live under `scripts/`.

## Gate Coverage

- CI installs tmux, runs workspace typecheck/tests/build, script harness tests, provider/Codex boundary regression, core Web E2E smoke, Codex app-server Web smoke, npm package verify/smoke, and environment-gated notes.
- `RUN_TMUX_TESTS=1` is set in CI for gateway workspace tests.
- CI currently runs `e2e/mvp1-smoke.spec.ts` as the core Web E2E smoke; `docs/CI-CD-PLAN.md` still lists `e2e/gate-d-smoke.spec.ts` plus `e2e/mvp1-smoke.spec.ts` for the fuller E2E gate.
- tmux integration is indirectly covered through `RUN_TMUX_TESTS=1 pnpm -r test`; release evidence should also include an explicit `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts` result.
- Real Codex app-server smoke is conditional on the `codex` CLI being installed.
- Physical Windows/WSL smoke remains manual because Ubuntu CI cannot prove native Windows behavior.
- Live Copilot provider smoke exists as `pnpm smoke:copilot-provider` but needs a disposable provider credential for real evidence.

## GSD Planning Implications

- Treat green CI as necessary but insufficient for live provider and platform caveat closure.
- For backend changes, add focused `node:test` coverage before broad suite runs.
- For Web/Copilot behavior, keep Playwright selectors stable via test ids or semantic controls, not text-only ancestor traversal.
- Make E2E API mocks fail fast for unexpected `/api/v1/*` routes unless a test is explicitly proving tolerant fallback behavior.
- For release-doc work, verification includes checking GSD phase parsing and documentation consistency.
