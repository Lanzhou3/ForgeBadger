# Requirements: OpenForge v1.5 First-User Trial Operations

**Defined:** 2026-05-29
**Core Value:** Developers can reliably control and recover local AI CLI coding sessions from a browser while first-user trial outcomes become redacted, routed, and auditable evidence.
**Milestone Goal:** Turn the v1.4 external evidence closeout into an operator-run first-user trial loop that preserves caveats until real artifacts exist and routes feedback into concrete follow-up.

## Readiness Assessment

- v1.4 External Evidence Closure is complete and archived under
  `.planning/milestones/v1.4-*`.
- `docs/EXTERNAL-EVIDENCE-GATES.md` is the canonical registry for external gate
  states and clearing conditions.
- OpenForge is suitable for cautious local-first trial, but live provider,
  physical Windows/WSL, Feishu bot long-connection, and completed
  first-user feedback evidence still require real external artifacts.
- The next product risk is operational: first users and maintainers need a
  clear, secret-safe loop for running the trial, filing feedback, and deciding
  whether an outcome unlocks a gate or becomes a follow-up defect.
- `upload_img/` remains unrelated untracked local data and is outside milestone
  scope.

## v1.5 Requirements

### Product Position

- [x] **TRIALOPS-01**: OpenForge remains a local-first AI CLI control plane with
  AI-native execution traceability; v1.5 does not add hosted collaboration,
  cloud workers, autonomous remote execution, Feishu execution authority, or
  Codex Web prompt/turn workflow.
- [x] **TRIALOPS-02**: v1.5 turns readiness into a first-user operating loop:
  run trial steps, collect bounded evidence, file feedback, triage outcome, and
  update gate status only when the required artifact exists.
- [x] **TRIALOPS-03**: Trial evidence and feedback route through existing
  canonical paths instead of creating competing source-of-truth documents.

### Trial Packet

- [x] **TRIALOPS-04**: A minimum completed first-user trial packet must include
  affected surface, severity, owner, disposition or next action, environment
  summary, reproduction detail, diagnostics status or unavailable reason,
  follow-up route or no-action rationale, and redaction review.
- [x] **TRIALOPS-05**: Trial outcomes must map to one of: gate-clearing evidence,
  preserved caveat/blocker, product defect, documentation/support gap, or
  explicit no-action rationale.
- [x] **TRIALOPS-06**: Trial routes must preserve links to issue #3
  (`LIVE-PROVIDER`), issue #4 (`WINDOWS-WSL`), issue #5
  (`FIRST-USER-FEEDBACK`), and `FEISHU-BOT-WS` evidence or an optional public
  callback compatibility artifact.
- [x] **TRIALOPS-07**: Root and localized README trial entrypoints must expose
  both first-user feedback collection paths: Markdown packet template and
  GitHub issue form.
- [x] **TRIALOPS-08**: Completed first-user feedback must include Copilot
  smoke/provider, prompt, read-tool, pending-action, memory-write, and
  terminal-boundary evidence before maintainer triage.
- [x] **TRIALOPS-09**: Maintainers must be able to discover and audit
  non-tracker GitHub `trial-feedback` issue candidates in one read-only pass
  before maintainer triage.

### Evidence Safety

- [x] **TRIALSAFE-01**: `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-BOT-WS`, and
  `FIRST-USER-FEEDBACK` keep their registry states unless
  `docs/EXTERNAL-EVIDENCE-GATES.md` clearing conditions are satisfied.
- [x] **TRIALSAFE-02**: First-user trial guidance must not ask users to paste
  API keys, JWTs, attach tokens, raw terminal transcripts, raw provider
  payloads, raw Feishu bodies, local databases, `.env` files, or private AI CLI
  config.
- [x] **TRIALSAFE-03**: Any automation proposed later in v1.5 must produce
  bounded metadata or prefilled issue/report fields only; raw evidence blob
  storage remains out of scope.

### Phase 21 Planning Closure

- [x] **PLAN-21-01**: Active source-of-truth docs select v1.5 and Phase 21
  instead of leaving the next milestone unselected.
- [x] **PLAN-21-02**: Phase 21 has context, design, and implementation plan
  artifacts with exact files and verification commands.
- [x] **PLAN-21-03**: Phase 21 verification proves milestone references,
  preserved external gate states, and secret-safe evidence wording.

### Operator Dry Run

- [x] **DRYRUN-01**: Maintainer/operator can run a current-host dry-run that
  records dependency versions, WSL classification, and `openforge doctor`
  terminal-runtime status without requesting secrets or raw local output.
- [x] **DRYRUN-02**: Source startup health is verified with bounded loopback
  evidence for Gateway `/api/v1/health` and Web `/login`, and temporary
  processes are stopped afterwards.
- [x] **DRYRUN-03**: Provider-smoke collection records the missing disposable
  credential path as `missing_provider_credential` and preserves
  `LIVE-PROVIDER` as `Caveat`.
- [x] **DRYSAFE-01**: Operator dry-run evidence is explicitly not completed
  first-user feedback and cannot clear `FIRST-USER-FEEDBACK`.
- [x] **DRYSAFE-02**: The dry-run records source-startup `.env` override
  behavior as a docs/support gap without exposing `.env` contents or local
  database contents.

### Phase 22 Planning Closure

- [x] **PLAN-22-01**: Phase 22 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-22-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect Phase 22 completion while keeping real
  first-user packet collection pending.
- [x] **PLAN-22-03**: Phase 22 verification proves external gate states remain
  unchanged and no secret-like evidence wording was introduced.

### Source Fallback Env Runner

- [x] **ENVRUN-01**: Source fallback Gateway/Web scripts load repository root
  `.env` without overwriting command-prefix environment variables.
- [x] **ENVRUN-02**: Gateway source `dev` and `start` scripts run through the
  env-preserving runner while preserving existing command shapes.
- [x] **ENVRUN-03**: Web source `build`, `dev`, and `start` scripts run through
  the env-preserving runner, and Web `dev`/`start` still apply default host and
  port values after env loading.
- [x] **ENVRUN-04**: CI script harness tests cover `.env` merge precedence and
  Gateway/Web package script wiring.
- [x] **ENVSAFE-01**: Source fallback docs describe env precedence and
  disposable-state usage without exposing `.env` contents, secrets, local
  databases, or raw terminal output.

### Phase 23 Planning Closure

- [x] **PLAN-23-01**: Phase 23 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-23-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the source env-runner fix while keeping
  real first-user packet collection pending.
- [x] **PLAN-23-03**: Phase 23 verification proves red/green test coverage,
  real Gateway/Web prefix smoke behavior, and unchanged external gate states.

### Trial Feedback Intake Contract

- [x] **INTAKE-01**: The GitHub first-user trial feedback issue form must keep
  required field IDs, field types, required dropdown options, mandatory-field
  `required: true` flags, owner/disposition routing, and safety confirmations.
- [x] **INTAKE-02**: The Markdown trial feedback template must keep minimum
  packet sections, dependency/version checks, diagnostics export guidance,
  triage routing, Copilot evidence, terminal evidence, and bounded support
  notes.
- [x] **INTAKE-03**: Public intake language must reject affirmative requests to
  paste, upload, submit, or attach raw evidence, or to paste keys/tokens.
- [x] **INTAKE-04**: CI must run the intake contract validator test with the
  existing script harness tests.
- [x] **INTAKESAFE-01**: Validating empty templates or form structure must not
  be treated as a completed first-user feedback packet or clear any external
  evidence gate.

### Phase 24 Planning Closure

- [x] **PLAN-24-01**: Phase 24 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-24-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the intake contract validation while
  keeping real first-user packet collection pending.
- [x] **PLAN-24-03**: Phase 24 verification proves red/green validator test
  coverage, CI script harness wiring, safety wording checks, and unchanged
  external gate states.

### Tokenless Trial Diagnostics

- [x] **RUNBOOKSAFE-01**: First-user diagnostics guidance must use Web Settings
  diagnostics export instead of asking users to retrieve browser auth tokens.
- [x] **RUNBOOKSAFE-02**: Any local API diagnostics fallback must be labeled
  maintainer-only and must use the maintainer's own authenticated environment.
- [x] **RUNBOOKSAFE-03**: The trial intake validator must reject runbook
  guidance that asks first users to open browser developer tools, read Local
  Storage, use `openforge.token`, or run curl with
  `authorization: Bearer <token>`.

### Phase 25 Planning Closure

- [x] **PLAN-25-01**: Phase 25 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-25-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the tokenless runbook diagnostics fix
  while keeping real first-user packet collection pending.
- [x] **PLAN-25-03**: Phase 25 verification proves red/green validator
  coverage, runbook token fallback removal, CI script harness coverage, and
  unchanged external gate states.

### Trial Feedback Draft Generator

- [x] **DRAFT-01**: A local command must generate a first-user feedback
  Markdown draft with bounded environment metadata and required packet sections.
- [x] **DRAFT-02**: The draft must explicitly state that it is not submitted,
  not reviewed, and not gate-clearing evidence.
- [x] **DRAFT-03**: Trial runbook, checklist, and feedback template must link
  the draft helper as optional support for real feedback collection.
- [x] **DRAFTSAFE-01**: The draft helper must not export diagnostics, read
  browser storage, read tokens, upload files, or collect raw terminal,
  provider, or Feishu evidence; token-shaped values in draft fields are
  redacted.

### Phase 26 Planning Closure

- [x] **PLAN-26-01**: Phase 26 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-26-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the feedback draft helper while keeping
  real first-user packet collection pending.
- [x] **PLAN-26-03**: Phase 26 verification proves red/green generator tests,
  script harness coverage, CLI smoke output, docs references, and unchanged
  external gate states.

### Trial Feedback Packet Audit

- [x] **PACKETAUDIT-01**: A local command must audit completed Markdown
  feedback packets for required sections, field values, completed reproduction
  steps, expected and actual behavior, diagnostics status, triage routing,
  browser evidence summaries, and bounded support summaries.
- [x] **PACKETAUDIT-02**: The audit must reject generated drafts,
  placeholder-only packets, missing required fields, and incomplete expected or
  actual behavior sections before maintainer triage.
- [x] **PACKETAUDIT-03**: The audit must reject obvious secret-like content,
  including bearer tokens, `sk-*` keys, `openforge.token`, OpenForge secret
  environment assignments, and generic key/token/password/private-key
  assignments.
- [x] **PACKETSAFE-01**: A passing audit means ready for maintainer triage only;
  it must not automatically clear `FIRST-USER-FEEDBACK` or any other external
  evidence gate.

### Phase 27 Planning Closure

- [x] **PLAN-27-01**: Phase 27 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-27-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the feedback packet audit while keeping
  real first-user packet collection pending.
- [x] **PLAN-27-03**: Phase 27 verification proves audit tests, CI script
  harness coverage, CLI rejection of generated drafts, docs references, and
  unchanged external gate states.

### External Evidence Gate Drift Guard

- [x] **GATEGUARD-01**: A local command must validate that
  `docs/EXTERNAL-EVIDENCE-GATES.md` contains all required external gate rows:
  `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-BOT-WS`, and
  `FIRST-USER-FEEDBACK`.
- [x] **GATEGUARD-02**: The validator must reject accidental current-state
  drift from `LIVE-PROVIDER=Caveat`, `WINDOWS-WSL=Caveat`,
  `FEISHU-BOT-WS=Caveat`, and `FIRST-USER-FEEDBACK=Caveat`.
- [x] **GATEGUARD-03**: The validator and registry must preserve concrete
  rerun and target anchors, including `pnpm smoke:copilot-provider` for
  `LIVE-PROVIDER` and `pnpm trial:feedback-audit` for
  `FIRST-USER-FEEDBACK`.
- [x] **GATESAFE-01**: Gate validation must not collect evidence, attach
  artifacts, or move any external gate to `Pass` by itself.

### Phase 28 Planning Closure

- [x] **PLAN-28-01**: Phase 28 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-28-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the gate drift guard while keeping real
  first-user packet collection pending.
- [x] **PLAN-28-03**: Phase 28 verification proves validator tests, CI script
  harness coverage, CLI smoke, docs references, and unchanged external gate
  states.

### Trial Materials Consistency Guard

- [x] **MATERIALS-01**: The trial intake validator must read
  `docs/TRIAL-CHECKLIST.md` by default alongside the GitHub issue form,
  Markdown feedback template, and trial runbook.
- [x] **MATERIALS-02**: The checklist contract must preserve the first-user
  entry-point wording, external gate registry reference, `pnpm
  trial:intake-validate`, `pnpm trial:issue-routes-validate`,
  `pnpm trial:readiness-validate`, `pnpm trial:feedback-audit`, `pnpm
  evidence:gates-validate`, `FIRST-USER-FEEDBACK`, follow-up routing, and
  redaction review anchors.
- [x] **MATERIALS-03**: Checklist validation must reject unsafe raw-evidence
  language and non-negated browser-token guidance such as browser developer
  tools, Local Storage, `openforge.token`, or `authorization: Bearer <token>`.
- [x] **MATERIALSSAFE-01**: Trial-material validation must not collect
  feedback, export diagnostics, upload artifacts, submit issues, or clear any
  external evidence gate.

### Phase 29 Planning Closure

- [x] **PLAN-29-01**: Phase 29 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-29-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the trial materials consistency guard
  while keeping real first-user packet collection pending.
- [x] **PLAN-29-03**: Phase 29 verification proves red/green checklist drift
  coverage, CLI validation, script harness coverage, docs references, and
  unchanged external gate states.

### Trial Issue Route Preflight

- [x] **ROUTE-01**: A maintainer-run command must validate that GitHub issue
  #3 maps to `LIVE-PROVIDER`, issue #4 maps to `WINDOWS-WSL`, and issue #5
  maps to `FIRST-USER-FEEDBACK`.
- [x] **ROUTE-02**: The route validator must reject missing, unreadable,
  closed, mistitled, or mislabeled follow-up issues.
- [x] **ROUTE-03**: CI must cover the route validator contract with mocked
  issue data so CI does not depend on live GitHub network/auth state.
- [x] **ROUTESAFE-01**: Route validation must be read-only and must not create,
  update, close, label, or comment on GitHub issues, collect feedback, attach
  artifacts, or clear any external evidence gate.

### Phase 30 Planning Closure

- [x] **PLAN-30-01**: Phase 30 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-30-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the trial issue route preflight while
  keeping real first-user packet collection pending.
- [x] **PLAN-30-03**: Phase 30 verification proves red/green route tests, live
  route preflight, script harness coverage, docs references, and unchanged
  external gate states.

### Trial Readiness Preflight Bundle

- [x] **READY-01**: A maintainer-run command must aggregate trial intake
  validation, GitHub issue-route validation, and external evidence gate
  registry validation before real collection starts.
- [x] **READY-02**: The readiness command must return per-check status,
  prefixed aggregate errors, and next-step guidance.
- [x] **READY-03**: CI must cover the readiness aggregate contract with mocked
  validator results so CI does not depend on live GitHub network/auth state.
- [x] **READYSAFE-01**: Readiness validation must be read-only and must not
  collect feedback, submit GitHub issues, attach artifacts, or clear any
  external evidence gate. The aggregate must fail if a subcheck claims
  gate-clearing evidence.

### Phase 31 Planning Closure

- [x] **PLAN-31-01**: Phase 31 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-31-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the trial readiness preflight bundle
  while keeping real first-user packet collection pending.
- [x] **PLAN-31-03**: Phase 31 verification proves red/green readiness tests,
  live readiness preflight, script harness coverage, docs references, and
  unchanged external gate states.

### Trial Feedback Issue Audit

- [x] **ISSUEAUDIT-01**: A maintainer-run command must audit a GitHub
  issue-form feedback issue by issue number.
- [x] **ISSUEAUDIT-02**: The issue audit must require the `trial-feedback`
  label and convert issue-form sections into the existing Markdown packet audit
  shape.
- [x] **ISSUEAUDIT-03**: The issue audit must reject incomplete issue bodies
  and secret-like raw issue body content before maintainer triage.
- [x] **ISSUEAUDITSAFE-01**: Issue audit must be read-only and must not comment
  on issues, mutate labels, attach artifacts, close issues, or clear any
  external evidence gate.

### Phase 32 Planning Closure

- [x] **PLAN-32-01**: Phase 32 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-32-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the trial feedback issue audit while
  keeping real first-user packet collection pending.
- [x] **PLAN-32-03**: Phase 32 verification proves red/green issue audit tests,
  mocked script harness coverage, expected live rejection of the tracker issue,
  docs references, and unchanged external gate states.

### External Gate Issue Audit Rerun Guard

- [x] **GATEISSUE-01**: The external evidence gate registry must name
  `pnpm trial:feedback-issue-audit` in the `FIRST-USER-FEEDBACK` rerun path
  alongside the Markdown packet audit.
- [x] **GATEISSUE-02**: The external evidence gate validator must fail if the
  issue audit command is removed from the `FIRST-USER-FEEDBACK` rerun path.
- [x] **GATEISSUE-03**: The guard must keep `FIRST-USER-FEEDBACK` as `Caveat`
  until a completed, redacted, reviewed first-user artifact exists.

### Phase 33 Planning Closure

- [x] **PLAN-33-01**: Phase 33 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-33-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the external gate issue-audit rerun guard
  while keeping real first-user packet collection pending.
- [x] **PLAN-33-03**: Phase 33 verification proves red/green gate-validator
  coverage, aggregate readiness validation, docs references, and unchanged
  external gate states.

### First-User Entrypoint Audit Route Guard

- [x] **ENTRYPOINT-01**: Public and support first-user entrypoints must name
  both completed-feedback collection paths: Markdown packet and GitHub issue
  form.
- [x] **ENTRYPOINT-02**: Public and support first-user entrypoints must name
  both maintainer audit commands before triage:
  `pnpm trial:feedback-audit` and `pnpm trial:feedback-issue-audit`.
- [x] **ENTRYPOINTSAFE-01**: Entrypoint validation must remain structural only
  and must not collect feedback, submit issues, attach artifacts, or clear any
  external evidence gate.

### Phase 34 Planning Closure

- [x] **PLAN-34-01**: Phase 34 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-34-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the first-user entrypoint audit-route
  guard while keeping real first-user packet collection pending.
- [x] **PLAN-34-03**: Phase 34 verification proves red/green intake-validator
  coverage, aggregate readiness validation, docs references, and unchanged
  external gate states.

### README Trial Entrypoint Guard

- [x] **READMEENTRY-01**: The root README First User Trial section must link
  the trial runbook, trial checklist, troubleshooting, Markdown feedback
  template, and GitHub feedback issue form.
- [x] **READMEENTRY-02**: The localized README first-user trial sections must
  preserve equivalent runbook, checklist, troubleshooting, feedback template,
  and GitHub feedback issue-form links.
- [x] **READMEENTRY-03**: The trial intake validator must read `README.md`,
  `docs/README.zh-CN.md`, and `docs/README.zh-TW.md` by default and reject
  missing trial-entrypoint links.
- [x] **READMEENTRYSAFE-01**: README trial-entrypoint validation must remain
  structural only and must not collect feedback, submit issues, attach
  artifacts, or clear any external evidence gate.

### Phase 35 Planning Closure

- [x] **PLAN-35-01**: Phase 35 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-35-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the README trial-entrypoint guard while
  keeping real first-user packet collection pending.
- [x] **PLAN-35-03**: Phase 35 verification proves red/green intake-validator
  coverage, aggregate readiness validation, docs references, and unchanged
  external gate states.

### Copilot Evidence Packet Audit Guard

- [x] **COPILOTAUDIT-01**: Markdown feedback packet audit must reject
  completed-looking packets missing Copilot smoke/provider, prompt, read-tool,
  pending-action, memory-write, or terminal-boundary evidence.
- [x] **COPILOTAUDIT-02**: GitHub issue-form feedback audit must map Copilot
  issue fields into the Markdown packet shape before applying the packet audit.
- [x] **COPILOTAUDIT-03**: Trial intake validation and generated drafts must
  preserve the Copilot evidence prompts required by packet audit.
- [x] **COPILOTAUDITSAFE-01**: Copilot evidence audit must remain structural
  and triage-readiness only; it must not collect evidence, submit issues,
  attach artifacts, or clear any external evidence gate.

### Phase 36 Planning Closure

- [x] **PLAN-36-01**: Phase 36 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-36-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the Copilot evidence packet audit guard
  while keeping real first-user packet collection pending.
- [x] **PLAN-36-03**: Phase 36 verification proves red/green packet and issue
  audit coverage, intake validation, aggregate readiness validation, docs
  references, and unchanged external gate states.

### Trial Feedback Candidate Issue Audit

- [x] **ISSUECAND-01**: Batch GitHub feedback issue audit must list
  `trial-feedback` issues and skip known route tracker issues.
- [x] **ISSUECAND-02**: Non-tracker candidate issues must be audited through
  the existing single GitHub issue-form audit path and summarized as ready or
  blocked for maintainer triage.
- [x] **ISSUECANDSAFE-01**: Candidate issue audit must be read-only and must
  return `gateClearingEvidence: false`; it must not collect feedback, mutate
  issues, attach artifacts, or clear external gates.

### Phase 37 Planning Closure

- [x] **PLAN-37-01**: Phase 37 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-37-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect the trial feedback candidate issue audit
  while keeping real first-user packet collection pending.
- [x] **PLAN-37-03**: Phase 37 verification proves red/green candidate audit,
  intake validation, external gate validation, live candidate scan, aggregate
  readiness validation, docs references, and unchanged external gate states.

## Out of Scope

| Feature | Reason |
|---------|--------|
| New runtime capability | v1.5 starts with trial operations, not product surface expansion. |
| Hosted collaboration, cloud deployment, billing, marketplace, telemetry | Requires separate architecture and security review. |
| Autonomous remote execution or unattended coding loops | Changes authority boundaries and threat model. |
| Feishu free-form approvals or terminal input | Feishu remains controlled collaboration ingress only. |
| Codex app-server Web turn input | The feature-flag prototype remains default-disabled and not user-facing. |
| Raw evidence blob storage | Evidence remains bounded references and redacted artifacts. |
| Clearing external caveats without artifacts | The v1.4 registry remains authoritative. |

## Traceability

| Requirement | Target Phase | Status |
|-------------|--------------|--------|
| TRIALOPS-01 | Phase 21 | Complete |
| TRIALOPS-02 | Phase 21 | Complete |
| TRIALOPS-03 | Phase 21 | Complete |
| TRIALOPS-04 | Phase 21 | Complete |
| TRIALOPS-05 | Phase 21 | Complete |
| TRIALOPS-06 | Phase 21 | Complete |
| TRIALOPS-07 | Phase 35 | Complete |
| TRIALOPS-08 | Phase 36 | Complete |
| TRIALOPS-09 | Phase 37 | Complete |
| TRIALSAFE-01 | Phase 21 | Complete |
| TRIALSAFE-02 | Phase 21 | Complete |
| TRIALSAFE-03 | Phase 21 | Complete |
| PLAN-21-01 | Phase 21 | Complete |
| PLAN-21-02 | Phase 21 | Complete |
| PLAN-21-03 | Phase 21 | Complete |
| DRYRUN-01 | Phase 22 | Complete |
| DRYRUN-02 | Phase 22 | Complete |
| DRYRUN-03 | Phase 22 | Complete |
| DRYSAFE-01 | Phase 22 | Complete |
| DRYSAFE-02 | Phase 22 | Complete |
| PLAN-22-01 | Phase 22 | Complete |
| PLAN-22-02 | Phase 22 | Complete |
| PLAN-22-03 | Phase 22 | Complete |
| ENVRUN-01 | Phase 23 | Complete |
| ENVRUN-02 | Phase 23 | Complete |
| ENVRUN-03 | Phase 23 | Complete |
| ENVRUN-04 | Phase 23 | Complete |
| ENVSAFE-01 | Phase 23 | Complete |
| PLAN-23-01 | Phase 23 | Complete |
| PLAN-23-02 | Phase 23 | Complete |
| PLAN-23-03 | Phase 23 | Complete |
| INTAKE-01 | Phase 24 | Complete |
| INTAKE-02 | Phase 24 | Complete |
| INTAKE-03 | Phase 24 | Complete |
| INTAKE-04 | Phase 24 | Complete |
| INTAKESAFE-01 | Phase 24 | Complete |
| PLAN-24-01 | Phase 24 | Complete |
| PLAN-24-02 | Phase 24 | Complete |
| PLAN-24-03 | Phase 24 | Complete |
| RUNBOOKSAFE-01 | Phase 25 | Complete |
| RUNBOOKSAFE-02 | Phase 25 | Complete |
| RUNBOOKSAFE-03 | Phase 25 | Complete |
| PLAN-25-01 | Phase 25 | Complete |
| PLAN-25-02 | Phase 25 | Complete |
| PLAN-25-03 | Phase 25 | Complete |
| DRAFT-01 | Phase 26 | Complete |
| DRAFT-02 | Phase 26 | Complete |
| DRAFT-03 | Phase 26 | Complete |
| DRAFTSAFE-01 | Phase 26 | Complete |
| PLAN-26-01 | Phase 26 | Complete |
| PLAN-26-02 | Phase 26 | Complete |
| PLAN-26-03 | Phase 26 | Complete |
| PACKETAUDIT-01 | Phase 27 | Complete |
| PACKETAUDIT-02 | Phase 27 | Complete |
| PACKETAUDIT-03 | Phase 27 | Complete |
| PACKETSAFE-01 | Phase 27 | Complete |
| PLAN-27-01 | Phase 27 | Complete |
| PLAN-27-02 | Phase 27 | Complete |
| PLAN-27-03 | Phase 27 | Complete |
| GATEGUARD-01 | Phase 28 | Complete |
| GATEGUARD-02 | Phase 28 | Complete |
| GATEGUARD-03 | Phase 28 | Complete |
| GATESAFE-01 | Phase 28 | Complete |
| PLAN-28-01 | Phase 28 | Complete |
| PLAN-28-02 | Phase 28 | Complete |
| PLAN-28-03 | Phase 28 | Complete |
| MATERIALS-01 | Phase 29 | Complete |
| MATERIALS-02 | Phase 29 | Complete |
| MATERIALS-03 | Phase 29 | Complete |
| MATERIALSSAFE-01 | Phase 29 | Complete |
| PLAN-29-01 | Phase 29 | Complete |
| PLAN-29-02 | Phase 29 | Complete |
| PLAN-29-03 | Phase 29 | Complete |
| ROUTE-01 | Phase 30 | Complete |
| ROUTE-02 | Phase 30 | Complete |
| ROUTE-03 | Phase 30 | Complete |
| ROUTESAFE-01 | Phase 30 | Complete |
| PLAN-30-01 | Phase 30 | Complete |
| PLAN-30-02 | Phase 30 | Complete |
| PLAN-30-03 | Phase 30 | Complete |
| READY-01 | Phase 31 | Complete |
| READY-02 | Phase 31 | Complete |
| READY-03 | Phase 31 | Complete |
| READYSAFE-01 | Phase 31 | Complete |
| PLAN-31-01 | Phase 31 | Complete |
| PLAN-31-02 | Phase 31 | Complete |
| PLAN-31-03 | Phase 31 | Complete |
| ISSUEAUDIT-01 | Phase 32 | Complete |
| ISSUEAUDIT-02 | Phase 32 | Complete |
| ISSUEAUDIT-03 | Phase 32 | Complete |
| ISSUEAUDITSAFE-01 | Phase 32 | Complete |
| PLAN-32-01 | Phase 32 | Complete |
| PLAN-32-02 | Phase 32 | Complete |
| PLAN-32-03 | Phase 32 | Complete |
| GATEISSUE-01 | Phase 33 | Complete |
| GATEISSUE-02 | Phase 33 | Complete |
| GATEISSUE-03 | Phase 33 | Complete |
| PLAN-33-01 | Phase 33 | Complete |
| PLAN-33-02 | Phase 33 | Complete |
| PLAN-33-03 | Phase 33 | Complete |
| ENTRYPOINT-01 | Phase 34 | Complete |
| ENTRYPOINT-02 | Phase 34 | Complete |
| ENTRYPOINTSAFE-01 | Phase 34 | Complete |
| PLAN-34-01 | Phase 34 | Complete |
| PLAN-34-02 | Phase 34 | Complete |
| PLAN-34-03 | Phase 34 | Complete |
| READMEENTRY-01 | Phase 35 | Complete |
| READMEENTRY-02 | Phase 35 | Complete |
| READMEENTRY-03 | Phase 35 | Complete |
| READMEENTRYSAFE-01 | Phase 35 | Complete |
| PLAN-35-01 | Phase 35 | Complete |
| PLAN-35-02 | Phase 35 | Complete |
| PLAN-35-03 | Phase 35 | Complete |
| COPILOTAUDIT-01 | Phase 36 | Complete |
| COPILOTAUDIT-02 | Phase 36 | Complete |
| COPILOTAUDIT-03 | Phase 36 | Complete |
| COPILOTAUDITSAFE-01 | Phase 36 | Complete |
| PLAN-36-01 | Phase 36 | Complete |
| PLAN-36-02 | Phase 36 | Complete |
| PLAN-36-03 | Phase 36 | Complete |
| ISSUECAND-01 | Phase 37 | Complete |
| ISSUECAND-02 | Phase 37 | Complete |
| ISSUECANDSAFE-01 | Phase 37 | Complete |
| PLAN-37-01 | Phase 37 | Complete |
| PLAN-37-02 | Phase 37 | Complete |
| PLAN-37-03 | Phase 37 | Complete |

**Coverage:**
- v1.5 requirements: 126 total
- Mapped to phases: 126
- Unmapped: 0

---
*Requirements updated: 2026-05-29 after Phase 37 Trial Feedback Candidate Issue Audit.*
