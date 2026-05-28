# Live Provider Evidence Rerun Summary

Date: 2026-05-29

## Completed

- Inspected `scripts/smoke-copilot-provider.ts` and
  `scripts/smoke-copilot-provider.test.ts`.
- Confirmed no provider smoke environment variable names were set in the
  current shell.
- Ran `pnpm smoke:copilot-provider`.
- Recorded Phase 18 evidence in
  `docs/reports/phase-18-live-provider-evidence-rerun-2026-05-29.md`.
- Updated `docs/EXTERNAL-EVIDENCE-GATES.md` to point `LIVE-PROVIDER` to the
  Phase 18 report.

## Result

Sandboxed run failed before harness execution with `tsx` IPC `listen EPERM`.
The same command was rerun with approved escalation and returned:

```json
{
  "ok": true,
  "status": "skipped",
  "reason": "missing_provider_credential"
}
```

## Gate Decision

`LIVE-PROVIDER` remains `Caveat`. Phase 18 did not use a disposable provider
credential or explicit model id, so it does not clear the external gate.

## Next Action

Plan Phase 19 Feishu public callback evidence. Rerun `LIVE-PROVIDER` only after
a disposable provider credential and explicit model id are available.
