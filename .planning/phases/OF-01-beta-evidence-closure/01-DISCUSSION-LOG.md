# Phase 1: Beta Evidence Closure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19T20:07:05+08:00
**Phase:** 1-Beta Evidence Closure
**Areas discussed:** Evidence acceptance standard, CI and manual gate boundary, Stale documentation refresh scope, Windows/WSL and first-user feedback handling

---

## Evidence Acceptance Standard

### Evidence Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Per-gate detail | Each gate records command, environment, result, log/report location, and caveat state. | ✓ |
| Summary report | One release report records overall result and key caveats. | |
| Command output first | Raw command output and CI/job links are primary; docs index evidence. | |

**User's choice:** Per-gate detail.
**Notes:** This maximizes traceability for release judgment.

### Live Provider Secret Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Disposable or rotatable test credential only | Record provider type, execution time, successful path, and redacted response summary; do not record keys, full request bodies, or full output. | ✓ |
| Maintainer private credential allowed | Easier to run, but evidence depends on maintainer assertion and increases secret exposure risk. | |
| Do not run live provider yet | Keep REL-01 as caveat. | |

**User's choice:** Disposable or rotatable test credential only.
**Notes:** Secret hygiene outranks convenience.

### Gate State Vocabulary

| Option | Description | Selected |
|--------|-------------|----------|
| Pass / Caveat / Blocked | Separates passed, acceptable known gap, and release-blocking uncertainty. | ✓ |
| Pass / Fail | Simple but conflates missing environment with product failure. | |
| Pass / Skipped / Fail | CI-style vocabulary that is weaker for release caveats. | |

**User's choice:** Pass / Caveat / Blocked.
**Notes:** Caveat is a first-class release state.

---

## CI And Manual Gate Boundary

### gate-d And tmux Evidence Placement

| Option | Description | Selected |
|--------|-------------|----------|
| CI runs mvp1, release/manual evidence runs gate-d plus tmux | Keep CI stable and require explicit release evidence or caveat for `gate-d-smoke` and tmux. | ✓ |
| Make both required CI gates | Strongest automation, higher flake and environment burden. | |
| Keep current CI and only document caveats | Lowest implementation cost, weaker REL-05/REL-06 closure. | |

**User's choice:** CI runs mvp1, release/manual evidence runs gate-d plus tmux.
**Notes:** Avoid weakening CI stability while preventing false release confidence.

### Environment-Sensitive Skip Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Require skip reason, owner, and next action | Any Caveat must say why it was skipped, who can close it, and what happens next. | ✓ |
| Require skip reason only | Simpler but leaves ownership unclear. | |
| Record caveat only in CI summary | Less documentation work, but release reports can drift. | |

**User's choice:** Require skip reason, owner, and next action.
**Notes:** Caveats must be actionable, not just explanatory.

---

## Stale Documentation Refresh Scope

### Repair Breadth

| Option | Description | Selected |
|--------|-------------|----------|
| Repair only factual conflict sources | Fix stale PR, phase, and caveat state in `AGENTS.md`, `MEMORY.md`, Feishu plan, trial readiness, and release evidence docs. | ✓ |
| Rewrite all core docs into post-beta narrative | More comprehensive, but broad and risky. | |
| Only append a new report | Preserves history but leaves stale source-of-truth conflicts. | |

**User's choice:** Repair only factual conflict sources.
**Notes:** Phase 1 should not become a broad documentation rewrite.

### Historical Reports

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve history and add superseded/current-status note | Keep original conclusion but clearly mark later evidence and current state. | ✓ |
| Rewrite to current conclusion | Easier to read but erases historical evidence. | |
| Do not modify old reports | Historically pure, but still misleading to agents and search. | |

**User's choice:** Preserve history and add superseded/current-status note.
**Notes:** The audit trail stays intact while current-state ambiguity is removed.

---

## Windows/WSL And First-User Feedback Handling

### Physical Windows/WSL Availability

| Option | Description | Selected |
|--------|-------------|----------|
| Keep Caveat and do not block other beta evidence | Record skip reason, owner, and next action; do not remove Windows caveat. | ✓ |
| Block Phase 1 until real Windows/WSL evidence exists | Strictest release posture but can stall unrelated evidence closure. | |
| Use Ubuntu/WSL documentation as substitute evidence | Fastest, but creates false-green platform claims. | |

**User's choice:** Keep Caveat and do not block other beta evidence.
**Notes:** Physical Windows/WSL evidence is required only to remove the Windows caveat.

### First-User Feedback Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Triage ledger plus mapping to Phase 3 tasks | Record feedback, reproduction, category, severity, and requirement mapping; fixes move to Phase 3. | ✓ |
| Fix all feedback directly in Phase 1 | User-centric but unbounded. | |
| Collect raw feedback only | Fast but low value for planning. | |

**User's choice:** Triage ledger plus mapping to Phase 3 tasks.
**Notes:** Phase 1 captures evidence and routing; product hardening remains Phase 3 unless feedback invalidates release evidence.

---

## the agent's Discretion

- The exact table/report shape is left to the planner as long as required evidence fields are preserved.
- The planner may choose whether to add a new evidence report or update existing reports, provided stale facts in source-of-truth docs are fixed directly.

## Deferred Ideas

None.
