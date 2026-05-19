# Phase 1 Platform And Feedback Evidence

> Date: 2026-05-19
> Scope: REL-02 physical Windows/WSL evidence and REL-03 first-user feedback triage
> Decision: `Caveat` for both gates until real host evidence and completed first-user feedback are attached

## Windows/WSL platform evidence

Status: Caveat

| Gate | Status | Environment | Result summary | Log/report location | Skip reason | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| REL-02 physical Windows/WSL smoke | Caveat | Current execution host is Ubuntu Linux `6.8.0-107-generic`; no physical Windows/WSL host was available | No Windows/WSL browser terminal smoke was run. Ubuntu CI, native Windows management UI, and docs review alone do not prove tmux-backed browser terminal behavior on WSL. | This report; `docs/TRIAL-CHECKLIST.md` Windows section remains the required manual evidence surface | physical Windows/WSL host unavailable in this execution environment | maintainer with Windows/WSL host | complete `docs/TRIAL-CHECKLIST.md` Windows section before removing the Windows caveat |

Physical Windows/WSL `Status: Pass` requires a WSL distribution/version,
tmux-backed browser terminal attach, terminal input/output, resize,
refresh/reconnect, stop behavior, and log/report location from a real Windows
host running the terminal trial inside WSL.

## First-user feedback triage

Status: Caveat

| Feedback item | Source | Reproduction | Category | Severity | Mapped requirement | Disposition | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Status: Caveat | No completed first-user feedback attached yet | Not available | Copilot / platform | medium | REL-03, UX-04 | Skip reason: no completed first-user feedback attached yet; Owner: beta trial maintainer; Next action: collect `docs/TRIAL-FEEDBACK.md` from first trial user and map items to Phase 3 hardening | Phase 3 hardening unless the feedback invalidates Phase 1 evidence |

Do not invent feedback. Real feedback rows must include reproduction details,
category, severity, mapped requirement, disposition, and follow-up phase. Product
fixes from feedback belong in Phase 3 hardening unless they directly invalidate
Phase 1 evidence.

## Secret Handling

Trial feedback and attachments must not include plaintext API keys, passwords,
JWTs, attach tokens, private keys, browser auth token values, or unrelated
project secrets.
