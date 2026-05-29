# Phase 6: Live Provider and Platform Smoke Evidence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21T10:00:32+08:00
**Phase:** 6-Live Provider and Platform Smoke Evidence
**Areas discussed:** Live provider evidence, Physical Windows/WSL terminal evidence, Release gate evidence matrix, Evidence redaction boundary

---

## Live Provider Evidence

### Missing disposable credential handling

| Option | Description | Selected |
|--------|-------------|----------|
| Caveat may close | Complete evidence fields allow Phase 6 to proceed, but do not remove caveat. | ✓ |
| Must Block | No real credential means Phase 6 cannot close. | |
| Milestone audit tech_debt | Continue Phase 6, but force v1.1 audit to tech_debt. | |

**User's choice:** Caveat may close.
**Notes:** Must include command, environment, missing reason, owner, rerun instructions, and redaction result.

### Evidence granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Redacted result and public metadata only | Record provider/model/status/error metadata only. | ✓ |
| Allow redacted log snippets | Include selected stdout/stderr snippets after redaction. | |
| Decide by failure type | Successful runs stay terse; failures may include snippets. | |

**User's choice:** Redacted result and public metadata only.
**Notes:** No request body, response body, API key, or full model output.

### Provider scope

| Option | Description | Selected |
|--------|-------------|----------|
| OpenAI or Anthropic passing is enough | One real provider path proves the live path. | ✓ |
| Both required | Require both OpenAI and Anthropic. | |
| Current configured provider only | Use whatever the maintainer has configured. | |

**User's choice:** OpenAI or Anthropic passing is enough.
**Notes:** Record exact provider and model id. Untested provider remains uncovered but non-blocking.

### Failure classification

| Option | Description | Selected |
|--------|-------------|----------|
| Classify by error type | Use structured categories and block only product contract failures. | ✓ |
| Any failure blocks | Any non-pass blocks Phase 6. | |
| All external failures are caveats | Treat every external failure as caveat. | |

**User's choice:** Classify by error type.
**Notes:** Categories: `missing_credential`, `missing_model`, `quota_or_auth`, `network`, `provider_error`, `unexpected_contract`.

---

## Physical Windows/WSL Terminal Evidence

### Pass standard

| Option | Description | Selected |
|--------|-------------|----------|
| Only real WSL terminal evidence passes | Native Windows UI does not prove tmux-backed terminal. | ✓ |
| Native Windows UI plus Linux tmux passes | Combine native UI and Linux tmux evidence. | |
| No Windows host blocks Phase 6 | No real host means the phase cannot close. | |

**User's choice:** Only real WSL terminal evidence passes.
**Notes:** Without WSL, preserve Caveat/Blocked and do not remove Windows caveat.

### Required behaviors

| Option | Description | Selected |
|--------|-------------|----------|
| Core terminal lifecycle | Doctor, launch, attach, tmux, reconnect, Gateway restart, cleanup. | ✓ |
| Startup and terminal attach only | Minimal smoke only. | |
| Full trial path | Include provider, Copilot, Feishu, and feedback. | |

**User's choice:** Core terminal lifecycle.
**Notes:** Provider/Copilot/Feishu are excluded from this pass condition.

### No WSL host handling

| Option | Description | Selected |
|--------|-------------|----------|
| Caveat plus owner and rerun path | Phase 6 may continue, caveat stays. | ✓ |
| Blocked | Stop Phase 6 until host exists. | |
| Use current Linux host as substitute | Linux evidence removes Windows caveat. | |

**User's choice:** Caveat plus owner and rerun path.
**Notes:** Must record unavailable-host reason, required host conditions, owner, and rerun command/checklist.

### Evidence location

| Option | Description | Selected |
|--------|-------------|----------|
| Report plus smoke/trial/CI docs | New/continued dated report, docs link to it. | ✓ |
| Only a new v1.1 report | Do not update smoke/trial/CI docs. | |
| Only update docs | No separate report. | |

**User's choice:** Report plus smoke/trial/CI docs.
**Notes:** Evidence should not be buried only inside general docs.

---

## Release Gate Evidence Matrix

### Master artifact

| Option | Description | Selected |
|--------|-------------|----------|
| New v1.1 evidence matrix report | `docs/reports/v1.1-beta-evidence-burn-down-YYYY-MM-DD.md` is master. | ✓ |
| Continue post-beta-release-gates report | Append to 2026-05-10 report. | |
| Use docs/SMOKE-TEST.md as entry point | Put matrix in smoke doc. | |

**User's choice:** New v1.1 evidence matrix report.
**Notes:** Smoke, trial, and CI docs link to this report.

### Row schema

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed Pass/Caveat/Blocked plus owner/rerun fields | Uniform schema across gate types. | ✓ |
| Simplified Status plus Notes | Shorter but less actionable. | |
| Different fields by gate type | Provider/terminal/CI/manual use different schemas. | |

**User's choice:** Fixed schema.
**Notes:** Fields: Gate, Status, Command/Checklist, Environment, Evidence Summary, Artifact, Caveat/Blocker Reason, Owner, Rerun/Next Action.

### Gate scope

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 6 scope gates | Provider, WSL, CI smoke, gate-d, tmux, docs consistency, secret scan. | ✓ |
| All v1.1 gates | Include Feishu callback and first-user packet now. | |
| Only external manual gates | Track provider and Windows/WSL only. | |

**User's choice:** Phase 6 scope gates only.
**Notes:** Feishu live callback and first-user packet stay in Phases 7 and 8.

### Old evidence treatment

| Option | Description | Selected |
|--------|-------------|----------|
| Old evidence can be baseline but not inherited Pass | Reference baseline, but no fresh pass unless rerun. | ✓ |
| Old evidence inherits Pass | Reuse old pass if code unchanged. | |
| Old evidence is background only and all gates must rerun | No baseline status. | |

**User's choice:** Old evidence can be baseline but not inherited Pass.
**Notes:** If not rerun in Phase 6, mark as Caveat or Baseline, not fresh v1.1 Pass.

---

## Evidence Redaction Boundary

### Forbidden content

| Option | Description | Selected |
|--------|-------------|----------|
| Strictly forbid raw sensitive material | No API keys, JWTs, Feishu secrets, raw bodies, full output, transcripts, auth/config. | ✓ |
| Allow redacted raw snippets | Permit manually redacted snippets. | |
| Only forbid obvious secrets | Anything else may be recorded. | |

**User's choice:** Strictly forbid raw sensitive material.
**Notes:** Applies to provider, terminal, Feishu, and config/auth evidence.

### Redaction proof

| Option | Description | Selected |
|--------|-------------|----------|
| Record scan command and summary result | Command, counts, categories, fixture/placeholder classification. | ✓ |
| Record before/after redaction comparison | Show redacted examples. | |
| Only write manual confirmation | No command or count evidence. | |

**User's choice:** Record scan command and summary result.
**Notes:** Do not paste sensitive matches.

### Successful model output

| Option | Description | Selected |
|--------|-------------|----------|
| Record marker/summary only | Marker match, summary, public metadata. | ✓ |
| Record full output after redaction | Include model text after redaction. | |
| Record no output-related fields | Only command exit code. | |

**User's choice:** Record marker/summary only.
**Notes:** No complete model response body.

### Pre-commit checks

| Option | Description | Selected |
|--------|-------------|----------|
| Require diff check plus targeted secret scan | Run both before committing evidence docs. | ✓ |
| Only run git diff --check | No explicit secret scan. | |
| Scan only when provider smoke succeeds | No scan for skipped provider evidence. | |

**User's choice:** Require diff check plus targeted secret scan.
**Notes:** Suspicious matches must be fixed or classified before commit.

---

## Agent Discretion

- The planner may choose exact report filename date format using existing `docs/reports/*-YYYY-MM-DD.md` conventions.
- The planner may use one combined report or a combined report plus terminal appendix, if the v1.1 matrix remains the master entry point.

## Deferred Ideas

- Feishu live callback evidence and deployment readiness are Phase 7 scope.
- First-user feedback packet and support diagnostics packaging are Phase 8 scope.
- Project-manager Web UX and remote execution runtime remain future milestone scope.
