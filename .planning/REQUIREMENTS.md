# Requirements: OpenForge v1.4 External Evidence Closure

**Defined:** 2026-05-29
**Core Value:** Developers can reliably control and recover local AI CLI coding sessions from a browser while release claims stay backed by concrete, redacted external evidence.
**Milestone Goal:** Convert the remaining live-provider, physical Windows/WSL, Feishu developer-console callback, and first-user feedback caveats into an explicit evidence gate system with runnable collection paths and truthful closeout decisions.

## Readiness Assessment

- v1.3 AI-Native Project Execution Traceability is complete and archived under `.planning/milestones/v1.3-*`.
- OpenForge is now suitable for cautious open-source inspection and local-first trial, but release claims remain bounded by external evidence caveats.
- The next product risk is not another broad feature surface; it is proving real-world provider, platform, Feishu, and first-user behavior without exposing secrets or raw transcripts.
- `upload_img/` remains unrelated untracked local data and is outside milestone scope.

## v1.4 Requirements

### Product Position

- [ ] **EVPOS-01**: OpenForge remains a local-first AI CLI control plane; v1.4 does not add hosted collaboration, cloud workers, autonomous remote execution, or Feishu execution authority.
- [ ] **EVPOS-02**: Release/readiness claims are sourced from bounded evidence artifacts, not from the existence of checklists, templates, or mocked tests alone.
- [ ] **EVPOS-03**: Evidence collection defaults to redacted metadata, bounded status fields, commands, timestamps, environment summaries, and artifact links; raw provider payloads, Feishu bodies, terminal transcripts, tokens, and secrets remain excluded.

### Evidence Registry

- [ ] **EVID-01**: A canonical external evidence gate registry lists live provider, physical Windows/WSL terminal, Feishu developer-console callback, and completed first-user feedback gates.
- [ ] **EVID-02**: Every gate records current state, owner, clearing condition, rerun command or runbook, allowed artifact shape, redaction rules, and target report or issue destination.
- [ ] **EVID-03**: Milestone and phase closeouts must reference the registry and may only move a gate to `Pass` when the required artifact exists.

### Live Provider Evidence

- [ ] **PROV-01**: A disposable live provider smoke run can be recorded with explicit provider, model id, command, bounded result, and redacted artifact path.
- [ ] **PROV-02**: Provider evidence distinguishes credential failure, unsupported model, endpoint/network failure, timeout, provider outage, and product-contract failure.
- [ ] **PROV-03**: Codex subscription-managed launch paths remain isolated from provider API-key/model override evidence.

### Feishu Callback Evidence

- [ ] **FEI-LIVE-01**: A real Feishu developer-console URL verification attempt can be recorded against a public HTTPS Gateway webhook URL.
- [ ] **FEI-LIVE-02**: Feishu callback evidence confirms raw-body signature verification, replay/rate policy, tenant allowlist checks, and redaction boundaries.
- [ ] **FEI-LIVE-03**: Feishu free-form text remains unable to approve pending actions, send terminal input, or directly mutate Project Manager state.

### Platform And First-User Evidence

- [ ] **UXE-01**: A physical Windows/WSL evidence packet can record dependency checks, WSL terminal launch, browser terminal attach/input/resize, reconnect, Gateway restart recovery, and cleanup.
- [ ] **UXE-02**: First-user feedback packets map findings to severity, owner, disposition, affected surface, environment, and follow-up backlog item or explicit no-action rationale.
- [ ] **UXE-03**: Support and trial docs route users to evidence gates without asking them to paste secrets, raw terminal content, or private project data.

### Release Closeout

- [ ] **REL-01**: v1.4 closeout produces a `Pass`/`Caveat`/`Blocked` matrix for every external evidence gate with artifact links or precise blockers.
- [ ] **REL-02**: Public/open-source docs continue to avoid overclaiming and surface any remaining caveats with rerun paths.

## Out of Scope

| Feature | Reason |
|---------|--------|
| New runtime capability | v1.4 is evidence closure and release trust work. |
| Hosted collaboration, cloud deployment, billing, marketplace, telemetry | Requires separate architecture and security review. |
| Autonomous remote execution or unattended coding loops | Changes authority boundaries and threat model. |
| Feishu free-form approvals or terminal input | Feishu remains controlled collaboration ingress only. |
| Raw evidence blob storage | Evidence remains bounded references and redacted artifacts. |
| Clearing external caveats without artifacts | v1.4 exists specifically to prevent false pass claims. |

## Traceability

| Requirement | Target Phase | Status |
|-------------|--------------|--------|
| EVPOS-01 | Phase 17 | Planned |
| EVPOS-02 | Phase 17 | Planned |
| EVPOS-03 | Phase 17 | Planned |
| EVID-01 | Phase 17 | Planned |
| EVID-02 | Phase 17 | Planned |
| EVID-03 | Phase 17 | Planned |
| PROV-01 | Phase 18 | Planned |
| PROV-02 | Phase 18 | Planned |
| PROV-03 | Phase 18 | Planned |
| FEI-LIVE-01 | Phase 19 | Planned |
| FEI-LIVE-02 | Phase 19 | Planned |
| FEI-LIVE-03 | Phase 19 | Planned |
| UXE-01 | Phase 20 | Planned |
| UXE-02 | Phase 20 | Planned |
| UXE-03 | Phase 20 | Planned |
| REL-01 | Phase 20 | Planned |
| REL-02 | Phase 20 | Planned |

**Coverage:**
- v1.4 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-05-29 after v1.3 completion and open-source readiness closeout.*
