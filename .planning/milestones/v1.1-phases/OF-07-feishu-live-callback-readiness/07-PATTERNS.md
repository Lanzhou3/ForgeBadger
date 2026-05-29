# Phase 7: Feishu Live Callback Readiness - Patterns

**Generated:** 2026-05-21T15:19:06+08:00
**Status:** Ready for planning

## Scope

Phase 7 touches Feishu evidence reports, a possible operator setup script, the existing public webhook route tests, and smoke/trial/CI documentation. The closest patterns are Phase 2 public webhook verification, Phase 6 evidence matrix updates, and the existing script-plus-test style used by live provider smoke.

## File Pattern Map

| Target | Role | Closest Existing Analog | Pattern To Preserve |
|--------|------|-------------------------|---------------------|
| `scripts/prepare-feishu-public-webhook.ts` | Optional operator setup harness | `scripts/smoke-copilot-provider.ts` | Read secrets from env, validate required fields, emit bounded JSON metadata, do not print secret values or raw DB rows. |
| `scripts/prepare-feishu-public-webhook.test.ts` | Harness regression tests | `scripts/smoke-copilot-provider.test.ts` | Use node:test, temporary DB, deterministic env, assert safe skip/error/output behavior and no secret leakage. |
| `package.json` | Root command entry | Existing `smoke:*` scripts | Add a narrow script name only if it materially reduces unsafe ad hoc setup. |
| `docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md` | Dedicated Phase 7 evidence report | `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md`, Phase 2 verification report | Use `Pass`, `Caveat`, `Blocked` rows with command/checklist, environment, evidence, artifact, owner, and rerun/next action. |
| `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` | v1.1 matrix entry point | Current Phase 6 matrix | Add Phase 7 rows/section without changing Phase 6 evidence facts. Link to the dedicated Feishu report. |
| `docs/SMOKE-TEST.md` | Maintainer smoke instructions | Existing provider/terminal smoke sections | Add Feishu callback smoke checklist only as a manual/external gate. Preserve no-secret guidance. |
| `docs/TRIAL-CHECKLIST.md` | Trial evidence capture | Existing evidence fields | Add Feishu callback evidence fields with pass/caveat/blocked semantics. |
| `docs/CI-CD-PLAN.md` | CI/release gate contract | Existing CI/manual gate separation | State that real Feishu console callback is manual/live; automated CI covers route regressions only. |
| `docs/API.md` | Public Feishu contract | Current Feishu public webhook section | Keep single-Gateway, encrypted-payload fail-closed, and no-approval/no-terminal wording exact unless evidence finds a drift. |
| `packages/gateway/test/feishu-integration.test.ts` | Public webhook regression coverage | Existing public webhook tests in same file | Add narrow tests near current public webhook tests; reuse `publicMessageEvent`, `signedFeishuHeaders`, and `seedFeishuPublicWebhookPolicy`. |
| `packages/gateway/src/routes/integrations-feishu.ts` | Public webhook implementation | Current route | Prefer no change. If a test exposes a bug, keep the fix minimal and fail closed. |
| `packages/gateway/src/db/repositories/feishu-integration-repository.ts` | Webhook config/replay/rate data access | Current repository | Prefer no change. If script needs setup, call existing `upsertConfig`, `replaceUserMappings`, and `configurePublicWebhook`. |

## Command Patterns

- CLI auth preflight: `lark-cli auth status --verify`.
- CLI environment preflight: `lark-cli doctor`.
- Optional CLI event preflight: `lark-cli event consume <EventKey> --max-events 1 --timeout <seconds>`.
- Gateway route regression: `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts`.
- Gateway typecheck: `pnpm --dir packages/gateway typecheck`.
- New script tests, if a script is added: `pnpm --dir packages/gateway test ../../scripts/prepare-feishu-public-webhook.test.ts`.
- GSD decision coverage: `gsd-sdk query check.decision-coverage-plan .planning/phases/OF-07-feishu-live-callback-readiness .planning/phases/OF-07-feishu-live-callback-readiness/07-CONTEXT.md`.
- Redaction scan shape: targeted `rg` over modified Phase 7 docs/scripts for `sk-`, `Bearer`, `OPENFORGE_MASTER_KEY=`, `OPENFORGE_JWT_SECRET=`, `verificationToken`, `eventEncryptKey`, `X-Lark-Signature`, `APP_SECRET`, and raw callback-body wording.

## Planning Constraints

- Real developer-console callback evidence is the only FEI-01 pass path.
- CLI event consumption is auxiliary preflight only.
- Local signed Gateway requests are simulated regression evidence only.
- Topology support is single Gateway with SQLite replay/rate stores.
- Multi-instance public exposure requires a future shared replay/rate store.
- Top-level encrypted payloads stay unsupported and fail closed.
- Feishu remains a collaboration channel into Copilot, not an approval authority or terminal input channel.
- Evidence must not include raw verification tokens, event encrypt keys, signatures, raw request bodies, JWTs, Feishu app secrets, provider keys, or private message text.
