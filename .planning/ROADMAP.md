# Roadmap: OpenForge

## Milestones

- ✅ **v1.0 Post-Beta Trust Closure** — Phases 1-5, shipped 2026-05-20.
- ✅ **v1.1 Beta Evidence Burn-down** — Phases 6-8, shipped 2026-05-21.
- ✅ **v1.2 Project Manager Web Workflow** — Phases 9-11, shipped 2026-05-22.
- ✅ **v1.3 AI-Native Project Execution Traceability** — Phases 12-16, shipped 2026-05-29.
- ✅ **v1.4 External Evidence Closure** — Phases 17-20, shipped 2026-05-29.
- 🟡 **v1.5 First-User Trial Operations** — Operations-tooling closeout recorded in `docs/reports/v1.5-first-user-trial-operations-closeout-2026-05-29.md`; real trial packet collection pending.
- 🔜 **v1.6 Competitive Differentiation Loop** — Competitor-informed candidate milestone in `docs/COMPETITIVE-DIFFERENTIATION-PLAN.md`; start only after v1.5 evidence is collected or explicitly reprioritized.

## Current Milestone: v1.5 First-User Trial Operations

**Goal:** Turn cautious local-first readiness into an operator-run first-user
trial loop with redacted evidence routing, feedback triage, and truthful gate
decisions.

**Scope rule:** v1.5 operationalizes real trial collection for the existing
local-first AI CLI control plane. It does not add hosted collaboration, cloud
workers, autonomous remote execution, Feishu execution authority, or Codex Web
prompt/turn product workflow.

**Entry condition:** v1.4 is complete with `LIVE-PROVIDER`, `WINDOWS-WSL`, and
`FIRST-USER-FEEDBACK` preserved as `Caveat`, plus a historical
`FEISHU-CALLBACK=Blocked` public webhook baseline. The current Feishu registry
gate is `FEISHU-BOT-WS=Caveat`.

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
4. `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-BOT-WS`, and
   `FIRST-USER-FEEDBACK` keep their registry states unless a real required
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
   `WINDOWS-WSL=Caveat`, `FEISHU-BOT-WS=Caveat`, and
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
2. Checklist drift tests reject missing intake-validation, issue-route,
   readiness, packet-audit, and external-gate-validation commands.
3. Checklist safety checks reject unsafe raw-evidence wording and
   non-negated browser-token guidance.
4. Trial docs name `pnpm trial:intake-validate` as a local
   materials-consistency guard.
5. The validator does not collect first-user feedback, export diagnostics,
   upload artifacts, submit issues, or clear any external gate.

### Phase 30: Trial Issue Route Preflight

**Goal:** Add a maintainer preflight that verifies GitHub follow-up issue routes
#3, #4, and #5 remain usable before routing real first-user trial evidence.

**Requirements:** ROUTE-01, ROUTE-02, ROUTE-03, ROUTESAFE-01,
PLAN-30-01, PLAN-30-02, PLAN-30-03

**Plans:** 1 plan

Plans:

- [x] 30-01-PLAN.md — issue-route validator, live preflight, CI harness test,
  docs sync, and gate-preserving verification.

**Success criteria:**

1. A root command validates issue #3, #4, and #5 route metadata.
2. The command rejects missing, closed, mistitled, or mislabeled route issues.
3. The command reports `gateClearingEvidence: false`.
4. CI covers the route contract through mocked issue data, not live GitHub
   mutation or network-dependent release claims.
5. Trial docs describe the preflight as read-only and non-gate-clearing.

### Phase 31: Trial Readiness Preflight Bundle

**Goal:** Add a maintainer preflight that runs trial intake, issue-route, and
external gate registry checks together before a real first-user collection
round.

**Requirements:** READY-01, READY-02, READY-03, READYSAFE-01,
PLAN-31-01, PLAN-31-02, PLAN-31-03

**Plans:** 1 plan

Plans:

- [x] 31-01-PLAN.md — readiness validator, live preflight, CI harness test,
  docs sync, and gate-preserving verification.

**Success criteria:**

1. A root command runs trial intake, issue-route, and external gate registry
   validation together.
2. The command returns per-check status, prefixed errors, next steps, and
   `gateClearingEvidence: false`.
3. The command fails if any subcheck claims gate-clearing evidence.
4. CI covers the aggregate readiness contract through mocked validators, not
   live GitHub network/auth state.
5. Trial docs describe the preflight as read-only and non-gate-clearing.

### Phase 32: Trial Feedback Issue Audit

**Goal:** Add a maintainer audit command that reads GitHub issue-form trial
feedback and applies the existing packet audit before human triage.

**Requirements:** ISSUEAUDIT-01, ISSUEAUDIT-02, ISSUEAUDIT-03,
ISSUEAUDITSAFE-01, PLAN-32-01, PLAN-32-02, PLAN-32-03

**Plans:** 1 plan

Plans:

- [x] 32-01-PLAN.md — issue body adapter, read-only GitHub audit command,
  mocked CI harness test, docs sync, and gate-preserving verification.

**Success criteria:**

1. A root command audits a GitHub issue-form feedback issue by number.
2. The command requires the `trial-feedback` label and converts issue-form
   fields into the existing packet audit shape.
3. Secret-like content in the raw issue body is rejected.
4. CI covers the issue audit through mocked issue data, not live GitHub
   mutation or network-dependent release claims.
5. Trial docs describe the audit as read-only and non-gate-clearing.

### Phase 33: External Gate Issue Audit Rerun Guard

**Goal:** Ensure the canonical external evidence gate registry protects the
GitHub issue-form feedback audit rerun path for `FIRST-USER-FEEDBACK`.

**Requirements:** GATEISSUE-01, GATEISSUE-02, GATEISSUE-03, PLAN-33-01,
PLAN-33-02, PLAN-33-03

**Plans:** 1 plan

Plans:

- [x] 33-01-PLAN.md — gate registry rerun-path update, validator regression,
  source-of-truth sync, and gate-preserving verification.

**Success criteria:**

1. `docs/EXTERNAL-EVIDENCE-GATES.md` names both first-user audit commands:
   `pnpm trial:feedback-audit` and `pnpm trial:feedback-issue-audit`.
2. `pnpm evidence:gates-validate` fails if the issue audit command is removed
   from the `FIRST-USER-FEEDBACK` rerun path.
3. `FIRST-USER-FEEDBACK` remains `Caveat`.
4. The guard does not collect evidence, submit issues, attach artifacts, or
   clear external gates.
5. Planning and report docs keep real first-user packet collection pending.

### Phase 34: First-User Entrypoint Audit Route Guard

**Goal:** Keep public and support first-user entrypoints aligned with the
feedback packet and issue-form audit routes.

**Requirements:** ENTRYPOINT-01, ENTRYPOINT-02, ENTRYPOINTSAFE-01,
PLAN-34-01, PLAN-34-02, PLAN-34-03

**Plans:** 1 plan

Plans:

- [x] 34-01-PLAN.md — intake validator entrypoint coverage, public/support doc
  sync, source-of-truth updates, and gate-preserving verification.

**Success criteria:**

1. `docs/OPEN-SOURCE-READINESS.md` names both first-user feedback audit
   commands before maintainer triage.
2. `docs/SUPPORT-DIAGNOSTICS.md` routes missing completed first-user feedback
   through Markdown packet or GitHub issue-form audit before triage.
3. `pnpm trial:intake-validate` fails if either entrypoint drops the audit
   commands or collection paths.
4. `FIRST-USER-FEEDBACK` remains `Caveat`.
5. The guard does not collect evidence, submit issues, attach artifacts, or
   clear external gates.

### Phase 35: README Trial Entrypoint Guard

**Goal:** Keep the repository README and localized README trial entrypoints
aligned with both first-user feedback collection paths.

**Requirements:** TRIALOPS-07, READMEENTRY-01, READMEENTRY-02,
READMEENTRY-03, READMEENTRYSAFE-01, PLAN-35-01, PLAN-35-02, PLAN-35-03

**Plans:** 1 plan

Plans:

- [x] 35-01-PLAN.md — README trial-entrypoint validator coverage, root README
  sync, source-of-truth updates, and gate-preserving verification.

**Success criteria:**

1. `README.md` links the GitHub feedback issue form from the First User Trial
   section.
2. `pnpm trial:intake-validate` reads `README.md`,
   `docs/README.zh-CN.md`, and `docs/README.zh-TW.md` by default.
3. The validator fails if any README trial entrypoint drops the runbook,
   checklist, troubleshooting, feedback template, or GitHub issue-form link.
4. `FIRST-USER-FEEDBACK` remains `Caveat`.
5. The guard does not collect evidence, submit issues, attach artifacts, or
   clear external gates.

### Phase 36: Copilot Evidence Packet Audit Guard

**Goal:** Ensure completed first-user feedback packets cannot enter maintainer
triage without required Copilot smoke and boundary evidence.

**Requirements:** COPILOTAUDIT-01, COPILOTAUDIT-02, COPILOTAUDIT-03,
COPILOTAUDITSAFE-01, PLAN-36-01, PLAN-36-02, PLAN-36-03

**Plans:** 1 plan

Plans:

- [x] 36-01-PLAN.md — Copilot evidence packet audit coverage, issue adapter
  mapping, intake prompt guard, draft sync, source-of-truth updates, and
  gate-preserving verification.

**Success criteria:**

1. `pnpm trial:feedback-audit -- <packet.md>` rejects completed-looking
   Markdown packets missing Copilot prompt, read-tool, pending-action,
   memory-write, provider, or terminal-boundary evidence fields.
2. `pnpm trial:feedback-issue-audit -- --issue=<number>` maps GitHub issue-form
   Copilot evidence into the same packet audit shape.
3. `pnpm trial:intake-validate` fails if Markdown or GitHub issue-form intake
   materials drop required Copilot evidence prompts.
4. Generated feedback drafts include all prompts required by packet audit.
5. `FIRST-USER-FEEDBACK` remains `Caveat`.
6. The guard does not collect evidence, submit issues, attach artifacts, or
   clear external gates.

### Phase 37: Trial Feedback Candidate Issue Audit

**Goal:** Let maintainers discover and audit GitHub `trial-feedback` issue
candidates in one read-only command without confusing route trackers for
completed first-user feedback.

**Requirements:** TRIALOPS-09, ISSUECAND-01, ISSUECAND-02, ISSUECANDSAFE-01,
PLAN-37-01, PLAN-37-02, PLAN-37-03

**Plans:** 1 plan

Plans:

- [x] 37-01-PLAN.md — GitHub `trial-feedback` candidate discovery, route
  tracker skipping, single-issue audit reuse, docs/gate guards, source-of-truth
  updates, and gate-preserving verification.

**Success criteria:**

1. `pnpm trial:feedback-issues-audit` lists GitHub issues labeled
   `trial-feedback`.
2. Known route tracker issues are skipped and not treated as completed
   feedback.
3. Non-tracker candidates are audited through the existing GitHub issue-form
   audit path and summarized as ready or blocked.
4. The command returns `gateClearingEvidence: false`.
5. Trial docs and external gate registry preserve the bulk candidate audit
   command.
6. The current live candidate scan confirms no completed non-tracker feedback
   issue exists yet, so `FIRST-USER-FEEDBACK` remains `Caveat`.

## Candidate Next Milestone: v1.6 Competitive Differentiation Loop

**Planning source:** `docs/COMPETITIVE-DIFFERENTIATION-PLAN.md`

**Goal:** Turn OpenForge from a broad management console into a differentiated
local-first AI CLI operations cockpit with a fast first-value path, task
packets, reviewable handoff evidence, and Feishu long-connection collaboration.

**Product thesis:** OpenForge should not compete as another AI editor or hosted
autonomous developer. Its defensible wedge is supervising existing AI CLIs from
a browser while preserving local tmux sessions, approval boundaries, and
bounded evidence.

**Scope rule:** v1.6 may improve activation, task/session continuity,
handoff/evidence, Feishu bot long-connection collaboration, and starter packs.
It does not introduce hosted cloud workers, unrestricted Feishu terminal input,
raw terminal storage in SQLite, or Codex Web prompt/turn product workflow.

**Entry condition:** Prefer collecting a real v1.5 first-user trial packet
first. If the user explicitly reprioritizes toward product differentiation,
Phase 38 may start while all existing external gate caveats remain preserved.

### Phase 38: First-Value Activation Loop

**Goal:** Reduce setup friction so a prepared developer can reach a running
local AI CLI session in under 10 minutes.

**Requirements:** ACTIVATION-01, ACTIVATION-02, ACTIVATION-03,
ACTIVATIONSAFE-01, PLAN-38-01, PLAN-38-02, PLAN-38-03

**Plans:** 1 plan

Plans:

- [x] 38-01-PLAN.md — dashboard first-value path, runtime readiness surfacing,
  create/import-to-session flow, and launch-blocker verification.

Progress:

- 2026-06-14: Added the Web first-value activation loop: Dashboard now shows a
  compact readiness path for terminal runtime, CLI adapter, model provider,
  project, template selection, and first session. Runtime blockers surface
  copyable tmux/WSL setup commands in Dashboard, Settings, Project detail, and
  Sessions empty states. The flow links to existing Settings, Models,
  create/import project, and Project detail launch paths without adding Gateway
  launch authority, terminal input, or external gate changes.

**Success criteria:**

1. Dashboard provides a single "start here" path through runtime readiness,
   project create/import, template selection, and session launch.
2. tmux, CLI adapter, provider/model, and project blockers are visible before
   the user reaches the terminal.
3. Every blocker has a concrete next action or copyable setup command.
4. Session launch still uses Gateway/tmux architecture and preserves tenant
   isolation.
5. The phase does not clear `WINDOWS-WSL`, `LIVE-PROVIDER`,
   `FEISHU-BOT-WS`, or `FIRST-USER-FEEDBACK` gates.

### Phase 39: Task Packet And Work Queue

**Goal:** Convert Project Manager work items into launchable AI CLI task
packets with acceptance criteria and evidence expectations.

**Requirements:** TASKPACKET-01, TASKPACKET-02, TASKPACKET-03,
TASKPACKETSAFE-01, PLAN-39-01, PLAN-39-02, PLAN-39-03

**Plans:** 1 plan

Plans:

- [x] 39-01-PLAN.md — task packet model, work queue UI/API, session linking,
  and approval-bound context injection.

Progress:

- 2026-06-13: Added tenant-scoped task packet read/link API, Web API client,
  Project Manager detail-sheet task packet preview, and same-project active
  session linking UI. Remaining scope: start-task session creation/context
  injection and a full work queue view.
- 2026-06-13: Added `task-packet/start` as a safe operator handoff slice: it
  creates or reuses one idle same-project session, links the task packet, and
  stores only bounded context metadata without starting tmux or writing
  terminal input. Remaining scope: full work queue view and richer handoff
  surfacing on the session page.
- 2026-06-14: Added tenant-scoped `task-packets` list API and Web Work Queue
  view that groups bounded task packets by derived queue status, surfaces
  runtime/session markers, and opens the existing work-item detail handoff.
  Remaining scope: richer handoff surfacing on the session page.
- 2026-06-14: Added Session detail task packet handoff surfacing for linked
  sessions: the side panel reads bounded task-packet data, shows the prompt,
  acceptance criteria, expected verification, evidence requirements, and links
  back to the Project Manager work item without writing terminal input or
  storing terminal scrollback. Phase 39 implementation scope is complete.

**Success criteria:**

1. A task packet captures project, CLI adapter, template or agent, prompt,
   acceptance criteria, expected verification, and evidence requirements.
2. A user can start a bugfix, review, or docs task from a work item without
   manually rebuilding context.
3. Running task packets link to exactly one active session or a recorded
   blocked reason.
4. Task packet context injection follows existing session/terminal safety
   boundaries and does not add autonomous host execution authority.
5. Task packet data remains tenant-scoped.

### Phase 40: Session Handoff And Evidence Pack

**Goal:** Make local AI CLI session outcomes reviewable without storing raw
terminal history in SQLite.

**Requirements:** HANDOFF-01, HANDOFF-02, HANDOFF-03, HANDOFFSAFE-01,
PLAN-40-01, PLAN-40-02, PLAN-40-03

**Plans:** 1 plan

Plans:

- [x] 40-01-PLAN.md — bounded handoff summary, redacted Markdown export,
  evidence-pack audit, and review workflow wiring.

Progress:

- 2026-06-14: Added Session detail Markdown handoff/evidence pack generation
  from the linked task packet, session runtime metadata, operator notes,
  verification notes, and open review items. The Web-only export audit blocks
  obvious secrets, placeholders, and raw terminal dumps, and the generated
  packet states that terminal scrollback stays tmux-backed and does not clear
  external evidence gates.

**Success criteria:**

1. A session can produce a bounded handoff summary with task prompt, runtime
   metadata, project/session links, operator notes, verification notes, and
   open review items.
2. Markdown export is redaction-aware and suitable for GitHub or Feishu
   follow-up.
3. The export/audit path rejects obvious secrets, placeholders, and raw
   terminal dumps.
4. Terminal history remains tmux-backed and is not stored in SQLite.
5. Handoff packets do not automatically clear external evidence gates.

### Phase 41: Feishu Long-Connection Collaboration Bridge

**Goal:** Provide a Feishu team entrypoint through bot long connection without
requiring a public callback URL.

**Requirements:** FEISHUWS-01, FEISHUWS-02, FEISHUWS-03, FEISHUWSSAFE-01,
PLAN-41-01, PLAN-41-02, PLAN-41-03

**Plans:** 1 plan

Plans:

- [ ] 41-01-PLAN.md — Feishu long-connection receive path, bounded command
  routing, pending-action replies, reconnect evidence, and gate-safe docs.

Progress:

- 2026-06-14: Added the Gateway Feishu bot long-connection bridge foundation:
  SDK-style `im.message.receive_v1` event normalization, authenticated
  `/bot-websocket/events` route, bounded `/openforge status`, `/openforge
  sessions`, and `/openforge task <id>` reply plans, terminal-input rejection,
  duplicate-message audit guard, and `/bot-websocket/connection-events`
  reconnect evidence recording. Remaining scope: real Feishu bot
  long-connection run and evidence report before `FEISHU-BOT-WS` can move out
  of `Caveat`.
- 2026-06-14: Added `pnpm smoke:feishu-bot-websocket` as an authenticated
  Gateway fixture smoke harness for receive routing, terminal-input rejection,
  and connected/reconnecting/reconnected lifecycle evidence. The script emits
  `gateClearingEvidence=false`, is covered by CI script tests, and is now
  required in the `FEISHU-BOT-WS` rerun path. Remaining scope is still a real
  Feishu bot persistent-connection run and evidence report.
- 2026-06-14: Added `pnpm smoke:feishu-bot-live` using the official
  `@larksuiteoapi/node-sdk` long-connection client. The runner forwards real
  `im.message.receive_v1` events through Gateway policy, sends only bounded
  `replyPlan` text replies, records SDK connection lifecycle callbacks, and
  emits `gateClearingEvidence=true` only when receive, bounded reply,
  reconnect, and terminal-input rejection evidence are present. It can save the
  redacted report with `--output <report.json>`. Remaining scope is a real
  operator run and redacted evidence report.
- 2026-06-14: Added `pnpm evidence:feishu-bot-live-audit -- <report.json>` as
  a saved-report guard for real SDK live evidence. It requires complete live
  evidence and rejects obvious secret-like or raw Feishu identifier content,
  while keeping audit output `gateClearingEvidence=false`.
- 2026-06-14: Added
  `pnpm evidence:feishu-bot-live-report -- --report <report.json> --output
  <report.md>` as a Markdown maintainer-review report generator for
  audit-passing live JSON evidence. The report remains caveat-preserving and
  does not clear `FEISHU-BOT-WS` without maintainer review and registry update.

**Success criteria:**

1. A real Feishu bot long-connection run records receive, OpenForge policy
   routing, bounded reply or pending action, and reconnect behavior.
2. Supported commands are bounded status/task/session queries such as
   `/openforge status`, `/openforge sessions`, and `/openforge task <id>`.
3. Free-form terminal input from Feishu remains rejected.
4. Public webhook callback verification remains optional compatibility
   evidence, not a required launch path.
5. `FEISHU-BOT-WS` remains `Caveat` until the real evidence registry
   requirements are satisfied.

### Phase 42: Starter Packs And Distribution Loop

**Goal:** Make repeatable AI development work immediately useful through
built-in task packs and open-source onboarding copy.

**Requirements:** PACKS-01, PACKS-02, PACKS-03, PACKSSAFE-01,
PLAN-42-01, PLAN-42-02, PLAN-42-03

**Plans:** 1 plan

Plans:

- [x] 42-01-PLAN.md — review, bugfix, docs sync, test generation, release note,
  and first-user evidence task packs plus onboarding positioning.

Progress:

- 2026-06-14: Added the built-in starter pack catalog and Project Manager
  routes for review, bugfix, docs sync, test generation, release notes, and
  first-user evidence packs. Packs create normal tenant-scoped work items and
  derived task packets with bounded prompt frames, acceptance checklists,
  verification guidance, and evidence fields. Web typed API client support and
  open-source onboarding copy were updated. No session is started, no terminal
  input is written, no provider secrets are requested, and external evidence
  caveats remain unchanged.

**Success criteria:**

1. Built-in packs define recommended CLI adapter, prompt frame, acceptance
   checklist, verification guidance, and evidence fields.
2. At least three packs create task packets and handoff exports end to end.
3. Open-source onboarding explains the local-first control-plane positioning
   without claiming to replace AI editors or hosted agents.
4. Packs do not introduce provider secrets, unapproved terminal input, or raw
   transcript collection.
5. Starter packs exercise existing template/skill/agent boundaries instead of
   adding a parallel workflow system.

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
| 29. Trial Materials Consistency Guard | v1.5 | 1/1 | Complete | 2026-05-29 |
| 30. Trial Issue Route Preflight | v1.5 | 1/1 | Complete | 2026-05-29 |
| 31. Trial Readiness Preflight Bundle | v1.5 | 1/1 | Complete | 2026-05-29 |
| 32. Trial Feedback Issue Audit | v1.5 | 1/1 | Complete | 2026-05-29 |
| 33. External Gate Issue Audit Rerun Guard | v1.5 | 1/1 | Complete | 2026-05-29 |
| 34. First-User Entrypoint Audit Route Guard | v1.5 | 1/1 | Complete | 2026-05-29 |
| 35. README Trial Entrypoint Guard | v1.5 | 1/1 | Complete | 2026-05-29 |
| 36. Copilot Evidence Packet Audit Guard | v1.5 | 1/1 | Complete | 2026-05-29 |
| 37. Trial Feedback Candidate Issue Audit | v1.5 | 1/1 | Complete | 2026-05-29 |
| 38. First-Value Activation Loop | v1.6 | 1/1 | Complete | 2026-06-14 |
| 39. Task Packet And Work Queue | v1.6 | 1/1 | Complete | 2026-06-14 |
| 40. Session Handoff And Evidence Pack | v1.6 | 1/1 | Complete | 2026-06-14 |
| 41. Feishu Long-Connection Collaboration Bridge | v1.6 | 0/1 | In Progress (Caveat) | - |
| 42. Starter Packs And Distribution Loop | v1.6 | 1/1 | Complete | 2026-06-14 |

## Backlog

Deferred outside v1.5 unless reprioritized:

- Project-manager global dashboard and advanced analytics.
- Full AI editor replacement or hosted autonomous developer positioning.
- SSH/remote execution runtime implementation from the Phase 5 architecture package.
- Encrypted Feishu payload support if a real Feishu app requires encrypted events.
- Shared replay/rate store implementation for multi-instance public Feishu webhook deployment.
- Agent marketplace and visual agent orchestration beyond the basic project-manager board workflow.
