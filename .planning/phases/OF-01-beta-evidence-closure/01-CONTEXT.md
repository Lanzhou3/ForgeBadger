# Phase 1: Beta Evidence Closure - Context

**Gathered:** 2026-05-19T20:07:05+08:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 turns the merged post-beta Copilot/Feishu hardening work into evidence-backed beta readiness. It closes or preserves the external evidence gates that local unit tests, mocked E2E, and Ubuntu CI cannot fully prove: live Copilot provider smoke, explicit terminal/tmux release evidence, physical Windows/WSL caveats, first-user feedback intake, and stale release/progress documentation.

This phase does not add new Copilot, Feishu, terminal, remote execution, or project-manager capabilities. Product fixes discovered through first-user feedback are triaged here and routed to later hardening phases.

</domain>

<decisions>
## Implementation Decisions

### Evidence Acceptance Standard
- **D-01:** Record external evidence per gate. Each gate entry must include command or manual procedure, host/environment, result, log or report location, and caveat state.
- **D-02:** Live Copilot provider smoke may use only disposable or rotatable test credentials. Evidence may record provider type, execution time, successful path, and redacted response summary. It must not record API keys, complete request bodies, raw secrets, or full model output.
- **D-03:** External gate status uses `Pass / Caveat / Blocked`. `Caveat` means the release can continue with an explicit known gap. `Blocked` means the release judgment cannot be trusted until resolved.

### CI And Manual Gate Boundary
- **D-04:** Keep `mvp1-smoke` as the stable required CI Web E2E gate. Do not imply that it proves the full browser terminal release gate by itself.
- **D-05:** Record `gate-d-smoke` and explicit tmux integration evidence in release/manual evidence, including `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts` when the host supports it. If these gates cannot run, preserve a `Caveat`.
- **D-06:** Every `Caveat` must include skip reason, owner, and next action. Avoid CI summaries or release reports that look green while environment-sensitive gates were skipped.

### Stale Documentation Refresh Scope
- **D-07:** Repair only factual conflict sources in Phase 1: `AGENTS.md`, `MEMORY.md`, the Feishu inbound plan, trial readiness, and release evidence docs that contain stale PR, phase, or caveat state. Avoid broad narrative rewrites of all core docs.
- **D-08:** Historical reports keep their original conclusion, but receive `superseded` or `current status` notes where later evidence changed the state. Do not rewrite historical evidence as if it originally passed.

### Windows/WSL And First-User Feedback Handling
- **D-09:** If no physical Windows/WSL host is available, keep Windows/WSL as `Caveat` and continue closing other beta evidence. Do not remove the Windows caveat until real physical evidence exists.
- **D-10:** First-user feedback in Phase 1 is captured as a triage ledger: feedback, reproduction details, category, severity, and requirement mapping. Fixes from that feedback should become Phase 3 hardening tasks unless they directly invalidate Phase 1 evidence.

### the agent's Discretion
- Downstream agents may choose the exact report/table format as long as it preserves the required fields from D-01, D-03, and D-06.
- Downstream agents may decide whether to add a new Phase 1 evidence report or update existing reports, but stale source-of-truth conflicts listed in D-07 must be fixed directly.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### GSD And Project State
- `.planning/PROJECT.md` — Current product position, active requirements, and out-of-scope boundaries.
- `.planning/REQUIREMENTS.md` — Phase 1 requirements `REL-01` through `REL-06`.
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, and plan sequence.
- `.planning/DECISIONS-INDEX.md` — Locked project decisions that must not be re-asked.
- `CLAUDE.md` — Repository architecture, commands, and workflow rules.
- `AGENTS.md` — Agent-facing repo instructions; currently one of the stale docs Phase 1 must refresh.
- `MEMORY.md` — Repo-root progress memory; currently one of the stale docs Phase 1 must refresh.

### Release And CI Evidence
- `.github/workflows/ci.yml` — Actual CI gates and current `RUN_TMUX_TESTS` behavior.
- `docs/CI-CD-PLAN.md` — Documented release gate expectations, including `gate-d-smoke`, `mvp1-smoke`, tmux, live provider, and Windows/WSL caveats.
- `docs/SMOKE-TEST.md` — Smoke commands and live Copilot provider smoke instructions.
- `docs/TRIAL-CHECKLIST.md` — Manual first-user and Windows/WSL checklist fields.
- `docs/TRIAL-FEEDBACK.md` — Feedback template and provider/platform evidence fields.
- `docs/reports/post-beta-release-gates-2026-05-10.md` — Existing release-gate report and Windows/WSL caveat language.
- `docs/reports/trial-readiness-2026-05-06.md` — Historical blocked trial-readiness report; should keep history with a superseded/current-status note.

### Copilot, Feishu, And Product Boundary
- `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md` — Copilot first-release contract and product audit context.
- `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md` — Feishu plan whose PR-state wording is stale and whose safety boundary informs later Phase 2 work.
- `docs/DEVELOPMENT-PLAN.md` — Current product sequencing and milestone context.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pnpm smoke:copilot-provider`: existing live-provider smoke command; Phase 1 should record it only with disposable or rotatable credentials.
- `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts`: explicit tmux integration command to use as release evidence when host capabilities are available.
- `pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium --reporter=line`: current stable CI Web E2E smoke path.

### Established Patterns
- Gateway/Web split and `/api/v1` envelope remain unchanged; Phase 1 is primarily evidence and documentation, not API behavior expansion.
- CI is necessary but insufficient for live provider, terminal/tmux, and physical platform claims. Manual evidence must be explicit rather than implied by broad green checks.
- Stale reports should be corrected with current-status annotations, not by erasing historical conclusions.

### Integration Points
- `.github/workflows/ci.yml` is the integration point for any CI gate alignment.
- `docs/CI-CD-PLAN.md`, `docs/SMOKE-TEST.md`, `docs/TRIAL-CHECKLIST.md`, `docs/TRIAL-FEEDBACK.md`, and `docs/reports/*.md` are the release-evidence surfaces.
- `AGENTS.md`, `MEMORY.md`, and the Feishu plan are source-of-truth surfaces that must stop describing stale phase or PR states.

</code_context>

<specifics>
## Specific Ideas

- Use per-gate evidence rows with `Pass / Caveat / Blocked`, command/procedure, environment, log/report path, skip reason, owner, and next action.
- Preserve the Windows/WSL caveat until a physical Windows/WSL host is actually tested.
- Treat first-user feedback as a Phase 1 triage artifact and a Phase 3 planning input, not as an unbounded Phase 1 fix queue.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Beta Evidence Closure*
*Context gathered: 2026-05-19T20:07:05+08:00*
