# ForgeBadger Companion and Relay Threat Model

Date: 2026-11-01
Status: Proposed; docs-only architecture package
Scope: paired mobile control of an existing ForgeBadger computer before runtime implementation

Related: [Companion and Relay design](2026-11-01-companion-relay-design.md)

## Context

Companion extends ForgeBadger from a loopback/local-network console to a mobile
control plane reachable across untrusted networks. It does not move development
to a cloud worker and does not authorize remote SSH targets. Gateway, Session
Server, project files, and AI CLI account state remain on the user's computer.

The new attack surface is not merely a new UI. It includes device enrollment,
long-lived host/device identities, a Relay, push providers, durable remote
commands, reconnect synchronization, and mobile caches. A safe design must assume
that the Relay, network path, push payload, and app input are untrusted while
preserving existing tenant, project, Goal, approval, and execution boundaries.

This document is design evidence only. It does not implement an app, Relay,
Gateway routes, migrations, protocol code, dependencies, push accounts, or a
release gate change.

## System Model

```text
Companion App and OS secure key storage
  -> TLS Relay session with device authentication
    -> Relay routing/presence/push hint
      -> TLS host session initiated by Gateway
        -> end-to-end authenticated/encrypted inner message
          -> Companion device + tenant + project authority checks
            -> typed query or command adapter
              -> existing Goal/Copilot/approval/session services
                -> canonical SQLite records and Session Server effects
```

Responses, events, and receipts traverse the reverse path. Relay cannot decrypt
inner application payloads. Push providers see only generic attention hints.
Canonical development state never comes from Relay, push, an app cache, or a
model-generated status assertion.

## Assets

| Asset | Protection Goal |
|---|---|
| Owner identity and active-user state | Prevent a device, Relay, or external identity from becoming an unrestricted owner |
| Host identity and private keys | Prevent host impersonation, silent key replacement, and key disclosure |
| Device identity and private keys | Prevent device cloning, unauthorized pairing, and use after revocation |
| Project/tenant binding | Prevent cross-user, cross-device, cross-host, or out-of-scope reads and effects |
| Goal questions, answers, tasks, journals, and evidence | Preserve confidentiality, canonical state, and legal Goal transitions |
| Pending approvals and exact parameters | Prevent stale, truncated, substituted, or replayed approval decisions |
| Command and effect receipts | Prevent false success, duplicate effects, and automatic replay of uncertain writes |
| Source code, diffs, paths, and session summaries | Minimize disclosure to Relay, push providers, logs, and lost-device caches |
| Provider/CLI credentials and attach tokens | Keep all existing credential boundaries; never add them to Companion transport |
| Terminal and Shell authority | Prevent the Companion protocol from becoming arbitrary code execution |
| Event sequence and presence | Prevent forged live state, silent gaps, phantom projects, and stale queued commands |
| Local-first runtime | Ensure Relay/push failure, disablement, or rollback does not harm local work |
| Availability and cost | Bound pairing, connection, query, event, push, and command resource consumption |

## Trust Boundaries

| Boundary | Description |
|---|---|
| App UI/storage to Companion protocol | App text, resource IDs, command IDs, cached records, biometric outcomes, and protocol frames are untrusted input |
| Device keys to Relay registration | Relay learns public routing identity but must not gain ForgeBadger authority |
| App to Relay | TLS and device authentication protect transport, but Relay can drop, delay, reorder, replay, or attempt substitution |
| Relay to Gateway host session | Host registration and heartbeats provide routing/presence only; Gateway must authenticate and authorize every inner message |
| Pairing QR/claim to owner confirmation | One-time secrets, host pinning, claimed keys, SAS, scope, and expiry must bind the exact enrolled device |
| Gateway Companion service to repositories | Pairing, device, command, outbox, project, Goal, and approval records must remain tenant scoped |
| Command admission to existing execution services | A durable remote command is not itself proof of effect; existing state machines and idempotency must be preserved |
| Gateway to Relay/push/logging/diagnostics | Only bounded, redacted metadata or ciphertext may leave the canonical service boundary |
| Device local cache to a later app user | Offline data can outlive device revocation and must be minimized, encrypted, and marked stale |
| Companion feature to local runtime | Optional connectivity must not become a startup, recovery, or local-session dependency |

## Security Invariants

1. Relay possession of a host ID, device ID, pairing ID, push token, or ciphertext
   grants no project or approval authority.
2. Pairing alone grants no project access. An active user must explicitly confirm
   the exact device keys, project set, capabilities, and authority revision.
3. Gateway authenticates and authorizes every query, command, effect, approval,
   and result delivery; a valid Relay connection is never sufficient.
4. Host/device key changes fail closed. No silent key replacement or protocol
   downgrade is allowed.
5. Commands are typed and idempotent. Unknown writes are never automatically
   replayed, and a receipt distinguishes admission from confirmed effect.
6. Approval requires complete exact parameters and a matching pending-action
   digest. Truncated, expired, changed, or out-of-scope requests are read-only or
   rejected.
7. Device and scope revocation fence later reads and effects even if a malicious
   Relay ignores revocation or retains old messages.
8. Relay and push never receive private keys, provider credentials, owner JWTs,
   terminal attach tokens, raw Goal content, source code, or command parameters.
9. No generic Shell, terminal-input, arbitrary HTTP, or arbitrary filesystem
   method exists in the Companion protocol.
10. Companion is optional. Its failure or disablement cannot stop or corrupt local
    projects, Gateway recovery, Goals, Session Server, or running CLIs.

## STRIDE Threat Register

| Threat ID | Asset | Trust Boundary | STRIDE | Abuse Case | Required Control | Stable Failure Code | Release Blocker |
|---|---|---|---|---|---|---|---|
| COMP-T01 | Pairing and host identity | QR/claim to owner confirmation | Spoofing | An attacker scans/replays a QR, races a claim, substitutes device keys, or tricks the owner into confirming another device | Ten-minute single-use secret; host public-key pinning; encrypted claim; fresh nonces; SAS comparison; exact claimed key/scope confirmation; previous attempts invalidated | `COMPANION_PAIRING_EXPIRED`, `COMPANION_PAIRING_CLAIMED`, `COMPANION_PAIRING_MISMATCH` | Yes, if a device can activate without exact owner confirmation |
| COMP-T02 | Host/device application payload | App/Relay/Gateway transport | Spoofing / Tampering | A malicious or compromised Relay reads content, modifies commands, swaps ciphertext between hosts/devices, or forges host receipts/events | TLS plus end-to-end AEAD and signatures; canonical domain-separated encoding; host/device/message context binding; host key pinned at pairing; signed receipts | `COMPANION_AUTH_FAILED`, `COMPANION_HOST_KEY_MISMATCH`, `COMPANION_MESSAGE_INVALID` | Yes, if Relay plaintext access or undetected substitution is possible |
| COMP-T03 | Device private key and owner authority | Lost device to app/Gateway | Spoofing / Elevation of Privilege | A stolen phone or extracted app database is used as the owner after loss/revocation | OS secure key storage; non-exportable keys where supported; no owner password/JWT; per-device revocation; biometric-gated signing for high-risk actions; minimal encrypted cache | `COMPANION_DEVICE_REVOKED`, `COMPANION_DEVICE_AUTH_FAILED` | Yes, if long-lived bearer owner credentials or plaintext device keys are shipped |
| COMP-T04 | Host key continuity | Host storage/backup/restore to device | Spoofing | Reinstalled Gateway, restored state, or attacker-controlled host presents new keys and devices silently trust it | Host keys encrypted at rest; fingerprint display; key rotation revokes all pairings; no trust-on-first-use replacement after pairing | `COMPANION_HOST_KEY_MISMATCH`, `COMPANION_HOST_REVISION_CHANGED` | Yes, if key replacement silently restores device trust |
| COMP-T05 | Command integrity and side effects | App to durable command executor | Tampering / Repudiation | Repeated taps, Relay replay, app retry, or Gateway recovery executes a write more than once; same ID is reused with different parameters | Unique device/command identity; payload digest; durable admission; underlying intent/effect idempotency; exact-retry receipt lookup; conflicting reuse rejection; signed receipts | `COMPANION_COMMAND_CONFLICT`, `COMPANION_COMMAND_EXPIRED` | Yes, if duplicates can repeat an effect or app-only deduplication is the only control |
| COMP-T06 | Unknown effect recovery | Command executor to external/local effect | Tampering / Repudiation | A crash or timeout occurs after an effect but before its receipt; recovery blindly retries and repeats the write | Per-adapter durable stages and canonical reconciliation; `unknown` state/effect status; no generic running-to-accepted reset; no automatic uncertain retry | `COMPANION_COMMAND_UNKNOWN`, `COMPANION_RECONCILIATION_REQUIRED` | Yes, if uncertain writes are replayed or shown as definite failures |
| COMP-T07 | Tenant/project/device binding | Companion service to repositories/services | Elevation of Privilege / Information Disclosure | A device supplies another user's project, Goal, approval, run, host, or command ID, or reads another device's stream | Automatic `user_id` repository scope; host/device/user/project checks on every operation; canonical resource ownership; per-device outbox; cross-tenant IDs return not found/rejected | `COMPANION_AUTHORITY_REJECTED`, `COMPANION_RESOURCE_NOT_FOUND` | Yes, for any cross-tenant/device/host disclosure or effect |
| COMP-T08 | Device grant and revocation | Pairing/scope change to admission and effect | Elevation of Privilege | A scope reduction or revocation occurs while a command is queued/running, but the old authority is later used | Authority revision snapshots and rechecks at query, admission, pre-effect, approval, recovery, and delivery; pending commands fenced; scope reduction forces sync reset | `COMPANION_DEVICE_REVOKED`, `COMPANION_AUTHORITY_STALE` | Yes, if revoked authority can produce a later effect or read |
| COMP-T09 | Pending approval integrity | App decision to existing approval transaction | Tampering / Elevation of Privilege | Mobile UI shows one operation but approves another, approves truncated parameters, or uses a stale/digested-mismatched pending action | Exact bounded full parameters; target/project display; pending-action ID plus parameters/resources digest and expected revision; existing synchronous decision transaction; no approval on incomplete preview | `COMPANION_APPROVAL_STALE`, `COMPANION_APPROVAL_PREVIEW_INCOMPLETE`, `COMPANION_AUTHORITY_REJECTED` | Yes, if substituted, stale, truncated, or free-form approval is possible |
| COMP-T10 | Mobile Goal and run semantics | App command to Copilot/Goal services | Tampering / Repudiation | App treats Goal cancellation as rollback, run stop as CLI termination, or CLI turn completion as verified/accepted work | Typed command mapping and result copy; preserve canonical Goal/run/session states; separate verification evidence and owner acceptance; no autonomous Goal grants from Companion | Existing canonical Goal/run error codes plus `COMPANION_COMMAND_UNKNOWN` | Yes, if UI creates a new unsafe execution or acceptance path |
| COMP-T11 | Event stream and stale presence | Gateway/Relay to app cache | Tampering / Information Disclosure | Relay reorders/replays events, a sync gap is ignored, removed projects remain visible, or an offline host appears live with fresh-looking data | Per-device monotonic sequence; gap detection; snapshot reset; scope-reduction reset; host heartbeat plus last-successful-sync timestamps; stale/offline presentation | `COMPANION_SYNC_RESET_REQUIRED`, `COMPANION_HOST_OFFLINE`, `COMPANION_SYNC_STALE` | Yes, if silent gaps or forged events can become canonical mobile state |
| COMP-T12 | Offline command freshness | App/Relay queue to host admission | Tampering / Elevation of Privilege | A device queues an approval or Goal control while the host is offline and executes it later against changed context | P0 refuses offline command queue; short command expiry; expected resource/authority revisions; local draft only; same-ID receipt check before exact retry | `COMPANION_HOST_OFFLINE`, `COMPANION_COMMAND_EXPIRED`, `COMPANION_RESOURCE_STALE` | Yes, if context-sensitive commands execute after their validity expires |
| COMP-T13 | Secrets and private content | Gateway to Relay/push/logs/cache | Information Disclosure | Goal text, code, paths, credentials, command parameters, or tokens leak through Relay plaintext, APNs/FCM, diagnostics, analytics, or lock-screen previews | End-to-end payload encryption; generic push hints; log/diagnostic denylist; no terminal sync; encrypted bounded app cache; no sensitive notification preview; secret-bearing fields rejected by schemas | `COMPANION_PAYLOAD_UNSAFE`, `COMPANION_PAYLOAD_TOO_LARGE` | Yes, for private key, provider credential, owner token, attach token, or sensitive plaintext Relay/push disclosure |
| COMP-T14 | Protocol capability boundary | Companion registry to Gateway execution | Elevation of Privilege | A generic method, REST path, terminal input, Shell command, or model-selected tool turns Companion into arbitrary remote code execution | Explicit query/command registry and schemas; no generic proxy/Shell/terminal methods; independent registry review and tests; Goal grants fixed empty for mobile creation | `COMPANION_METHOD_NOT_ALLOWED`, `COMPANION_INPUT_INVALID` | Yes, for any generic execution or proxy primitive |
| COMP-T15 | Push identity and metadata | Device/Relay to APNs/FCM and app | Spoofing / Information Disclosure | Attacker forges a push hint, swaps device push tokens, or learns project activity from notification text | Host/device authenticated routing registration; opaque collapse IDs; generic content only; push treated as untrusted hint; actual data requires authenticated sync; token rotation | `COMPANION_PUSH_REGISTRATION_INVALID`, `COMPANION_SYNC_STALE` | Yes, if push content alone can authorize an action or disclose sensitive content |
| COMP-T16 | Availability and resource limits | Internet/Relay to Gateway and push workers | Denial of Service / Denial of Wallet | Pairing floods, oversized frames, connection churn, expensive queries, outbox growth, push storms, or command floods exhaust Gateway/Relay/provider resources | Pairing and connection rate limits; bounded schemas/frames/pages; per-device outbox caps/TTL; query complexity limits; command/push throttling; backpressure; no unbounded retry | `COMPANION_RATE_LIMITED`, `COMPANION_PAYLOAD_TOO_LARGE`, `COMPANION_SYNC_RESET_REQUIRED` | Yes, if unauthenticated traffic can cause unbounded local work/storage or repeated model/provider effects |
| COMP-T17 | Protocol version and downgrade | App/Relay/Gateway handshake | Tampering / Elevation of Privilege | A peer selects an older protocol, weaker algorithm, unknown command encoding, or ambiguous canonicalization to bypass validation | Explicit minimum/current versions; algorithm identifiers allowlisted; canonical test vectors; unknown versions/fields with security meaning rejected; no fallback to plaintext or unsigned receipts | `COMPANION_PROTOCOL_UNSUPPORTED`, `COMPANION_MESSAGE_INVALID` | Yes, if downgrade or ambiguous decoding bypasses authentication/validation |
| COMP-T18 | Local-first disablement and rollback | Companion/Relay to local Gateway runtime | Denial of Service | Relay failure, bad Companion migration, feature disablement, or rollback breaks local Gateway startup, Goals, notifications, or Session Server recovery | Disabled by default; outbound-only optional connector; additive tenant-safe migrations; startup isolation; local inspection/revocation; no local task termination on disable; compatible rollback tests | `COMPANION_DISABLED`, `COMPANION_RELAY_UNAVAILABLE` | Yes, if local work depends on Relay/push or disablement terminates existing work |
| COMP-T19 | Mobile cache and device revocation | Device storage to later local user | Information Disclosure | A revoked device continues displaying previously synced sensitive project state or another app user opens the cache | Bounded encrypted cache; OS access controls; explicit last-sync/stale state; local logout/cache clear; document that revocation cannot erase retrieved data | Local-only `COMPANION_CACHE_UNAVAILABLE` | Yes, if design claims remote wipe or stores plaintext cache without OS protection |
| COMP-T20 | Diagnostics and support evidence | Gateway/app/Relay diagnostics export | Information Disclosure / Repudiation | Support bundles include QR secrets, private keys, push tokens, ciphertext keys, full command payloads, Goal answers, or terminal output | Stable layer/error codes; host/device public fingerprints; timestamps, state, and redacted counts only; payload/token/secret denylist tests; no raw content in diagnostics | `COMPANION_DIAGNOSTICS_REDACTED` | Yes, if diagnostic evidence bypasses existing credential/content redaction rules |

## Required Controls

### Identity and transport

- Use reviewed cryptographic libraries and published test vectors; do not invent
  cryptographic primitives or accept multiple ambiguous canonical encodings.
- Keep device keys in OS secure storage and host private keys inside ForgeBadger's
  existing encrypted secret boundary.
- Require host/device signatures and end-to-end authenticated encryption even over
  TLS. Relay-visible registration and heartbeats are not application authority.
- Refuse insecure Relay URLs outside an explicitly scoped development harness.
  Production pairing and connections require TLS.
- Rotate/revoke by explicit owner action. Never silently replace trusted keys.

### Authorization

- Bind every device to `user_id` and host, and every grant to explicit personal
  project IDs and capabilities.
- Re-read active user and current authority at every security-sensitive stage.
- Preserve automatic tenant filtering in all new repositories and existing
  resource repositories. Never implement tenant filtering only in the app or
  Relay.
- Keep shared/team projects, credential administration, global memory, Goal merge,
  terminal, and arbitrary chat outside P0.

### Execution and recovery

- Use a typed command registry and per-command adapters. Do not expose a generic
  HTTP or Shell transport.
- Share idempotency identity between Companion command records and underlying
  durable intents/effects.
- Return stable accepted/running/succeeded/rejected/failed/unknown receipts with
  separate effect status.
- Treat timeout after possible staging as unknown. Do not infer no effect from a
  lost connection or failed receipt write.
- Make restart recovery adapter-specific and evidence-based. Never bulk-retry old
  failed, running, or unknown writes.

### Data and availability

- Send only typed bounded projections. Do not mirror SQLite or terminal scrollback
  to Relay or app.
- Use generic push hints and authenticated content fetch. APNs/FCM delivery is not
  proof of visibility or action.
- Apply strict frame, page, storage, rate, retention, and retry limits before
  expensive canonical lookups or model/provider work.
- Mark cached data stale and reset after sequence gaps or scope reductions. Never
  present cached state as a fresh canonical result.

## Verification Map

| Requirement | Threats | Required Evidence |
|---|---|---|
| Pair exact device only | COMP-T01, T02, T04, T17 | Expired/replayed/raced QR claims; wrong host key; SAS mismatch; key substitution; owner cancellation; protocol downgrade; encrypted-claim tests |
| Relay remains untrusted | COMP-T02, T11, T13, T15 | Hostile Relay read/modify/reorder/replay/drop tests; ciphertext context swapping; forged events/receipts/push; plaintext and metadata inspection |
| Lost device is contained | COMP-T03, T08, T19 | Secure-storage inspection; revocation before query/admission/effect/delivery; old Relay connection reuse; cache protection and honest no-remote-wipe UX |
| Commands are effectively once | COMP-T05, T06 | Same ID/same payload, same ID/different payload, repeated taps, Relay duplicates, crash before/after admission/effect/receipt, canonical reconciliation, unknown no-replay tests |
| Tenant and project isolation holds | COMP-T07, T08 | Cross-user/device/host/project/Goal/approval/run/command IDs; scope reduction while queued/running; reduced-scope sync reset |
| Approval is exact | COMP-T08, T09 | Full-parameter boundaries, digest/revision mismatch, changed pending action, expiry, repeated/conflicting decisions, incomplete preview approve-button omission |
| Existing execution semantics survive | COMP-T10, T14 | Goal transition/run-stop/CLI distinction tests; registry rejection of Shell/terminal/arbitrary HTTP; mobile-created Goals have no autonomous grants |
| Reconnect is complete and honest | COMP-T11, T12 | Ordered replay, duplicates, sequence gaps, outbox expiry/overflow, canonical snapshot reset, host sleep, offline command refusal, stale display |
| Sensitive content stays bounded | COMP-T13, T15, T20 | Relay/APNs/FCM/log/diagnostic schema and snapshot scans; secrets/token denylist; oversized/secret-shaped payload rejection; lock-screen preview review |
| Availability is bounded | COMP-T16 | Pair/connect/query/command/push floods; frame/page limits; outbox TTL/cap; backoff and no unbounded model/provider retry |
| Local-first behavior survives | COMP-T18 | Relay down at startup/runtime, push down, feature disabled, additive migration and compatible rollback; local Web/Goal/session recovery regression tests |
| Real mobile path works | All P0 controls | Physical iOS/Android secure storage, biometric key use, push, cellular/Wi-Fi switching, app death, host sleep, Gateway restart, non-LAN pairing and command evidence |

## Release Blockers

Any of the following blocks Companion P0 release:

- A device can pair, read, approve, or execute without exact owner-confirmed
  identity and current tenant/project/capability authority.
- Relay, push, logs, or diagnostics can obtain private keys, owner/provider
  tokens, terminal attach tokens, raw Goal content, source code, or command
  parameters.
- A generic Shell, terminal input, arbitrary HTTP, arbitrary filesystem, or
  model-selected Companion execution method is exposed.
- Duplicate/replayed commands can repeat effects, or uncertain writes are
  automatically retried.
- A receipt reports success from app submission or Relay delivery without a
  confirmed canonical result.
- A stale, changed, truncated, or out-of-scope approval can be approved.
- Device revocation or scope reduction cannot fence a later read, approval,
  command effect, or delivery.
- Offline/stale data or Relay presence is presented as fresh canonical state.
- Companion or Relay failure/disablement harms local projects, Gateway recovery,
  Copilot/Goal state, Session Server, or running CLI processes.
- Real non-LAN and physical-device evidence is missing; unit tests or loopback
  browser tests alone cannot clear the release gate.

## Out Of Scope

- App and Relay implementation, framework selection, hosting procurement, push
  account setup, and public rollout.
- SSH remote execution targets and remote project file synchronization.
- Full terminal, arbitrary Copilot chat, mobile code editing, Goal merge,
  deployment, shared/team projects, and provider/model administration.
- A central ForgeBadger cloud account, cloud development workers, billing,
  telemetry product analytics, or hosted project storage.
- Remote wipe guarantees for data already retrieved by a device.
