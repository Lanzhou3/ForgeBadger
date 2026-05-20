---
phase: "05"
slug: remote-execution-architecture
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-20
---

# Phase 05 - Validation Strategy

Per-phase validation contract for the remote execution architecture plan.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Docs/static checks plus `node:test` backend tests and Playwright E2E smoke |
| **Config file** | `package.json`, `packages/gateway/package.json`, `packages/web/playwright.config.ts` |
| **Quick run command** | `pnpm --dir packages/gateway test test/diagnostics.test.ts test/safe-resolve.test.ts` |
| **Full suite command** | `pnpm -r test` |
| **Estimated runtime** | quick: <60s; full: environment-dependent |

---

## Sampling Rate

- **After every task commit:** Run static scope checks plus the quick run command.
- **After every plan wave:** Run the full suite when the local runtime can support it; otherwise document exact skipped/failing command and reason.
- **Before `$gsd-verify-work`:** Verification report must include static scope evidence and focused test evidence.
- **Max feedback latency:** one task commit.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 05-01 | 1 | REM-01 | REM-T01..REM-T10 | Remote architecture package covers execution targets, remote agent, host keys, path safety, diagnostics, rollback, and staged implementation without runtime code. | docs/static | `rg -n "host_key_mismatch|ssh_auth_failed|remote_agent_missing|remote_path_denied|remote_terminal_attach_failed|rollback" docs/superpowers/specs docs/reports` | present | pending |
| 05-01-02 | 05-01 | 1 | REM-02 | REM-T08, REM-T10 | Hosted/cloud/billing/telemetry/marketplace scope remains deferred and does not enter local-first runtime paths. | static | `rg -n "cloud deployment|hosted telemetry|billing|marketplace|cloud worker" docs packages -g '!node_modules'` | present | pending |
| 05-01-03 | 05-01 | 1 | COD-01 | REM-T09 | Codex app-server `/turn` remains disabled by default and Web prompt/turn input is not exposed. | automated/static | `pnpm --dir packages/gateway test test/codex-app-server-routes.test.ts` and `pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line` | present | pending |
| 05-01-04 | 05-01 | 1 | REM-01, REM-02, COD-01 | all | Verification report records command output or exact caveats, including no remote runtime route/transport additions. | docs/static | `test -f docs/reports/remote-execution-architecture-verification-2026-05-21.md` | missing until execution | pending |

---

## Wave 0 Requirements

Existing infrastructure covers this design phase:

- `pnpm --dir packages/gateway test` is available for focused backend tests.
- `pnpm --dir packages/web exec playwright test` is available for Codex app-server browser smoke when local server binding is permitted.
- `rg` static checks are available for runtime scope, hosted/cloud leakage, unsafe SSH options, and Codex `/turn` boundaries.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Scope-leak interpretation | REM-01, REM-02, COD-01 | Existing docs intentionally mention deferred remote/cloud/Codex-turn scope, so zero-match grep is not a valid rule. | Inspect each static match and classify it as deferred/boundary text or a new runtime implementation commitment. |
| Node/runtime caveat triage | COD-01 | Research observed local Node v24 native/file-level failures for some focused tests. | Rerun failing commands under the project's supported CI/runtime before treating them as blockers; document exact result in the verification report. |

---

## Validation Sign-Off

- [x] All planned task categories have automated or static verify commands.
- [x] Sampling continuity: no 3 consecutive tasks without automated/static verify.
- [x] Wave 0 covers all missing references for this docs-only phase.
- [x] No watch-mode flags.
- [x] Feedback latency is bounded to one task commit.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending execution evidence.
