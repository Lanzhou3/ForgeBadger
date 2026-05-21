---
phase: 02-public-feishu-webhook-safety
plan: 01
subsystem: docs
tags: [feishu, webhook, security-contract, api]

requires:
  - phase: 02-public-feishu-webhook-safety
    provides: Phase 2 context and plan
provides:
  - public Feishu webhook route contract
  - signature, timestamp, replay, and rate-limit boundary
  - fail-closed audit, redaction, and non-goal language
affects: [docs-api, feishu-public-webhook, copilot-ingress]

tech-stack:
  added: []
  patterns:
    - public webhook protocol responses are documented separately from OpenForge REST envelopes
    - local single-Gateway replay/rate-limit storage requires explicit multi-instance caveat

key-files:
  created:
    - .planning/phases/OF-02-public-feishu-webhook-safety/02-01-SUMMARY.md
  modified:
    - docs/API.md

key-decisions:
  - "The public Feishu webhook uses `POST /api/v1/integrations/feishu/webhook/:publicId`, separate from the JWT-protected `/inbound` adapter."
  - "Public webhook handling is disabled by default and requires tenant-owned verification token and event encrypt key configuration."
  - "Replay and rate limits are persistent for local single-Gateway deployment; multi-instance public webhook use requires a shared replay/rate-limit store."

patterns-established:
  - "Feishu public ingress documents minimal protocol responses and avoids the OpenForge authenticated REST envelope."
  - "Feishu text remains Copilot ingress only, not approval authority or terminal input."

requirements-completed: []

duration: 12min
completed: 2026-05-20
---

# Phase 02 Plan 01: Public Webhook Contract Summary

`docs/API.md` now specifies the public Feishu webhook safety contract before implementation.

## Accomplishments

- Added `POST /api/v1/integrations/feishu/webhook/:publicId` as a separate public callback route from authenticated `/inbound`.
- Documented Feishu headers `X-Lark-Request-Timestamp`, `X-Lark-Request-Nonce`, and `X-Lark-Signature`, raw-body verification, five-minute timestamp freshness, URL verification challenge behavior, and encrypted payload boundary.
- Documented persistent replay and rate-limit semantics, including event/message replay keys, nonce/signature replay checks, per chat and mapped-user scopes, and the local single-Gateway storage limitation.
- Documented fail-closed policy reuse, audit metadata, redaction, unsupported free-form approval text, and no direct terminal input.

## Verification

- `rg -n "webhook/:publicId|/inbound.*test adapter|X-Lark-Request-Timestamp|X-Lark-Request-Nonce|X-Lark-Signature|\\{\\\"challenge\\\"|OpenForge REST envelope|single-Gateway|shared replay|mapped OpenForge user|terminal input" docs/API.md`
- `rg -n "token|signature|encrypt key|raw Feishu message" docs/API.md` returned only documentation-policy language and existing API token documentation, not real secrets.
- `git diff --check`

## Deviations from Plan

None.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

Ready for Plan 02 implementation: public webhook tests, persistent replay/rate-limit storage, raw-body signature verification, and guarded Copilot handoff.

## Self-Check: PASSED

