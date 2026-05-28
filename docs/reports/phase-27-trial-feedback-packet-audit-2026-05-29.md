# Phase 27 Trial Feedback Packet Audit

> Scope: v1.5 first-user feedback packet quality gate.
> This audits Markdown packet completeness for maintainer triage; it does not
> clear external gates.

## Summary

Phase 27 adds a local packet audit command:

```bash
pnpm trial:feedback-audit -- /tmp/openforge-trial-feedback.md
```

The audit rejects generated drafts, placeholder-only packets, missing required
fields, and obvious secret-like content.

## Implementation

| Area | Change |
|------|--------|
| Audit helper | Added `scripts/audit-trial-feedback-packet.mjs`. |
| Tests | Added `scripts/audit-trial-feedback-packet.test.mjs`. |
| Package script | Added `pnpm trial:feedback-audit`. |
| CI | Added the audit test to script harness tests. |
| Docs | Linked the audit helper from trial runbook, checklist, and feedback template. |

## Safety Boundary

Passing audit means a Markdown packet is ready for maintainer triage. It does
not automatically clear `FIRST-USER-FEEDBACK`; a maintainer still has to link
or attach the completed redacted packet and update the external evidence
registry or closeout report explicitly.

The audit does not upload packets, export diagnostics, read browser storage,
read tokens, or mutate gate state.

## Gate State

No external evidence gate moved to `Pass`.

| Gate | State After Phase 27 | Reason |
|------|----------------------|--------|
| `LIVE-PROVIDER` | Caveat | No disposable live provider credential/model pass was collected. |
| `WINDOWS-WSL` | Caveat | No physical Windows/WSL terminal run occurred. |
| `FEISHU-CALLBACK` | Blocked | No public HTTPS Gateway route or Feishu developer-console URL verification occurred. |
| `FIRST-USER-FEEDBACK` | Caveat | No completed redacted first-user packet was linked in this phase. |

## Verification

Verification completed:

```bash
node --test scripts/audit-trial-feedback-packet.test.mjs
pnpm trial:feedback-draft -- --output /tmp/openforge-trial-feedback-draft-smoke.md
pnpm trial:feedback-audit -- /tmp/openforge-trial-feedback-draft-smoke.md --json # expected nonzero: generated drafts are rejected
node --test scripts/audit-trial-feedback-packet.test.mjs scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
rg -n 'trial:feedback-audit|audit-trial-feedback-packet|ready for human triage|gateClearingEvidence|FIRST-USER-FEEDBACK' package.json docs scripts .github .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

The generated-draft audit command exits nonzero by design because Phase 27
requires generated drafts to be completed and redaction-reviewed before
maintainer triage.

## Next Work

Run a real first-user trial, complete a feedback packet, audit it, then link or
attach it through the validated feedback path for maintainer triage.
