# Roadmap: OpenForge

## Milestones

- ✅ **v1.0 Post-Beta Trust Closure** — Phases 1-5, shipped 2026-05-20.
- ✅ **v1.1 Beta Evidence Burn-down** — Phases 6-8, shipped 2026-05-21.
- ✅ **v1.2 Project Manager Web Workflow** — Phases 9-11, shipped 2026-05-22.
- ✅ **v1.3 AI-Native Project Execution Traceability** — Phases 12-16, shipped 2026-05-29.
- ✅ **v1.4 External Evidence Closure** — Phases 17-20, shipped 2026-05-29.
- 🟡 **v1.5 First-User Trial Operations** — Phase 29 trial materials consistency guard complete; real trial packet collection pending.

## Current Milestone: v1.5 First-User Trial Operations

**Goal:** Turn cautious local-first readiness into an operator-run first-user
trial loop with redacted evidence routing, feedback triage, and truthful gate
decisions.

**Scope rule:** v1.5 operationalizes real trial collection for the existing
local-first AI CLI control plane. It does not add hosted collaboration, cloud
workers, autonomous remote execution, Feishu execution authority, or Codex Web
prompt/turn product workflow.

**Entry condition:** v1.4 is complete with `LIVE-PROVIDER`, `WINDOWS-WSL`, and
`FIRST-USER-FEEDBACK` preserved as `Caveat`, and `FEISHU-CALLBACK` preserved as
`Blocked`.

### Phase 21: First-User Trial Operations

**Goal:** Select the next milestone, define the first-user trial packet, and
pin the routing rules that turn trial outcomes into evidence, issues, or
explicitly preserved caveats.

**Requirements:** TRIALOPS-01, TRIALOPS-02, TRIALOPS-03, TRIALOPS-04,
TRIALOPS-05, TRIALOPS-06, TRIALSAFE-01, TRIALSAFE-02, TRIALSAFE-03,
PLAN-21-01, PLAN-21-02, PLAN-21-03

**Plans:** 1 plan

Plans:

- [x] 21-01-PLAN.md — v1.5 selection, first-user trial packet, evidence routing, and gate-preserving verification.

**Success criteria:**

1. The active source-of-truth docs name v1.5 and Phase 21 as the current
   direction instead of leaving the next milestone unselected.
2. A minimum first-user trial packet is defined with severity, owner,
   disposition, environment, reproduction, diagnostics status, follow-up route,
   and redaction review.
3. Trial outcomes route to `docs/EXTERNAL-EVIDENCE-GATES.md`,
   `docs/TRIAL-FEEDBACK.md`, the GitHub feedback issue template, and the
   existing follow-up issue/report destinations.
4. `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-CALLBACK`, and
   `FIRST-USER-FEEDBACK` keep their v1.4 states unless a real required
   artifact exists.
5. Phase 21 introduces no runtime expansion, no raw evidence storage, and no
   request for secrets, raw provider payloads, raw Feishu bodies, or raw
   terminal transcripts.

### Phase 22: Operator Trial Dry Run

**Goal:** Run the v1.5 trial loop from the maintainer/operator side on the
current host and record bounded evidence before collecting a real first-user
packet.

**Requirements:** DRYRUN-01, DRYRUN-02, DRYRUN-03, DRYSAFE-01, DRYSAFE-02,
PLAN-22-01, PLAN-22-02, PLAN-22-03

**Plans:** 1 plan

Plans:

- [x] 22-01-PLAN.md — current-host dependency, startup, provider-smoke,
  cleanup, and feedback-packet dry-run evidence.

**Success criteria:**

1. Current-host dependency evidence is recorded without secrets: OS, WSL probe,
   Node, pnpm, tmux, Claude Code, OpenCode, Codex CLI, and `openforge doctor`.
2. Source startup health is verified on loopback and temporary Gateway/Web
   processes are stopped afterwards.
3. Provider smoke behavior is recorded without a disposable credential and
   `LIVE-PROVIDER` remains `Caveat`.
4. The dry-run report explicitly states that it is operator evidence, not
   completed first-user feedback.
5. Feedback checklist wording matches the full v1.5 packet shape.

### Phase 23: Source Env Override Preservation

**Goal:** Fix the source fallback startup support gap found in Phase 22 so
command-prefix env overrides win over repository root `.env` values.

**Requirements:** ENVRUN-01, ENVRUN-02, ENVRUN-03, ENVRUN-04, ENVSAFE-01,
PLAN-23-01, PLAN-23-02, PLAN-23-03

**Plans:** 1 plan

Plans:

- [x] 23-01-PLAN.md — env-preserving source runner, package script wiring,
  docs, CI, and real Gateway/Web prefix smoke verification.

**Success criteria:**

1. Source fallback scripts still load repository root `.env`.
2. Existing command-prefix env values are preserved over `.env`, including
   `OPENFORGE_DB_PATH` and `OPENFORGE_WEB_PORT`.
3. Gateway/Web package scripts use the preserving runner.
4. CI covers the runner and source script wiring.
5. Runbook, smoke, troubleshooting, and CI docs describe the behavior without
   exposing secrets or raw state.
6. External evidence gate states remain unchanged.

### Phase 24: Trial Feedback Intake Contract

**Goal:** Make the GitHub issue form and Markdown feedback template a
machine-verified intake contract before collecting real first-user packets.

**Requirements:** INTAKE-01, INTAKE-02, INTAKE-03, INTAKE-04,
INTAKESAFE-01, PLAN-24-01, PLAN-24-02, PLAN-24-03

**Plans:** 1 plan

Plans:

- [x] 24-01-PLAN.md — intake validator, CI harness coverage, source-of-truth
  updates, and caveat-preserving verification.

**Success criteria:**

1. The GitHub trial feedback issue form preserves required fields, field
   types, required dropdown options, required mandatory flags,
   owner/disposition routing, and safety confirmations.
2. The Markdown trial feedback template preserves minimum packet sections,
   diagnostics guidance, Copilot evidence, terminal evidence, triage routing,
   and bounded support notes.
3. Public intake text rejects affirmative requests for raw evidence or secrets.
4. CI runs the intake contract test with the existing script harness.
5. The validator does not fabricate first-user evidence or move any external
   gate to `Pass`.

### Phase 25: Tokenless Trial Diagnostics

**Goal:** Remove browser-token fallback guidance from the first-user runbook
and make the runbook part of the machine-verified trial intake contract.

**Requirements:** RUNBOOKSAFE-01, RUNBOOKSAFE-02, RUNBOOKSAFE-03,
PLAN-25-01, PLAN-25-02, PLAN-25-03

**Plans:** 1 plan

Plans:

- [x] 25-01-PLAN.md — runbook tokenless diagnostics regression, validator
  extension, runbook fix, and caveat-preserving verification.

**Success criteria:**

1. First-user diagnostics guidance uses Web Settings -> Export diagnostics JSON.
2. Maintainer local API fallback is explicitly maintainer-only.
3. The runbook does not instruct first users to open browser developer tools,
   read Local Storage, use browser auth tokens, or run curl with
   `authorization: Bearer <token>`.
4. The intake validator checks the runbook in CI.
5. External evidence gate states remain unchanged.

### Phase 26: Trial Feedback Draft Generator

**Goal:** Add a local helper that generates a redaction-aware first-user
feedback draft without collecting raw evidence or clearing gates.

**Requirements:** DRAFT-01, DRAFT-02, DRAFT-03, DRAFTSAFE-01,
PLAN-26-01, PLAN-26-02, PLAN-26-03

**Plans:** 1 plan

Plans:

- [x] 26-01-PLAN.md — draft generator, script harness coverage, docs links,
  and gate-preserving verification.

**Success criteria:**

1. A local command generates a Markdown feedback draft with bounded environment
   metadata and required first-user packet sections.
2. The draft explicitly states it is not submitted, not reviewed, and not
   gate-clearing evidence.
3. Token-shaped values are redacted from draft fields.
4. The helper does not export diagnostics, read browser storage, read tokens,
   upload files, or collect raw terminal/provider/Feishu evidence.
5. Trial docs link the helper while preserving `FIRST-USER-FEEDBACK` as
   `Caveat` until a completed redacted packet is linked.

### Phase 27: Trial Feedback Packet Audit

**Goal:** Add a local audit command that rejects generated drafts, placeholder
packets, missing required fields, and obvious secret-like content before a
Markdown feedback packet enters maintainer triage.

**Requirements:** PACKETAUDIT-01, PACKETAUDIT-02, PACKETAUDIT-03,
PACKETSAFE-01, PLAN-27-01, PLAN-27-02, PLAN-27-03

**Plans:** 1 plan

Plans:

- [x] 27-01-PLAN.md — packet audit helper, script harness coverage, trial docs
  links, and gate-preserving verification.

**Success criteria:**

1. A local command audits completed Markdown feedback packets for required
   sections, field values, reproduction steps, behavior descriptions,
   diagnostics status, triage routing, browser evidence, and bounded support
   summaries.
2. Generated drafts and placeholder-only packets are rejected.
3. Obvious secret-like token/key content is rejected before maintainer triage.
4. Passing audit means ready for maintainer triage only and never clears
   `FIRST-USER-FEEDBACK` or any other external evidence gate automatically.
5. Trial docs and CI link the audit helper without uploading packets, reading
   browser storage, exporting diagnostics, or mutating gate state.

### Phase 28: External Evidence Gate Drift Guard

**Goal:** Add a machine-verified guard for `docs/EXTERNAL-EVIDENCE-GATES.md`
so external gate states cannot drift to `Pass` without an intentional validator
update and linked real artifact.

**Requirements:** GATEGUARD-01, GATEGUARD-02, GATEGUARD-03, GATESAFE-01,
PLAN-28-01, PLAN-28-02, PLAN-28-03

**Plans:** 1 plan

Plans:

- [x] 28-01-PLAN.md — external evidence registry validator, CI coverage,
  rerun-path sync, and gate-preserving verification.

**Success criteria:**

1. A local command validates all required external gate rows.
2. Current gate states remain `LIVE-PROVIDER=Caveat`,
   `WINDOWS-WSL=Caveat`, `FEISHU-CALLBACK=Blocked`, and
   `FIRST-USER-FEEDBACK=Caveat`.
3. Rerun paths keep the concrete live-provider smoke command and
   first-user feedback packet audit command visible.
4. CI runs the validator through the script harness.
5. The validator does not collect evidence or clear any gate by itself.

### Phase 29: Trial Materials Consistency Guard

**Goal:** Extend the trial intake validator so the first-user trial checklist
cannot drift away from the runbook, feedback template, issue form, packet audit,
or external gate validator before real packet collection.

**Requirements:** MATERIALS-01, MATERIALS-02, MATERIALS-03, MATERIALSSAFE-01,
PLAN-29-01, PLAN-29-02, PLAN-29-03

**Plans:** 1 plan

Plans:

- [x] 29-01-PLAN.md — checklist drift coverage, root intake validator command,
  trial docs sync, and gate-preserving verification.

**Success criteria:**

1. The trial intake validator reads `docs/TRIAL-CHECKLIST.md` by default.
2. Checklist drift tests reject missing intake-validation, packet-audit, and
   external-gate-validation commands.
3. Checklist safety checks reject unsafe raw-evidence wording and
   non-negated browser-token guidance.
4. Trial docs name `pnpm trial:intake-validate` as a local
   materials-consistency guard.
5. The validator does not collect first-user feedback, export diagnostics,
   upload artifacts, submit issues, or clear any external gate.

## Archived Milestones

<details>
<summary>✅ v1.4 External Evidence Closure (Phases 17-20) — SHIPPED 2026-05-29</summary>

- [x] Phase 17: External Evidence Registry — 1/1 plan completed 2026-05-29.
- [x] Phase 18: Live Provider Evidence Rerun — 1/1 plan completed as
  `Complete (Caveat)` 2026-05-29.
- [x] Phase 19: Feishu Public Callback Evidence — 1/1 plan completed as
  `Complete (Blocked)` 2026-05-29.
- [x] Phase 20: Platform And First-User Acceptance Closure — 1/1 plan completed
  as `Complete (Caveat)` 2026-05-29.

Full archive:

- `.planning/milestones/v1.4-ROADMAP.md`
- `.planning/milestones/v1.4-REQUIREMENTS.md`
- `.planning/milestones/v1.4-phases/`

</details>

<details>
<summary>✅ v1.0 Post-Beta Trust Closure (Phases 1-5) — SHIPPED 2026-05-20</summary>

- [x] Phase 1: Beta Evidence Closure — 4/4 plans completed 2026-05-19.
- [x] Phase 2: Public Feishu Webhook Safety — 2/2 plans completed 2026-05-20.
- [x] Phase 3: First-User Product Hardening — 4/4 plans completed 2026-05-20.
- [x] Phase 4: Feishu Project Manager Ledger — 2/2 plans completed 2026-05-20.
- [x] Phase 5: Remote Execution Architecture — 1/1 plan completed 2026-05-20.

Full archive:

- `.planning/milestones/v1.0-ROADMAP.md`
- `.planning/milestones/v1.0-REQUIREMENTS.md`
- `.planning/milestones/v1.0-MILESTONE-AUDIT.md`
- `.planning/milestones/v1.0-phases/`

</details>

<details>
<summary>✅ v1.1 Beta Evidence Burn-down (Phases 6-8) — SHIPPED 2026-05-21</summary>

- [x] Phase 6: Live Provider and Platform Smoke Evidence — 2/2 plans completed 2026-05-21.
- [x] Phase 7: Feishu Live Callback Readiness — 2/2 plans completed 2026-05-21.
- [x] Phase 8: First-User Readiness Packet — 2/2 plans completed 2026-05-21.

Full archive:

- `.planning/milestones/v1.1-ROADMAP.md`
- `.planning/milestones/v1.1-REQUIREMENTS.md`
- `.planning/milestones/v1.1-phases/`

</details>

<details>
<summary>✅ v1.2 Project Manager Web Workflow (Phases 9-11) — SHIPPED 2026-05-22</summary>

- [x] Phase 9: Project Manager Web Foundation — 2/2 plans completed 2026-05-21.
- [x] Phase 10: Goal And Work Item Operations — 3/3 plans completed 2026-05-22.
- [x] Phase 11: Evidence, Ledger, And Acceptance Gates — 3/3 plans completed 2026-05-22.

Full archive:

- `.planning/milestones/v1.2-ROADMAP.md`
- `.planning/milestones/v1.2-REQUIREMENTS.md`
- `.planning/milestones/v1.2-phases/`

</details>

<details>
<summary>✅ v1.3 AI-Native Project Execution Traceability (Phases 12-16) — SHIPPED 2026-05-29</summary>

- [x] Phase 12: Copilot Project-Manager Traceability — 4/4 plans completed 2026-05-22.
- [x] Phase 13: Project Manager Board Workflow — 3/3 plans completed 2026-05-29.
- [x] Phase 14: Terminal Workspace Context — 3/3 plans completed 2026-05-29.
- [x] Phase 15: Model Provider Setup And Health — 3/3 plans completed 2026-05-29.
- [x] Phase 16: Open Source Readiness Packet — 1/1 plan completed 2026-05-29.

Full archive:

- `.planning/milestones/v1.3-ROADMAP.md`
- `.planning/milestones/v1.3-REQUIREMENTS.md`
- `.planning/milestones/v1.3-phases/`

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Beta Evidence Closure | v1.0 | 4/4 | Complete | 2026-05-19 |
| 2. Public Feishu Webhook Safety | v1.0 | 2/2 | Complete | 2026-05-20 |
| 3. First-User Product Hardening | v1.0 | 4/4 | Complete | 2026-05-20 |
| 4. Feishu Project Manager Ledger | v1.0 | 2/2 | Complete | 2026-05-20 |
| 5. Remote Execution Architecture | v1.0 | 1/1 | Complete | 2026-05-20 |
| 6. Live Provider and Platform Smoke Evidence | v1.1 | 2/2 | Complete | 2026-05-21 |
| 7. Feishu Live Callback Readiness | v1.1 | 2/2 | Complete | 2026-05-21 |
| 8. First-User Readiness Packet | v1.1 | 2/2 | Complete | 2026-05-21 |
| 9. Project Manager Web Foundation | v1.2 | 2/2 | Complete | 2026-05-21 |
| 10. Goal And Work Item Operations | v1.2 | 3/3 | Complete | 2026-05-22 |
| 11. Evidence, Ledger, And Acceptance Gates | v1.2 | 3/3 | Complete | 2026-05-22 |
| 12. Copilot Project-Manager Traceability | v1.3 | 4/4 | Complete | 2026-05-22 |
| 13. Project Manager Board Workflow | v1.3 | 3/3 | Complete | 2026-05-29 |
| 14. Terminal Workspace Context | v1.3 | 3/3 | Complete | 2026-05-29 |
| 15. Model Provider Setup And Health | v1.3 | 3/3 | Complete | 2026-05-29 |
| 16. Open Source Readiness Packet | v1.3 | 1/1 | Complete | 2026-05-29 |
| 17. External Evidence Registry | v1.4 | 1/1 | Complete | 2026-05-29 |
| 18. Live Provider Evidence Rerun | v1.4 | 1/1 | Complete (Caveat) | 2026-05-29 |
| 19. Feishu Public Callback Evidence | v1.4 | 1/1 | Complete (Blocked) | 2026-05-29 |
| 20. Platform And First-User Acceptance Closure | v1.4 | 1/1 | Complete (Caveat) | 2026-05-29 |
| 21. First-User Trial Operations | v1.5 | 1/1 | Complete | 2026-05-29 |
| 22. Operator Trial Dry Run | v1.5 | 1/1 | Complete | 2026-05-29 |
| 23. Source Env Override Preservation | v1.5 | 1/1 | Complete | 2026-05-29 |
| 24. Trial Feedback Intake Contract | v1.5 | 1/1 | Complete | 2026-05-29 |
| 25. Tokenless Trial Diagnostics | v1.5 | 1/1 | Complete | 2026-05-29 |
| 26. Trial Feedback Draft Generator | v1.5 | 1/1 | Complete | 2026-05-29 |
| 27. Trial Feedback Packet Audit | v1.5 | 1/1 | Complete | 2026-05-29 |
| 28. External Evidence Gate Drift Guard | v1.5 | 1/1 | Complete | 2026-05-29 |

## Backlog

Deferred outside v1.5 unless reprioritized:

- Project-manager global dashboard and advanced analytics.
- SSH/remote execution runtime implementation from the Phase 5 architecture package.
- Encrypted Feishu payload support if a real Feishu app requires encrypted events.
- Shared replay/rate store implementation for multi-instance public Feishu webhook deployment.
- Agent marketplace and visual agent orchestration beyond the basic project-manager board workflow.
