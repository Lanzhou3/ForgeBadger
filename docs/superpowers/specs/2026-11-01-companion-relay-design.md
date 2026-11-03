# ForgeBadger Companion and Relay Design

Date: 2026-11-01
Status: Proposed; docs-only architecture package
Scope: paired mobile control of an existing ForgeBadger computer

Related: [Companion threat model](2026-11-01-companion-relay-threat-model.md)

## Context

ForgeBadger already owns the local development control plane. Gateway exposes
project, session, notification, Copilot, Goal, Project Manager, approval, and
terminal APIs; Session Server owns AI CLI processes. Copilot Goals already have
durable tasks, questions, journals, verification evidence, isolated workspaces,
and owner-only merge operations. Feishu and Telegram channels already demonstrate
paired remote identities, project-scoped authority, exact approvals, durable
inputs, and result delivery.

The missing product is a mobile Companion that can reach that existing computer
outside the local network. The problem is not remote code execution on another
host and must not reuse the SSH execution-target design. The computer remains the
execution host and canonical source of truth. Companion is another controlled
client of the same Gateway services.

Gateway currently defaults to loopback and the existing channel management APIs
do not provide a public inbound relay. Companion therefore requires an explicit,
optional connection layer. Merely binding Gateway to `0.0.0.0`, proxying arbitrary
HTTP through a tunnel, or placing a long-lived owner JWT in an app is rejected.

This package defines architecture and security contracts only. It does not add a
mobile application, Relay implementation, Gateway routes, migrations, environment
variables, dependencies, or release commitments.

## Product Contract

Companion optimizes two intervals:

1. The time from a development task needing its owner to the owner knowing.
2. The time from an owner decision to a confirmed, auditable result on the
   computer.

It does not present an invented completion percentage. It presents canonical
states such as running, awaiting an answer, awaiting approval, blocked, ready for
review, completed, offline, and stale, each with evidence and timestamps.

The first release completes this loop:

```text
pair a device
  -> receive a low-sensitivity attention notification
  -> inspect current project/goal/approval context
  -> answer, decide, or control a Goal
  -> confirm the command receipt and resulting evidence
```

### Goals

- Pair and revoke individual mobile devices without sharing the owner's password
  or a long-lived owner JWT.
- Reach a computer behind NAT through an outbound Gateway connection.
- Preserve local-first behavior when Companion or Relay is disabled or offline.
- Reuse Gateway tenant checks, project authority, Copilot run semantics, Goal
  operations, approval decisions, and audit records.
- Make command admission, execution, failure, and uncertainty distinguishable.
- Synchronize missed state after reconnect without treating Relay as a canonical
  database.
- Keep provider credentials, arbitrary terminal access, and sensitive push content
  out of the first release.

### Non-Goals

- No remote desktop or complete mobile IDE.
- No arbitrary Shell, generic terminal command, or generic Gateway HTTP proxy.
- No mobile terminal attach, mobile code editor, Goal merge, deployment, or model
  credential administration in the first release.
- No direct App-to-Session-Server or App-to-SQLite connection.
- No Next.js API routes for Companion or Relay responsibilities.
- No cloud development worker and no transfer of project execution to Relay.
- No terminal scrollback in Relay, the Companion outbox, or SQLite as part of this
  feature.
- No shared/team project control in the first release.
- No autonomous Goal grants supplied by Companion. Goals created remotely start
  with an empty Goal grant set; covered operate actions still require approval.
- No promise of distributed exactly-once execution. The contract is durable
  idempotency plus explicit uncertainty and reconciliation.

## Options Considered

### Recommended: outbound host connection plus untrusted Relay

Gateway and Companion each establish authenticated outbound connections to a
Relay. Relay routes small envelopes and coordinates push hints. Application
payloads are end-to-end encrypted and authenticated between a host and a device.
Gateway remains the only authority that admits and executes operations.

Advantages:

- Works through ordinary NAT without inbound router changes.
- Gives each device an independently revocable identity and scoped authority.
- Supports push hints and reconnect synchronization.
- Keeps local development independent of Relay availability.
- Permits a hosted Relay or a self-hosted Relay without changing authority.

Costs:

- Adds a deployable service, host/device key management, and push operations.
- Requires a versioned protocol and explicit recovery behavior.
- Relay can still observe connection metadata and deny service.

### Alternative: private network plus the existing Web console

A user-operated private network can provide a useful personal technical spike.
It reuses the Web UI and avoids building Relay initially, but it does not by itself
provide per-device pairing, least-privilege mobile scopes, reliable push, or a
mobile command receipt model. It is not the product architecture.

### Alternative: expose Gateway publicly

This has the least new infrastructure but expands the attack surface of every
Gateway route and makes secure mobile terminal and credential exposure more
likely. It is rejected.

### Alternative: use only Feishu or Telegram

Existing channels remain useful lightweight clients and their authority model
should be reused. They are not substitutes for a dedicated app with device keys,
rich evidence views, push control, and a local device-management experience.
Companion must not create a second, inconsistent execution path.

## System Model

```text
Companion App
  device signing + encryption keys in OS secure storage
  |
  | TLS, device-authenticated Relay session
  v
Companion Relay
  routing, short-lived buffering, presence hints, push hints
  no project authority and no plaintext application payload
  ^
  | TLS, host-authenticated outbound Relay session
  |
ForgeBadger Gateway on the development computer
  Companion admission and projection service
  device/pairing/command/outbox repositories
  existing Copilot, Goal, PM, approval, notification, session services
  |
Session Server -> AI CLI and project workspace
```

There are four distinct identities:

- **Host**: one ForgeBadger Gateway installation, identified by host keys.
- **Device**: one app installation, identified by device keys and bound to one
  ForgeBadger user and host.
- **Owner**: the active ForgeBadger user whose existing resource ownership and
  device grant are both required.
- **Relay**: a connectivity provider. It is never an owner, approver, or source of
  project truth.

P0 product acceptance uses one owner, one computer, and personal projects. The
data and authorization model must nevertheless remain tenant-safe on a multi-user
Gateway and must not prevent later multi-host support.

## Authority Model

Pairing establishes identity, not blanket project authority. A device grant is an
owner-created, tenant-scoped record containing:

- host and user binding;
- explicit personal project IDs;
- an authority revision incremented on every scope or key change;
- a capability set;
- device status and expiry/revocation state.

Recommended capability names:

| Capability | Allows |
|---|---|
| `status.read` | Host presence, authorized project/session summaries, and attention summaries |
| `goals.read` | Goal lists, details, tasks, bounded journals, verification summaries, and diff summaries |
| `goals.create` | Create a Goal in an authorized project with no autonomous Goal grants |
| `goals.answer` | Answer an `awaiting_user` Goal |
| `goals.control` | Pause, resume, or cancel a Goal |
| `approvals.decide` | Approve or reject an exact pending action after full mobile inspection |
| `runs.stop` | Cancel an authorized Copilot run; this does not kill a CLI session |

The pairing UI offers explicit Observer, Operator, and Approver presets, with
Observer as the default. Presets only populate the capability list; Gateway stores
and enforces the resulting list. Project membership is always explicit.

P0 excludes `goal.merge`, CLI session lifecycle control, terminal attach, arbitrary
Copilot chat, global memory, credential/configuration reads, and shared/team
projects. Revoking a device prevents new reads, command admission, pending command
execution, and future result delivery. It does not undo effects already started,
stop local development, or erase data previously retrieved by the device.

Every query, command admission, execution attempt, approval resumption, and result
delivery rechecks active user, host, device, grant revision, project ownership,
and resource state. A failure never falls back to unrestricted owner authority.

## Cryptographic Identity And Pairing

### Key policy

The host and each device have separate signing and key-agreement key pairs. The
proposed cryptographic contract is Ed25519 for signatures and X25519 with
HKDF-SHA-256 and an AEAD such as XChaCha20-Poly1305 for application payloads.
Implementation must use a reviewed, maintained library and deterministic
canonical encoding with protocol/domain separation; it must not implement
cryptographic primitives locally.

Device private keys are generated on the device and held in iOS Keychain/Secure
Enclave or Android Keystore where supported. Host private keys are generated by
Gateway and encrypted at rest with the existing ForgeBadger secret-box/master-key
boundary. Relay stores only public keys and routing metadata.

A host ID is derived from the host public signing key. A device ID is random and
is bound to its public keys at pairing. TLS protects transport; signatures and
end-to-end encryption remain mandatory even with TLS.

Biometric unlock can gate use of a device signing key and provide local user
presence. It is not treated as a server-verifiable biometric assertion.

### Host enrollment

1. An active instance admin explicitly enables Companion and supplies a validated `wss` Relay URL.
2. Gateway generates or loads the host key pair and registers the host public
   identity with Relay.
3. Gateway maintains an outbound authenticated host session. Relay registration
   provides routing only and grants no ForgeBadger user authority.
4. Changing the Relay URL or rotating host keys in P0 revokes existing pairings
   and requires re-pairing. Silent trust of a replacement host key is forbidden.

### Device pairing

1. The owner creates a pairing in the local Web console. Gateway generates a
   high-entropy one-time secret and a pairing record that expires after ten
   minutes.
2. The QR contains only the protocol version, Relay URL, host ID/public-key
   fingerprint, pairing ID, and one-time secret. It contains no owner JWT,
   provider credential, attach token, or host private key.
3. The app generates device keys and sends a pairing claim encrypted to the
   pinned host key. Relay routes the claim but cannot read the one-time secret or
   replace the device keys undetected.
4. Host and app independently derive a short authentication string from the
   pairing secret, host/device public keys, and fresh nonces. The owner compares
   it and confirms the exact device name, project scope, capabilities, and current
   authority revision in the Web console.
5. Gateway activates the device, stores only its public keys and grant, and sends
   a signed/encrypted confirmation. Relay accepts the host-signed device routing
   registration.
6. Pairing records are single-use. Expiry, cancellation, a second claim, SAS
   mismatch, host/key revision change, or owner confirmation of a different claim
   invalidates the previous attempt.

Pairing secrets and private keys never enter URLs beyond the transient QR payload,
logs, analytics, persistent Web storage, push payloads, or diagnostics. Relay or
push registration cannot activate a device without Gateway's signed confirmation.

## Protocol

Relay and the host/device inner protocol are independently versioned. Unknown
versions, message types, methods, and capabilities fail closed. Every frame has a
bounded schema, request ID where relevant, expiry, and size limit. Relay applies
connection, pairing, command, query, and per-device rate limits.

Outer Relay messages are limited to routing and delivery concerns such as host and
device registration, pairing claim forwarding, encrypted request/event forwarding,
acknowledgement, presence, and generic push hints. Inner messages are allowlisted:

- `query` / `query_result`
- `command` / `command_receipt`
- `event`
- `sync_reset`
- bounded typed errors

The inner plaintext includes host ID, device ID, protocol version, message ID,
authority revision, creation/expiry time, and a payload digest. Signatures cover
the canonical plaintext and associated routing context. Encryption binds the same
context so a Relay cannot move ciphertext between devices, hosts, commands, or
protocol versions.

P0 application payloads are small and paginated. A Relay envelope target limit is
64 KiB. Goal/approval projections that cannot be represented completely within
their specific bound are read-only on mobile; in particular, a truncated approval
preview cannot be approved.

### Query surface

Queries are typed projections, not arbitrary REST paths:

- host and device status;
- attention inbox;
- authorized project and session summaries;
- Goal list and detail;
- pending approval list and exact detail;
- command receipt lookup;
- event synchronization and snapshot bootstrap.

Responses come from current Gateway canonical records or the durable Companion
outbox. They carry `generatedAt` and relevant resource revisions. Session
projections exclude raw terminal scrollback. Goal diff summaries include paths,
status, counts, and bounded hunks only; full diff and merge remain P1.

### Command surface

P0 commands map to named service adapters:

| Command | Existing semantic boundary |
|---|---|
| `goal.create` | Goal creation using a device/project-bound Copilot conversation and `grants: []` |
| `goal.answer` | Existing owner answer and Goal continuation |
| `goal.pause`, `goal.resume`, `goal.cancel` | Existing Goal state machine |
| `approval.decide` | Existing synchronous approval decision with pending-action and digest checks |
| `run.stop` | Existing Copilot cancellation; not CLI process termination |

Each adapter has a strict input schema, an output projection, resource revision
requirements, and recovery classification. New methods require an explicit
registry change and tests. There is no `http.request`, `shell.run`, `terminal.input`,
or model-selected Companion method.

## Durable Commands And Receipts

### Admission

A command includes a device-generated UUID, type, normalized payload, expected
authority/resource revisions, and expiry. Gateway performs signature, freshness,
size, user, device, scope, tenant, project, and resource checks before durable
admission.

A unique `(device_id, command_id)` record stores the command status, payload
digest, normalized encrypted payload, authority/resource snapshots, result
references, bounded error code, and timestamps. Repeating the same command ID and
payload returns the existing receipt. Reusing the ID with a different digest is a
conflict. The command payload is encrypted at rest and is not copied into logs or
diagnostics.

Admission and the underlying intent/effect must share a durable idempotency
identity. Existing APIs that lack this guarantee need a typed Companion adapter
or service-level idempotency extension; an app-only retry convention is not
sufficient.

### States

`submitted` is an app-local state, not a host receipt. Host-visible states are:

| State | Meaning |
|---|---|
| `accepted` | Durably admitted; no effect is guaranteed yet |
| `running` | An executor owns the command; an effect may be in progress |
| `succeeded` | The named operation has a confirmed canonical result |
| `rejected` | Validation or authority refused the command before its effect |
| `failed` | The operation reached a definite failure; the receipt states known effect status |
| `unknown` | An effect may have occurred but cannot be proven; automatic replay is forbidden |

Receipts separately carry `effectStatus: none | confirmed | unknown`, stable error
codes, canonical result references where available, and current resource
revisions. They are signed by the host. `accepted` never means completed, Relay
receipt never means host admission, and push delivery never means the owner read
or approved anything.

Revocation after admission but before an effect rejects the pending command.
Revocation after an external effect starts cannot undo it; recovery and the
receipt must preserve that uncertainty.

### Recovery

Each command adapter declares which durable stages are safe to resume. On Gateway
restart:

- a command proven not to have reached its effect may resume through the same
  idempotency identity;
- a command with a confirmed canonical effect is reconciled to its existing
  result, not executed again;
- a command whose effect cannot be determined becomes `unknown` and requires
  canonical inspection or a new owner decision;
- no generic recovery job resets all `running` commands to `accepted` or retries
  every failed/unknown command.

Goal cancellation does not roll back writes. Run cancellation does not kill a CLI
session. CLI turn completion does not prove verification, acceptance, merge, or
deployment. These distinctions must remain visible in mobile copy and receipts.

## Events, Offline Behavior, And Synchronization

Gateway maintains a bounded, per-device durable outbox for authorized projections:

- attention item added, changed, or resolved;
- Goal/task/approval summary changed;
- command receipt changed;
- authority revoked or replaced;
- synchronization reset required.

Each event has a per-device monotonic sequence, timestamp, type, and bounded
payload. Outbox writes occur with the relevant canonical projection update where
practical. The outbox is a synchronization aid, not a second project database.
It excludes raw terminal output, provider payloads, secrets, and unbounded diffs.

The app stores the last acknowledged sequence. On reconnect:

1. If the requested sequence remains available, Gateway sends missing events in
   order.
2. If the sequence is unknown, too old, or exceeds retention, Gateway sends
   `sync_reset`; the app discards incremental state and refetches a canonical
   snapshot.
3. Duplicate events are idempotently acknowledged. Gaps are never silently
   accepted as a complete sync.
4. Events outside the current device grant are omitted. Scope reduction emits a
   reset so removed projects disappear from cached projections.

P0 does not queue new commands for an offline host. Relay returns a typed
host-offline response and the app may retain only a local draft. Approvals and
other context-sensitive writes are never held for later execution. An exact retry
after an ambiguous network failure uses the same command ID and payload and first
checks for an existing receipt.

Relay buffering is short-lived and bounded; it is only a delivery optimization.
The Gateway outbox and canonical records determine recovery after Relay data loss.

The app may keep a bounded encrypted cache for offline display. It always shows
the last successful sync time and marks old data stale. Revocation cannot promise
remote erasure of already retrieved data. Lock-screen and push content excludes
project names, Goal text, code, command parameters, paths, and results.

## Presence And Push

Gateway sends heartbeats over its host session. Relay presence is a hint, not a
canonical development state. Proposed initial timings are a 15-second heartbeat,
Relay host-offline declaration after 45 seconds without a valid heartbeat, and an
app stale indicator when data cannot be refreshed. All timestamps remain visible.

Push is an optimization for attention, never an authority or transport for command
payloads. Device push tokens are registered with Relay and rotated without
exposing them to Gateway logs or other tenants. APNs/FCM payloads contain only a
generic attention signal and opaque routing/collapse data. The app fetches the
actual content through an authenticated, encrypted sync.

Push may be delayed, coalesced, or unavailable. Product acceptance cannot assume
that every event produces a visible notification. Relay delivery receipts describe
provider handoff only, not user visibility.

## Gateway And Local Web Surface

All owner-management APIs remain on Gateway under `/api/v1` with normal active-user
authentication and the project response envelope. Proposed routes are:

- `GET|PUT /api/v1/companion/host` for Relay enablement/status, not private keys;
- `POST /api/v1/companion/pairings`;
- `GET /api/v1/companion/pairings`;
- `POST /api/v1/companion/pairings/:id/confirm|cancel`;
- `GET /api/v1/companion/devices`;
- `PATCH /api/v1/companion/devices/:id` for name/scope changes;
- `POST /api/v1/companion/devices/:id/revoke`;
- `GET /api/v1/companion/commands` for bounded owner-visible audit state.

Pairing secrets are returned once and excluded from list responses. Device,
pairing, command, and outbox repositories apply `user_id` scoping automatically.
Host key material is installation-level and is never returned. Web renders the
pairing/device UI; Next.js does not implement Relay or command behavior.

## Data Model Direction

Additive migrations should introduce the equivalent of:

- `companion_host`: singleton host identity, Relay configuration, encrypted key
  material, key/config revision, and status;
- `companion_pairings`: tenant, host, token hash, state, claimed public metadata,
  proposed scope, revision, and expiry;
- `companion_devices`: tenant, host, public keys, grant projects/capabilities,
  authority revision, status, pairing/last-seen/revocation timestamps;
- `companion_commands`: tenant/device identity, command type, encrypted normalized
  payload, payload digest, state/effect status, resource/authority snapshots,
  result references, stable error, and timestamps;
- `companion_outbox`: tenant/device, per-device sequence, bounded event payload,
  timestamp, and retention metadata.

Historical command and outbox rows are bounded by retention and size policies.
Payloads needed for durable execution are encrypted. Receipt and audit projections
redact Goal answers, prompts, paths, and operation parameters unless the canonical
resource already explicitly exposes them to the same owner.

The App does not receive database access. Relay does not receive these tables.

## Disablement And Rollback

Companion is opt-in and disabled by default through a future
`FORGEBADGER_COMPANION_ENABLED` setting. Disabling it:

- closes host Relay connectivity and blocks new pairing, queries, and commands;
- preserves device and command history for inspection;
- leaves local projects, Goals, Copilot runs, Session Server, CLI processes, and
  Web behavior unchanged;
- does not silently enable SSH execution targets or another remote transport.

Local owner revocation and state inspection remain available while disconnected.
Relay or push failure cannot block Gateway startup, local session recovery, or
existing notifications. Older local-only versions must be able to ignore additive
Companion metadata after a compatible rollback; destructive migration rollback is
not part of the feature.

## P0 Product Surface

The mobile app has five primary surfaces:

1. **Attention**: awaiting answers, approvals, blockers, ready-for-review items,
   and stale/offline state.
2. **Projects/Goals**: authorized summaries, tasks, journal and verification
   evidence, session state, and diff summaries.
3. **Decision detail**: full question or exact pending-action parameters, target
   project/resources, expiry, and explicit approve/reject or answer controls.
4. **Activity/receipts**: submitted, accepted, running, terminal, and unknown
   command outcomes with canonical result links.
5. **Devices/settings**: host connection, last sync, notification preference, and
   local security controls. Owner pairing/revocation/scope administration remains
   available in Web.

P0 supports Goal creation with no autonomous Goal grants, Goal answer/control,
exact approval decisions, and optional Copilot run stop. It does not include full
terminal I/O, Goal merge, CLI session stop, arbitrary prompts, model/provider
configuration, or shared projects.

## External Practice Baseline

Official implementations reviewed on 2026-11-01 reinforce the proposed boundaries:

- [VS Code Remote Tunnels](https://code.visualstudio.com/docs/remote/tunnels) and
  [Microsoft Dev Tunnels security](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/security)
  use outbound host/client connections, authenticated hosting and access,
  tunnel-scoped short-lived tokens, and an additional end-to-end encrypted SSH
  layer for remote development. Companion adopts outbound-only connectivity and
  scoped credentials, but uses per-device keys rather than an owner account or a
  general-purpose tunnel.
- [Tailscale connection types](https://tailscale.com/kb/1257/connection-types)
  keeps direct and relayed connections end-to-end encrypted. Its
  [ACL model](https://tailscale.com/kb/1018/acls) is deny-by-default and locally
  enforced, while [key expiry](https://tailscale.com/kb/1028/key-expiry) makes
  device reauthentication and revocation operational concerns. Companion likewise
  enforces grants at Gateway, not only at Relay, and leaves device expiry/revocation
  visible to the owner.
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
  binds a unique key to the original parameters, returns the saved result on exact
  retry, and rejects conflicting key reuse. Companion uses the same request
  identity/digest rule but adds explicit `unknown` recovery because development
  effects cannot always be reconciled or safely retried.

These references are design inputs, not claims that ForgeBadger implements or is
compatible with those products.

## Slice 1 Implementation Contract

The first runtime slice is the local security foundation only. It does not claim
remote connectivity or an app experience.

Included:

- `FORGEBADGER_COMPANION_ENABLED`, default `false`, passed through Gateway startup;
- strict versioned pairing and future command/receipt schemas;
- Ed25519 signing and X25519 encryption host keys, with private keys encrypted by
  the existing secret-box and never returned by HTTP;
- additive host, pairing, and device tables with tenant-scoped repositories;
- singleton host configuration restricted to an active instance admin because a
  Relay URL/key revision affects every tenant;
- owner pairing creation with explicit personal projects and capabilities,
  ten-minute one-time secrets, internal-only claim, SAS confirmation, cancellation,
  device scope update, and revocation;
- authenticated local management APIs with `Cache-Control: no-store`; no public
  pairing-claim route, Relay connector, remote query, or command execution;
- personal-project validation rejects projects enrolled in `team_projects` and
  foreign projects; host Relay changes revoke all device/pairing authority rather
  than silently retaining trust.

The pairing QR is returned once by pairing creation and is absent from list
responses. Pairing lists and device responses contain public metadata only.
Disabling the feature blocks new host enablement, pairing, and confirmation but
leaves inspection, cancellation, and revocation available.

## Slice 2 Implementation Contract

The second runtime slice adds the real Relay and read-only data path. It does not
claim a mobile UI, remote writes, push, or public deployment evidence.

Included:

- private `@forgebadger/relay` package with signed host/device registration,
  opaque pairing/query/event forwarding, presence, bounded frames, replay-resistant
  connection nonces, and no database or project authority;
- Gateway HostRuntime with outbound-only WebSocket connectivity, DNS/SSRF host
  validation, heartbeat, reconnect, and local-first shutdown/disablement;
- signed JSON payloads encrypted with X25519 + HKDF-SHA-256 + AES-256-GCM, with
  AAD context bound to host/device/message/pairing identities;
- migration `0145` pairing-device links and a durable bounded per-device outbox;
- host-signed device registration after owner confirmation and registration/outbox
  replay after Relay restart;
- `snapshot` and `sync` as the only remote queries, with current tenant/project/
  capability/revision checks and typed errors for every other method;
- scoped project/session/Goal/attention projections that exclude attach tokens,
  paths, terminal scrollback, Goal specifications, and notification bodies;
- per-device event cursors, sequence-gap reset, and `sync.reset` after scope change.

Verification uses a real Relay child process and a simulated device over real
WebSocket connections. It covers encrypted pairing, owner confirmation, device
registration, snapshots, event sync, revocation, presence, and Relay process
restart. This is loopback integration evidence, not the non-LAN, TLS-terminating
deployment, physical mobile, or push evidence still required by P0.

## Slice 3 Implementation Contract

The third slice adds the actual mobile read experience. The selected stack is Expo
SDK 58 and React Native with `react-native-quick-crypto`; its
[implementation coverage](https://github.com/margelo/react-native-quick-crypto/blob/main/.docs/implementation-coverage.md)
explicitly includes Ed25519, X25519, HKDF, and AES-GCM. Native modules require an
Expo dev client and prebuild, not Expo Go.

Included:

- a shared TypeScript device client with strict QR/payload validation, encrypted
  pairing claims, encrypted host-signed SAS notices, independent SAS derivation,
  query timeouts, reconnect backoff, event deduplication, and revocation stop;
- Expo camera/manual pairing UI, owner-confirmation screen, Attention inbox,
  Goal/project lists, and Goal detail projections with clear read-only semantics;
- `idle`, `pairing`, `awaiting_owner`, `online`, `offline`, `revoked`, and `error`
  states, with live/stale presentation based on both connectivity and evidence time;
- SecureStore-backed device identities/registrations and a separate AES key for a
  bounded 256 KiB encrypted file cache, following the
  [Expo SecureStore guidance](https://docs.expo.dev/versions/latest/sdk/securestore/)
  not to place large payloads in platform key-value storage;
- reconnect sync that uses the persisted cursor, applies `sync.reset`, and falls
  back to a canonical snapshot rather than treating a socket connection as proof
  of synchronization;
- local logout that closes the socket and removes identity, registration, cache,
  and cache key.

A real Relay/Gateway integration drives the shared client through pairing, scope
reset, cache restoration, reconnection, and revocation. Android Hermes bundle
export verifies Metro/native-module composition. Neither test substitutes for
physical iOS/Android secure storage, biometric behavior, background networking,
non-LAN connectivity, or native signed-app evidence. Push remains a later slice;
this slice does not claim generic push hints or approval detail beyond the current
snapshot projection.

## Slice 4 Implementation Contract

The fourth slice adds typed remote writes and durable command receipts. It does
not expose arbitrary prompts, Shell, terminal input, or generic HTTP forwarding.

Included:

- migration `0146` with per-device command identity, encrypted payloads, parameter
  digests, authority revisions, status/effect separation, and result references;
- `goal.create`, `goal.answer`, `goal.pause`, `goal.resume`, `goal.cancel`,
  `approval.decide`, and `run.stop`, mapped to existing owner/Copilot execution
  boundaries and explicit device capabilities/projects;
- empty autonomous grant sets for mobile-created Goals, exact pending-action input
  digests, and no mobile merge/deploy/session-shell operation;
- admission and pre-effect authority checks, same-ID/same-payload receipt returns,
  conflicting-ID rejection, short command expiry, and no offline queue;
- accepted/running/succeeded/rejected/failed/unknown receipts with
  `none/confirmed/unknown` effect status and stable error codes;
- startup reconciliation that can confirm a canonical effect but never replays an
  uncertain write;
- command/approval projections in snapshots, Goal answer/lifecycle controls,
  exact approval detail, and device authentication before approval via Expo Local
  Authentication.

Integration covers duplicate Goal answers, command-ID conflicts, scoped lifecycle
and run cancellation, exact approval, recovery without replay, and the real Expo
client executing Goal answers and approvals through Relay. Physical-device
biometric behavior and crash-at-every-native-effect timing still require the P0
hardening evidence; loopback/service recovery tests do not clear those gates.

## Delivery Slices

Implementation should proceed in independently verifiable slices:

1. **Contracts and host foundation**: protocol schemas, key storage, feature
   disablement, tenant-scoped repositories, and local pairing/device management.
2. **Relay and read-only path**: host/device authenticated connections, pairing,
   query projections, outbox sync, presence, and real non-LAN connectivity.
3. **Companion read experience**: attention, project/Goal/approval details,
   reconnect/reset behavior, encrypted cache, and generic push hints.
4. **Typed commands**: Goal create/answer/control, exact approvals, run stop,
   durable receipts, idempotency, revocation fences, and crash recovery.
5. **Hardening and release evidence**: real iOS/Android secure storage and push,
   hostile Relay tests, multi-tenant isolation, network interruption, restart,
   retention, rate/size limits, and rollback.

The app framework, Relay hosting provider, and APNs/FCM operational accounts are
implementation decisions after this architecture review. They do not change the
trust or authority boundaries above.

## Acceptance Criteria

P0 is not complete until all of the following are demonstrated on the delivered
path:

1. A new device pairs over a non-LAN connection in under two minutes without an
   owner password or long-lived owner token in the QR/app configuration.
2. Observer, Operator, and Approver scopes cannot read or act outside their
   explicit personal projects and capabilities; cross-tenant IDs return not
   found/rejected without disclosure.
3. A Goal question produces a generic push hint and an authenticated mobile
   detail view; answering resumes the same Goal and yields a canonical receipt.
4. An approval is decidable only with complete exact parameters, matching digest,
   current authority, and valid pending state. Truncated/stale/changed requests
   cannot be approved.
5. Duplicate delivery, repeated taps, process restart, and exact client retry do
   not duplicate effects. Conflicting command-ID reuse is rejected.
6. A crash at every command stage produces either a reconciled canonical result or
   `unknown`; no uncertain write is automatically replayed.
7. Device revocation blocks subsequent reads, admission, pending effects, and
   delivery even if Relay still accepts the device connection.
8. Host sleep/offline state becomes visibly offline or stale within 60 seconds;
   no offline command is represented as accepted or executed.
9. Reconnect replays ordered missed events or forces a full snapshot reset;
   sequence gaps and reduced project scope cannot leave phantom state.
10. Relay, APNs/FCM payloads, logs, and diagnostics contain no private keys,
    provider credentials, long-lived owner tokens, raw Goal content, code, command
    parameters, or terminal scrollback.
11. Disabling or losing Relay leaves local Web, Gateway recovery, Goals, Session
    Server, and running CLIs unaffected.
12. Real cellular/Wi-Fi switching, app restart, Gateway restart, and at least one
    physical iOS and Android device are verified. Emulators and loopback tests do
    not substitute for this evidence.

## Assumptions And Deferred Decisions

- P0 is owner-focused and personal-project-only, but all persistence and resource
  checks remain multi-tenant-safe.
- A hosted or self-hosted Relay uses the same protocol; Relay trust is minimized
  rather than assumed.
- P0 favors reliable typed interventions over full desktop feature parity.
- App framework and package location are deliberately not selected in this
  document. Existing project dependencies do not establish a mobile stack.
- Relay deployment, push credentials, abuse controls, and operational cost need a
  separate implementation/runbook package before public availability.
- Full diff, merge, terminal, multi-host UX, team workflows, and remote cache wipe
  require later designs and reviews.
