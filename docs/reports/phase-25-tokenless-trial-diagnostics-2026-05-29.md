# Phase 25 Tokenless Trial Diagnostics

> Scope: v1.5 first-user runbook safety fix.
> This removes browser-token fallback guidance from the first-user runbook, but
> it is not completed first-user feedback and does not clear external gates.

## Summary

Phase 25 extends the Phase 24 intake validator to include
`docs/TRIAL-RUNBOOK.md` and removes old first-user diagnostics instructions
that asked users to retrieve browser auth tokens from developer tools.

## Root Cause

Phase 24 validated the feedback issue form and Markdown feedback template, but
not the runbook. The runbook still retained older local API instructions:

- open browser developer tools;
- read Local Storage;
- use the browser token in a curl request.

That contradicted the current first-user feedback contract, which requires
tokenless Web Settings diagnostics export for first users.

## Implementation

| Area | Change |
|------|--------|
| Validator | `scripts/validate-trial-feedback-intake.mjs` now validates `docs/TRIAL-RUNBOOK.md`. |
| Tests | `scripts/validate-trial-feedback-intake.test.mjs` rejects browser-token fallback guidance. |
| Runbook | `docs/TRIAL-RUNBOOK.md` now points first users to Settings -> Export diagnostics JSON and keeps local API fallback maintainer-only. |
| Planning | Active planning, requirements, decisions, state, and memory now record Phase 25. |

## Gate State

No external evidence gate moved to `Pass`.

| Gate | State After Phase 25 | Reason |
|------|----------------------|--------|
| `LIVE-PROVIDER` | Caveat | No disposable live provider credential/model pass was collected. |
| `WINDOWS-WSL` | Caveat | No physical Windows/WSL terminal run occurred. |
| `FEISHU-CALLBACK` | Blocked | No public HTTPS Gateway route or Feishu developer-console URL verification occurred. |
| `FIRST-USER-FEEDBACK` | Caveat | This is a runbook safety fix, not a completed first-user feedback packet. |

## Verification

### Red Test

Command:

```bash
node --test scripts/validate-trial-feedback-intake.test.mjs
```

Initial result before implementation:

- failed because the validator did not reject runbook browser-token fallback
  guidance.

### Validator CLI

Command:

```bash
node scripts/validate-trial-feedback-intake.mjs
```

Result:

```json
{
  "ok": true,
  "errors": []
}
```

### Script Harness

Command:

```bash
node --test scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
```

Result:

- 4 files passed;
- 4 tests passed;
- 0 failures.

### Runbook Token Fallback Scan

Command:

```bash
rg -n 'Open browser developer tools|Read Local Storage|openforge\.token|authorization: Bearer <token>' docs/TRIAL-RUNBOOK.md
```

Result:

- no matches.

Command:

```bash
rg -n 'Open Settings|Export diagnostics JSON|Do not ask first users to retrieve browser auth tokens|Maintainer-only fallback' docs/TRIAL-RUNBOOK.md
```

Result:

- all required diagnostics guidance lines were present.

### External Gate State

Command:

```bash
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
```

Result:

- all four expected gate rows were present with their preserved states.

### Final Checks

Commands:

```bash
rg --hidden --no-ignore -n 'RUNBOOKSAFE-|PLAN-25|Phase 25|tokenless-trial-diagnostics|Tokenless Trial Diagnostics' .planning docs MEMORY.md scripts
git diff --check
```

Results:

- Phase 25 references and requirement IDs were present in active planning,
  docs, memory, and scripts.
- `git diff --check` exited 0.

## Next Work

Collect a real first-user trial packet through the validated GitHub issue form,
Markdown template, and tokenless runbook. Keep all external gates caveated or
blocked until the required real artifacts in
`docs/EXTERNAL-EVIDENCE-GATES.md` exist.
