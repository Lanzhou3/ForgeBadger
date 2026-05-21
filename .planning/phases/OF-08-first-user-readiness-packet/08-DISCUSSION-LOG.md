# Phase 8: First-User Readiness Packet - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21T17:33:07+08:00
**Phase:** 8-First-User Readiness Packet
**Areas discussed:** First-user feedback status, Trial path packaging, Support diagnostics packet, v1.1 closeout risk expression

---

## First-User Feedback Status

| Option | Description | Selected |
|--------|-------------|----------|
| Caveat blocked record | Current repo has no completed real first-user feedback packet; write owner, collection path, artifact shape, and clearing condition. | yes |
| Wait for real feedback | Pause Phase 8 until the user provides real first-user feedback materials. | |
| Use existing template as substitute | Treat `docs/TRIAL-FEEDBACK.md` as the feedback packet, faster but false-green risk. | |

**User's choice:** Caveat blocked record.
**Notes:** Follow-up choice locked owner as `maintainer/operator`, collection through GitHub trial feedback issue or redacted Markdown packet following `docs/TRIAL-FEEDBACK.md`, and clearing condition as at least one complete real feedback packet referenced by the closeout.

---

## Trial Path Packaging

| Option | Description | Selected |
|--------|-------------|----------|
| Quick Smoke + Evidence Appendix | Give first users a short runnable path; keep deep validation, diagnostics, Feishu, and manual evidence in an appendix. | yes |
| Keep one long checklist | Keep a single linear checklist with all information in one place. | |
| Split by role | Create separate trial-user, maintainer, and operator paths. | |

**User's choice:** Quick Smoke + Evidence Appendix.
**Notes:** The quick path must remain runnable and cover setup, dependency checks, provider readiness, terminal smoke, Copilot smoke, Feishu smoke when available, and feedback capture.

---

## Support Diagnostics Packet

| Option | Description | Selected |
|--------|-------------|----------|
| Unified Support Packet | One discoverable packet with provider, runtime/terminal, and Feishu sections; each includes commands, expected artifacts, redaction, and escalation boundaries. | yes |
| Three independent runbooks | Separate provider, runtime, and Feishu documents. | |
| Checklist-only expansion | Put diagnostic commands directly into the trial checklist without a dedicated packet. | |

**User's choice:** Unified Support Packet.
**Notes:** The packet should serve both first-user support and maintainer reproduction without asking users to expose secrets.

---

## v1.1 Closeout Risk Expression

| Option | Description | Selected |
|--------|-------------|----------|
| User-visible caveat table + backlog routing | State remaining caveats directly, with owner, clearing condition, current evidence status, and backlog or issue route. | yes |
| Internal backlog only | Keep user-facing docs cleaner and move caveats mainly to internal follow-up. | |
| Release-notes summary only | Summarize risks lightly without owner or clearing condition. | |

**User's choice:** User-visible caveat table + backlog routing.
**Notes:** Live-provider, physical Windows/WSL, Feishu real-console callback, and completed first-user feedback caveats must not be written as vague TODOs or implied passes.

---

## Agent Discretion

- The planner may decide whether the unified diagnostics packet is a standalone document or a first-class section in another readiness artifact.
- The planner may choose final heading names for the quick path and evidence appendix.

## Deferred Ideas

- None.
