# Phase 24 Trial Feedback Intake Contract

> Scope: v1.5 first-user trial feedback intake quality gate.
> This validates the feedback entry points, but it is not a completed
> first-user packet and does not clear external gates.

## Summary

Phase 24 adds machine validation for the two first-user feedback intake
surfaces:

- `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`
- `docs/TRIAL-FEEDBACK.md`

The validator keeps the minimum packet shape from drifting before a real first
user files feedback.

## Implementation

| Area | Change |
|------|--------|
| Validator | Added `scripts/validate-trial-feedback-intake.mjs`, a bounded contract checker for the OpenForge feedback issue form and Markdown template. |
| Tests | Added `scripts/validate-trial-feedback-intake.test.mjs` with red/green coverage for required fields, field types, options, required flags, sections, safety language, and unsafe raw-evidence wording. |
| CI | Added the validator test to the CI script harness command. |
| Planning | Added Phase 24 planning artifacts and active source-of-truth updates. |

## Contract Checked

The GitHub issue form must keep:

- result, affected surface, startup path, environment, doctor, startup health,
  core trial, Copilot, mapped requirement, category, severity, owner/disposition,
  diagnostics, reproduction, Windows/WSL, and safety fields with the expected
  dropdown, textarea, or checkbox types;
- required dropdown options for result, affected surface, startup path, mapped
  requirement, category, and severity;
- required flags for mandatory fields;
- owner, disposition, follow-up route, next action/no-action rationale, and
  evidence-needed language;
- secret and raw-evidence safety confirmations.

The Markdown template must keep:

- Summary, dependency versions, diagnostics export, reproduction, expected and
  actual behavior, triage, browser evidence, and bounded support notes sections;
- dependency/version commands including `node --version`, `tmux -V`,
  `claude --version`, and `openforge doctor`;
- diagnostics guidance that does not ask first users to retrieve browser auth
  tokens from developer tools;
- Copilot provider, pending-action, terminal attach/input/resize/reconnect,
  restart recovery, and bounded log summary fields;
- redaction and no-raw-output language.

## Gate State

No external evidence gate moved to `Pass`.

| Gate | State After Phase 24 | Reason |
|------|----------------------|--------|
| `LIVE-PROVIDER` | Caveat | No disposable live provider credential/model pass was collected. |
| `WINDOWS-WSL` | Caveat | No physical Windows/WSL terminal run occurred. |
| `FEISHU-CALLBACK` | Blocked | No public HTTPS Gateway route or Feishu developer-console URL verification occurred. |
| `FIRST-USER-FEEDBACK` | Caveat | This validates intake forms only; no completed first-user packet is attached. |

## Verification

### Red Test

Command:

```bash
node --test scripts/validate-trial-feedback-intake.test.mjs
```

Initial result before implementation:

- failed with `ERR_MODULE_NOT_FOUND` for
  `scripts/validate-trial-feedback-intake.mjs`.

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

### External Gate State

Command:

```bash
rg -n '\| `LIVE-PROVIDER` \| `Caveat`|\| `WINDOWS-WSL` \| `Caveat`|\| `FEISHU-CALLBACK` \| `Blocked`|\| `FIRST-USER-FEEDBACK` \| `Caveat`' docs/EXTERNAL-EVIDENCE-GATES.md
```

Result:

- all four expected gate rows were present with their preserved states.

### Safety Wording

Command:

```bash
rg -n 'Paste raw|Upload raw|Submit raw|Attach raw|paste your .*key|retrieve browser auth tokens from developer tools' .github/ISSUE_TEMPLATE/openforge-trial-feedback.yml docs/TRIAL-FEEDBACK.md
```

Result:

- one match, the negated safety instruction:
  `Do not ask first users to retrieve browser auth tokens from developer tools`.

### Final Checks

Commands:

```bash
rg --hidden --no-ignore -n "INTAKE-|PLAN-24|Phase 24|trial-feedback-intake|validate-trial-feedback-intake" .planning docs MEMORY.md .github scripts
git diff --check
```

Results:

- Phase 24 references and requirement IDs were present in active planning,
  docs, CI, memory, and scripts.
- `git diff --check` exited 0.

## Secret Safety

The validator rejects affirmative public intake language that asks users to
paste, upload, submit, or attach raw evidence, or to paste keys/tokens. Negated
safety statements such as "Do not attach raw terminal transcripts" remain
allowed and required.

## Next Work

Collect a real first-user trial packet through the validated GitHub issue form
or Markdown template, then triage it against `docs/EXTERNAL-EVIDENCE-GATES.md`.
