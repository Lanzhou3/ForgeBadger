# Phase 26 Trial Feedback Draft Generator

> Scope: v1.5 first-user feedback collection support.
> This generates a local draft only; it is not completed first-user feedback
> and does not clear external gates.

## Summary

Phase 26 adds a local feedback draft helper:

```bash
pnpm trial:feedback-draft -- --output /tmp/openforge-trial-feedback.md
```

The helper pre-fills bounded local metadata and leaves evidence, triage, and
redaction review fields for a human to complete.

## Implementation

| Area | Change |
|------|--------|
| Generator | Added `scripts/create-trial-feedback-draft.mjs`. |
| Tests | Added `scripts/create-trial-feedback-draft.test.mjs`. |
| Package script | Added `pnpm trial:feedback-draft`. |
| CI | Added the generator test to script harness tests. |
| Docs | Linked the helper from the trial runbook, checklist, and feedback template. |

## Safety Boundary

The helper only collects first-line summaries from bounded local commands such
as `git rev-parse --short HEAD`, `tmux -V`, `claude --version`, optional
`opencode --version`, and optional `codex --version`.

It does not:

- export diagnostics;
- read browser storage;
- read or request tokens;
- upload files;
- collect raw terminal transcripts;
- collect provider payloads;
- collect Feishu bodies;
- clear external gates.

Token-shaped values in generated draft fields are redacted.

## Gate State

No external evidence gate moved to `Pass`.

| Gate | State After Phase 26 | Reason |
|------|----------------------|--------|
| `LIVE-PROVIDER` | Caveat | No disposable live provider credential/model pass was collected. |
| `WINDOWS-WSL` | Caveat | No physical Windows/WSL terminal run occurred. |
| `FEISHU-CALLBACK` | Blocked | No public HTTPS Gateway route or Feishu developer-console URL verification occurred. |
| `FIRST-USER-FEEDBACK` | Caveat | A generated draft is not a completed, redacted, linked first-user packet. |

## Verification

### Red Test

Command:

```bash
node --test scripts/create-trial-feedback-draft.test.mjs
```

Initial result before implementation:

- failed with `ERR_MODULE_NOT_FOUND` for
  `scripts/create-trial-feedback-draft.mjs`.

### Focused Test

Command:

```bash
node --test scripts/create-trial-feedback-draft.test.mjs
```

Result:

- 1 file passed;
- 1 test file passed;
- 0 failures.

### CLI Smoke

Command:

```bash
node scripts/create-trial-feedback-draft.mjs --startup-path 'source fallback' --web-url http://127.0.0.1:48732 --gateway-url http://127.0.0.1:48731
```

Result:

- generated a Markdown draft headed `OpenForge Trial Feedback Draft`;
- included bounded local metadata;
- included `not submitted, not reviewed, not gate-clearing evidence`.

Command:

```bash
pnpm trial:feedback-draft -- --output /tmp/openforge-trial-feedback-draft-smoke.md
```

Result:

- wrote a non-empty Markdown draft with bounded local metadata and tokenless
  diagnostics guidance.

### Script Harness

Command:

```bash
node --test scripts/create-trial-feedback-draft.test.mjs scripts/validate-trial-feedback-intake.test.mjs scripts/run-with-root-env.test.mjs scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
```

Result:

- 5 files passed;
- 5 tests passed;
- 0 failures.

### References And Gate State

Commands:

```bash
rg -n 'trial:feedback-draft|create-trial-feedback-draft|not gate-clearing evidence|FIRST-USER-FEEDBACK' package.json docs scripts .github .planning MEMORY.md
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
git diff --check
```

Results:

- helper references and caveat wording were present in package script, docs,
  CI, planning, memory, and scripts;
- all four external gates kept their prior states;
- `git diff --check` exited 0.

## Next Work

Run a real first-user trial, generate a draft if helpful, complete it with
actual redacted evidence, then link or attach the completed packet through the
validated feedback path.
