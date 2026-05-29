---
phase: 07
slug: feishu-live-callback-readiness
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-21
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test, TypeScript, GSD evidence checks |
| **Config file** | `packages/gateway/package.json`, `.planning/config.json` |
| **Quick run command** | `pnpm --dir packages/gateway test test/feishu-integration.test.ts` |
| **Full suite command** | `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts && pnpm --dir packages/gateway typecheck` |
| **Estimated runtime** | ~8-20 seconds for focused backend tests; manual callback time varies |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --dir packages/gateway test test/feishu-integration.test.ts` when code or route tests changed; otherwise run `git diff --check`.
- **After every plan wave:** Run `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts && pnpm --dir packages/gateway typecheck`.
- **Before `$gsd-verify-work`:** Focused backend tests, typecheck, `git diff --check`, decision coverage, and targeted secret scan must be green or explicitly classified.
- **Max feedback latency:** 20 seconds for automated checks; manual Feishu console callback may be `Pass`, `Caveat`, or `Blocked`.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | FEI-01 | T-07-01 / T-07-02 | Callback setup helper, if added, prints no verification token or event encrypt key | unit | `pnpm --dir packages/gateway test ../../scripts/prepare-feishu-public-webhook.test.ts` | optional W1 | pending |
| 07-01-02 | 01 | 1 | FEI-01 | T-07-02 | Real console callback is recorded as pass/caveat/blocked without secrets | manual | `git diff --check` plus targeted scan | W1 | pending |
| 07-02-01 | 02 | 2 | FEI-02 | T-07-03 / T-07-04 | Encrypted payloads fail closed; multi-instance remains caveated | integration | `pnpm --dir packages/gateway test test/feishu-integration.test.ts` | W2 | pending |
| 07-02-02 | 02 | 2 | FEI-03 | T-07-05 | Feishu text cannot approve, send terminal input, or bypass tenant policy | integration | `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts` | W2 | pending |
| 07-02-03 | 02 | 2 | FEI-01, FEI-02, FEI-03 | T-07-02 | Evidence docs contain no raw secrets and classify live vs simulated evidence | static | `git diff --check` and targeted `rg` scan | W2 | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Feishu developer-console URL verification | FEI-01 | Requires real Feishu app console and public HTTPS callback URL | Configure Feishu event subscription callback URL to `https://<public-host>/api/v1/integrations/feishu/webhook/<publicWebhookId>`, run URL verification, record pass/caveat/blocked without secrets |
| Optional real message event | FEI-01, FEI-03 | Requires a real allowed Feishu chat and subscribed message event | Trigger `im.message.receive_v1` in an allowed chat, record whether Gateway returned accepted/ignored/rejected and whether automated negative controls cover untested cases |

---

## Validation Sign-Off

- [x] All tasks have automated verify or manual-only justification.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-21
