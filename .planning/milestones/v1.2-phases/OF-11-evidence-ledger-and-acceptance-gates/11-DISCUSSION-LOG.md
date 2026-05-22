# Phase 11: Evidence, Ledger, And Acceptance Gates - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-22
**Phase:** 11-Evidence, Ledger, And Acceptance Gates
**Areas discussed:** Evidence reference attachment, Ledger timeline review, Acceptance path and handoff docs

---

## Evidence Reference Attachment

### Entry Point

| Option | Description | Selected |
|--------|-------------|----------|
| Work item detail Sheet Attach evidence | User inspects a work item first, then attaches evidence from the detail context. | ✓ |
| Work item table row Attach evidence | Faster but makes the list heavier and less scannable. | |
| Create dialog and detail both support attachment | More complete but duplicates Phase 10 initial refs and complicates scope. | |

**User's choice:** Work item detail Sheet only.
**Notes:** Table rows remain for scanning, status actions, and opening details.

### Submission Size

| Option | Description | Selected |
|--------|-------------|----------|
| One reference | Simplest bounded flow and easiest to validate. | ✓ |
| Up to three references | More efficient but more complex and encourages batching. | |
| Up to the Gateway schema maximum | API-aligned but too close to a raw evidence manager UI. | |

**User's choice:** One reference per submission.
**Notes:** Bulk attachment is deferred.

### Allowed Fields

| Option | Description | Selected |
|--------|-------------|----------|
| `kind`, `label`, `ref`, `path` | Matches Phase 10 initial evidence references and keeps the form bounded. | ✓ |
| Add `sessionId` and `copilotRunId` | Useful linkage but risks implying deeper terminal/Copilot detail access. | |
| Expose every API field | Flexible but weakens the safe-reference boundary. | |

**User's choice:** Only `kind`, `label`, `ref`, and `path`.
**Notes:** No raw content text area, Feishu fields, session fields, or Copilot fields in Phase 11.

### Sensitive Input Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Lightweight local block plus Gateway validation | Web blocks obvious secrets/raw blobs; Gateway remains authoritative. | ✓ |
| Warn only | Higher user freedom but sends likely sensitive content to the backend. | |
| Gateway-only validation | Minimal Web work but too weak for the safety closeout phase. | |

**User's choice:** Lightweight local blocking for obvious secrets/transcripts, with Gateway as final authority.
**Notes:** Block obvious API keys, JWTs, private keys, multi-line transcripts, and provider payload-like values.

---

## Ledger Timeline Review

### Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Full in-tab timeline area | Replaces the current five-row summary inside the Project Manager tab. | ✓ |
| Keep summary plus View all ledger Sheet | Main page stays lighter but review is hidden one layer deeper. | |
| Separate Ledger tab | More independent but splits the Project Manager workflow. | |

**User's choice:** Replace the current five-row summary with a full in-tab timeline area.
**Notes:** No separate route/tab or extra Sheet for Phase 11.

### Default Amount

| Option | Description | Selected |
|--------|-------------|----------|
| 25 events plus Load more | Bounded and reviewable, with a natural extension path. | ✓ |
| 50 events without Load more | Simple but heavier and less extensible. | |
| 10 recent events | Very light but too weak for ledger review. | |

**User's choice:** Default to 25 events with manual Load more.
**Notes:** Infinite scroll is not desired.

### Filtering

| Option | Description | Selected |
|--------|-------------|----------|
| Simple event-type filtering | All, Status changes, Evidence, Manual completion, and Blockers. | ✓ |
| No filtering | Simpler but noisier and weaker for PMEV-03. | |
| Work item filtering only | Useful later but needs more UI than Phase 11 requires. | |

**User's choice:** Provide simple event-type filtering.
**Notes:** UX groups are locked; implementation mapping may use existing Gateway event types as the planner decides.

### Event Details

| Option | Description | Selected |
|--------|-------------|----------|
| Safe summary card | Event type, work item title or ID, status, evidence count, Feishu count, timestamp. | ✓ |
| Include evidence ref list | More complete but mixes evidence review into ledger timeline. | |
| Only event type and timestamp | Safest but too low information for review. | |

**User's choice:** Safe summary card.
**Notes:** No raw details or evidence ref expansion in ledger events.

### Emphasis

| Option | Description | Selected |
|--------|-------------|----------|
| Badges plus short explanatory copy | Distinguishes manual completion and blockers without raw reason text. | ✓ |
| Strong blocker highlight only | Makes blockers visible but underplays manual completion. | |
| Uniform event style | Simple but weakens event distinction. | |

**User's choice:** Event-type badges plus short explanatory copy.
**Notes:** Manual completion should be visibly distinguishable from evidence-backed completion.

---

## Acceptance Path And Handoff Docs

### Main Happy Path

| Option | Description | Selected |
|--------|-------------|----------|
| Full project-manager workflow happy path | Project page, Project Manager tab, goal/work item flow, attach evidence, status/done, ledger events. | ✓ |
| Only Phase 11 attach evidence and ledger timeline | Narrower but does not prove v1.2 workflow closure. | |
| API/Vitest only | Lower maintenance but insufficient for a Web workflow milestone. | |

**User's choice:** Full project-manager workflow happy path.
**Notes:** This should prove the v1.2 loop, not just isolated Phase 11 widgets.

### Error Coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Attach evidence error plus ledger load error plus done guard regression | Covers the highest Phase 11 risks and Phase 10 regression risk. | ✓ |
| Attach evidence error only | Too narrow. | |
| Every Project Manager mutation error | Complete but too broad for Phase 11. | |

**User's choice:** Attach evidence error, ledger load error, and done guard regression.
**Notes:** Do not expand to an exhaustive Phase 10 mutation error matrix.

### Handoff Docs

| Option | Description | Selected |
|--------|-------------|----------|
| Trial checklist plus support diagnostics plus v1.2 closeout report | Extends the v1.1 readiness packet structure. | ✓ |
| Closeout report only | Clear closeout but weak first-user/support guidance. | |
| Planning docs only | Good for GSD but not enough for maintainers or trial users. | |

**User's choice:** Update `docs/TRIAL-CHECKLIST.md` and `docs/SUPPORT-DIAGNOSTICS.md`, and add a v1.2 closeout report.
**Notes:** Follow the v1.1 packet shape.

### Sensitive-Data Rules

| Option | Description | Selected |
|--------|-------------|----------|
| Forbidden-content list plus acceptable reference examples | Most actionable for users and maintainers. | ✓ |
| One short do-not-paste-sensitive-info sentence | Too vague. | |
| Leave details to UI copy | Documentation would be too weak. | |

**User's choice:** Explicit forbidden-content list plus acceptable reference examples.
**Notes:** Forbid raw terminal transcripts, Feishu bodies, provider payloads, API keys, JWTs, private keys, attach tokens, and unrelated project secrets. Allow docs paths, command names, report paths, issue/PR IDs, and short refs.

---

## the agent's Discretion

- Exact component decomposition, query key shapes, ledger card-vs-row rendering, and event-type mapping strategy are left to planner discretion as long as the locked decisions are preserved.

## Deferred Ideas

- Bulk evidence attachment UI.
- Session/Copilot/Feishu reference-specific fields in the attachment form.
- Separate ledger tab.
- Ledger raw evidence reference expansion.
- Work-item-level ledger filtering.
- Exhaustive Project Manager mutation error matrix.
