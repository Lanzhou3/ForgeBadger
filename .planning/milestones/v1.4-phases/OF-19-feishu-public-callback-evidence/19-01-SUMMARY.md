# Feishu Public Callback Evidence Summary

Date: 2026-05-29

## Completed

- Inspected the external evidence registry, Phase 7 Feishu callback report,
  public webhook setup helper, and Gateway Feishu route.
- Confirmed no OpenForge Feishu public-webhook setup environment variable names
  were set in the current shell.
- Ran `lark-cli --version`, `lark-cli auth status --verify`, and
  `lark-cli doctor`; sandbox network checks were rerun with approved
  escalation.
- Ran `pnpm smoke:feishu-public-webhook`; sandbox `tsx` IPC failure was rerun
  with approved escalation.
- Ran Feishu/Copilot boundary regression and Gateway typecheck with approved
  escalation after sandbox `tsx` IPC failures.
- Recorded Phase 19 evidence in
  `docs/reports/phase-19-feishu-public-callback-evidence-2026-05-29.md`.
- Updated `docs/EXTERNAL-EVIDENCE-GATES.md` to point `FEISHU-CALLBACK` to the
  Phase 19 report while keeping the gate `Blocked`.

## Result

Current sanitized evidence:

- `lark-cli` version: `1.0.36`.
- Feishu CLI bot identity: ready and verified.
- Feishu CLI user identity: expired.
- Feishu OpenAPI and MCP endpoints: reachable.
- `pnpm smoke:feishu-public-webhook`: unrestricted run returned
  `OPENFORGE_DB_PATH is required`.
- `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts`:
  `183` tests passed.
- `pnpm --dir packages/gateway typecheck`: passed.

## Gate Decision

`FEISHU-CALLBACK` remains `Blocked`. Phase 19 did not have a public HTTPS
Gateway route, operator webhook setup environment, or Feishu developer-console
URL verification action.

## Next Action

Plan Phase 20 Platform And First-User Acceptance Closure. Reopen
`FEISHU-CALLBACK` only after public HTTPS routing and Feishu developer-console
URL verification are available.
