---
phase: 01
slug: beta-evidence-closure
status: verified
threats_open: 0
threats_total: 12
asvs_level: 1
created: 2026-05-20
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Progress and release source-of-truth docs | Agent-facing docs, progress memory, and historical reports updated by Phase 1 | Release state, PR state, historical gate conclusions |
| Provider smoke evidence | Maintainer live-provider smoke report and manual smoke instructions | Provider/model metadata, redacted smoke result, credential handling instructions |
| Trial feedback attachments | First-user checklist and feedback template | Local diagnostics notes, browser evidence, possible user-provided secrets |
| Terminal gate evidence | CI/release terminal and tmux reports | Local command results, environment details, terminal smoke status |

---

## Threat Register

| Source Plan | Threat ID | Category | Component | Disposition | Mitigation | Status | Evidence |
|-------------|-----------|----------|-----------|-------------|------------|--------|----------|
| 01-01 | T-01-01 | Information disclosure | `MEMORY.md` and docs edits | mitigate | Do not add API keys, JWTs, attach tokens, provider credentials, private keys, or raw provider output. | closed | Targeted secret grep across Phase 1 docs found only documented placeholders/instructions, not real secrets; no raw provider output was added. |
| 01-01 | T-01-02 | Integrity | Historical release reports | mitigate | Preserve historical `blocked` conclusions and add current-status notes instead of rewriting past evidence as pass. | closed | `docs/reports/trial-readiness-2026-05-06.md` keeps `Decision: blocked` and adds `Current status`. |
| 01-01 | T-01-03 | Spoofing release state | Feishu plan and progress memory | mitigate | Replace stale open-PR wording with concrete merged/current-state wording. | closed | `MEMORY.md` records PR #2 merged on 2026-05-19; Feishu inbound plan says PR #2 merged to `master`. |
| 01-02 | T-01-02 | Information disclosure | Provider smoke evidence | mitigate | Use disposable/rotatable credentials only; never write env values, API keys, Authorization headers, full prompts, full request bodies, or full model output to docs. | closed | `docs/reports/phase-1-live-provider-evidence-2026-05-19.md` has `Secret Handling`; strict grep for key assignment and `sk-*` patterns returned no matches in provider evidence docs. |
| 01-02 | T-01-03 | Integrity | Provider evidence status | mitigate | Use `Pass / Caveat / Blocked`; if no credential is present, record `Caveat`. | closed | Live-provider report records `Status: Caveat` and `missing_provider_credential`, not a false pass. |
| 01-02 | T-01-04 | Repudiation | Manual live-provider run | mitigate | Record command shape, timestamp/result status, and redacted JSON summary for audit. | closed | Live-provider report records `pnpm smoke:copilot-provider`, command date context, redacted JSON `status: skipped`, owner, and next action. |
| 01-03 | T-01-05 | Information disclosure | Trial feedback attachments | mitigate | Keep no-secret instructions in checklist/feedback; report must not include API keys, JWTs, attach tokens, private keys, or unrelated project secrets. | closed | `docs/TRIAL-CHECKLIST.md`, `docs/TRIAL-FEEDBACK.md`, and platform/feedback evidence all retain no-secret instructions. |
| 01-03 | T-01-06 | Integrity | Windows/WSL release caveat | mitigate | Record `Caveat` if no physical host evidence exists; do not mark Pass from Ubuntu CI/docs/native Windows UI alone. | closed | Platform/feedback report records `Status: Caveat`, `physical Windows/WSL host unavailable`, and states Ubuntu CI/native Windows UI do not prove WSL terminal behavior. |
| 01-03 | T-01-07 | Scope creep | First-user feedback triage | mitigate | Capture feedback as ledger rows and route product fixes to Phase 3 unless feedback invalidates Phase 1 evidence. | closed | Platform/feedback report includes a triage table, `Do not invent feedback`, and Phase 3 hardening follow-up language. |
| 01-04 | T-01-08 | Integrity | CI/release evidence | mitigate | Do not let `mvp1-smoke` or broad workspace tests imply `gate-d-smoke` or explicit tmux evidence passed. | closed | Terminal evidence report has separate `mvp1-smoke`, `gate-d-smoke`, and focused tmux rows; CI plan says `pnpm -r test` alone does not satisfy REL-06. |
| 01-04 | T-01-09 | Denial of service | CI runtime | mitigate | Keep `gate-d-smoke` environment-gated/manual unless host dependencies are available; avoid adding flaky terminal E2E as required CI without evidence. | closed | CI plan keeps `gate-d-smoke` release/manual unless host supplies Gateway/Web, tmux, and CLI prerequisites. |
| 01-04 | T-01-10 | Information disclosure | Terminal smoke logs | mitigate | Evidence summaries must not include attach tokens, JWTs, API keys, or unrelated terminal output. | closed | Terminal evidence report records summarized command results only; secret grep found only placeholder env names in CI documentation, not actual values. |

Notes:

- Threat IDs `T-01-02` and `T-01-03` were reused by different plan files. This report preserves the original IDs and adds `Source Plan` to keep each row unambiguous.
- SUMMARY files do not contain a `## Threat Flags` section; no unregistered phase threat flags were found.

---

## Accepted Risks Log

No accepted risks.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-20 | 12 | 12 | 0 | Codex |

---

## Sign-Off

- [x] All threats have a disposition.
- [x] Accepted risks documented in Accepted Risks Log.
- [x] `threats_open: 0` confirmed.
- [x] `status: verified` set in frontmatter.

**Approval:** verified 2026-05-20
