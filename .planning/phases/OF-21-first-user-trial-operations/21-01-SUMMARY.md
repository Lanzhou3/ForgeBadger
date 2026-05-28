# First-User Trial Operations Summary

Date: 2026-05-29
Status: Complete

## What Changed

- Selected `v1.5 First-User Trial Operations` as the next OpenForge milestone.
- Added the v1.5 design spec:
  `docs/superpowers/specs/2026-05-29-openforge-v1.5-first-user-trial-operations-design.md`.
- Added Phase 21 context and implementation plan under
  `.planning/phases/OF-21-first-user-trial-operations/`.
- Updated active source-of-truth files so the project no longer sits at
  "next milestone unselected".
- Updated `docs/TRIAL-FEEDBACK.md` and
  `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml` so real first-user
  submissions capture affected surface, severity, owner, disposition,
  follow-up route, environment, reproduction, diagnostics status, and redaction
  review.
- Removed the first-user instruction to retrieve browser auth tokens from
  developer tools; Web diagnostics export is the first-user path, and local API
  diagnostics are maintainer-only fallback.
- Replaced open-ended log/output requests with bounded redacted summaries.

## Gate State

No external gate moved to `Pass`.

| Gate | State |
|------|-------|
| `LIVE-PROVIDER` | Caveat |
| `WINDOWS-WSL` | Caveat |
| `FEISHU-CALLBACK` | Blocked |
| `FIRST-USER-FEEDBACK` | Caveat |

## Review

Two read-only GSD plan-checker reviews were used:

1. First pass found missing requirement coverage, insufficient intake fields,
   unsafe first-user diagnostics fallback, weak gate-state verification, and
   stale wording.
2. Second pass approved the fixes and confirmed the local-first product
   boundary, full Phase 21 requirement coverage, intake field coverage,
   secret-safe diagnostics wording, and exact gate-state verification.

## Verification

Commands run:

```bash
rg --glob '!21-01-SUMMARY.md' -n "TBD|post-v1\\.4 milestone selection|Current Milestone: v1\\.4|v1\\.4 External Evidence Closure is complete and archived\\. The next milestone|next milestone pending|next work is selecting" .planning/STATE.md .planning/ROADMAP.md .planning/PROJECT.md .planning/REQUIREMENTS.md .planning/MILESTONES.md .planning/DECISIONS-INDEX.md .planning/phases/OF-21-first-user-trial-operations MEMORY.md docs/superpowers/specs/2026-05-29-openforge-v1.5-first-user-trial-operations-design.md || true
rg -n "v1.5 First-User Trial Operations|Phase 21|First-User Trial Operations|TRIALOPS|TRIALSAFE|PLAN-21|LIVE-PROVIDER|WINDOWS-WSL|FEISHU-CALLBACK|FIRST-USER-FEEDBACK" .planning/STATE.md .planning/ROADMAP.md .planning/REQUIREMENTS.md .planning/PROJECT.md .planning/MILESTONES.md .planning/DECISIONS-INDEX.md .planning/phases/OF-21-first-user-trial-operations MEMORY.md docs/superpowers/specs/2026-05-29-openforge-v1.5-first-user-trial-operations-design.md
rg -n '^\\| `LIVE-PROVIDER` \\| `Caveat` \\|' docs/EXTERNAL-EVIDENCE-GATES.md
rg -n '^\\| `WINDOWS-WSL` \\| `Caveat` \\|' docs/EXTERNAL-EVIDENCE-GATES.md
rg -n '^\\| `FEISHU-CALLBACK` \\| `Blocked` \\|' docs/EXTERNAL-EVIDENCE-GATES.md
rg -n '^\\| `FIRST-USER-FEEDBACK` \\| `Caveat` \\|' docs/EXTERNAL-EVIDENCE-GATES.md
rg -n '^\\| `LIVE-PROVIDER` \\| Caveat \\|' docs/reports/v1.4-external-evidence-closeout-2026-05-29.md
rg -n '^\\| `WINDOWS-WSL` \\| Caveat \\|' docs/reports/v1.4-external-evidence-closeout-2026-05-29.md
rg -n '^\\| `FEISHU-CALLBACK` \\| Blocked \\|' docs/reports/v1.4-external-evidence-closeout-2026-05-29.md
rg -n '^\\| `FIRST-USER-FEEDBACK` \\| Caveat \\|' docs/reports/v1.4-external-evidence-closeout-2026-05-29.md
rg --glob '!21-01-PLAN.md' --glob '!21-01-SUMMARY.md' -n "get .*token|developer tools.*token|paste the .*token|paste your .*key|Please attach raw|Please upload raw|Please submit raw|Attach raw|Upload raw|Submit raw|raw terminal transcript request|raw provider payload request|raw Feishu body request" docs/TRIAL-FEEDBACK.md .github/ISSUE_TEMPLATE/openforge-trial-feedback.yml .planning/phases/OF-21-first-user-trial-operations docs/superpowers/specs/2026-05-29-openforge-v1.5-first-user-trial-operations-design.md || true
git diff --check
```

Results:

- active stale-state scan returned no matches;
- v1.5/Phase 21 references exist in active source-of-truth files;
- all four canonical external gate states remain unchanged;
- unsafe-request scan returned no matches;
- `git diff --check` exited 0.

## Next Work

Collect a real first-user trial packet through the updated template or issue
form. Keep external gates caveated or blocked until the required real artifacts
exist.
