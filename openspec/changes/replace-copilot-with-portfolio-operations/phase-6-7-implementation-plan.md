# Phase 6/7 Implementation Plan — Portfolio Coexistence and Single Feishu Transport

> Gate 1 amendment. This is an implementation contract, not implementation or verification evidence: Tasks 6.1–6.7 and 7.1–7.5 remain unchecked. Fresh runtime tests, browser E2E, Feishu connection tests, and smoke runs are deferred to one later integrated verification gate and are not passed by this document.

## 1. Phase 6: isolated Portfolio workspace, no early Cutover

Phase 6 owns the authenticated `/portfolio` workspace, `/api/v1/portfolio/**` routes, `portfolio.*` safe Event Bus/WebSocket projections, and Portfolio-only Web clients. `/portfolio` is the complete primary workspace; `/copilot` is a bookmark-compatible Portfolio-only alias. The pet opens a Portfolio-only floating companion Dialog.

The retained alias and Dialog MUST NOT restore or depend on a Copilot API route, runtime/provider loop, record reader, Feishu handler, compatibility adapter, fallback reader, or dual write. Portfolio code cannot import legacy Copilot services/repositories or read/write legacy Copilot records. Dialog text is untrusted requirement text: submission creates a Portfolio Request, and timely acknowledgement/progress comes only from its persisted, safe Request status, never a legacy model-chat reply. All retained-surface labels and messages use Portfolio i18n. Gateway legacy logic remains removed; historical Copilot tables/migrations/data remain physically retained but unavailable at runtime pending the separately authorized backup/export and disposable restore procedure. Focused browser/runtime verification remains deferred to the later integrated gate and is not a passing result.

The Project Manager workflow view may consume only Portfolio records through Portfolio APIs. It must retain the existing tenant, envelope, idempotency, redaction, and projection-version contracts. Event payloads remain IDs, safe state, bounded summaries, timestamps, versions, and correlation IDs; no raw provider content, terminal content, credentials, or signed action material is projected.

### 1.1 Pet-triggered companion Dialog boundary

The Dialog is a Portfolio Request entrypoint and safe status projection, not a
conversational model surface. It uses the same authenticated, tenant-scoped,
idempotent Portfolio request path as the primary workspace. A successful
submission may acknowledge only the durable Request
identifier and its safe persisted lifecycle status; it must not invent a model
response, execution result, or workflow transition. Status updates must stay
inside the request's tenant and use redacted Portfolio projections. They must
not disclose request text, credentials, raw provider or terminal content,
signed action material, or another tenant's records.

The Dialog and `/copilot` alias use Portfolio i18n keys for labels, errors, and
status copy. They cannot provide `PortfolioExecutionRuntime`, worker
capabilities, dispatch ports, `sendInput`, tmux, node-pty, or terminal writers.

### 1.2 Restricted dependency ownership

`ServerDeps`, Portfolio routes, WebSocket projection publishers, and Web clients receive only a narrow Portfolio API/read/event facade. The facade owns authenticated request validation, safe DTO reads, public State Gate request operations, and redacted event publish/subscribe operations. It does not expose `PortfolioExecutionRuntime`, worker ACK/capability data, worker dispatch ports, `SessionManager` terminal writers, `sendInput`, tmux, node-pty, or any equivalent terminal-write authority. Execution runtime construction and worker capability ownership stay in the internal Gateway execution composition root. No route or WebSocket dependency graph may obtain them through a broad service container.

## 2. Phase 7: one Feishu transport selector, verified account ownership, and exactly-one binding

Phase 7 owns one append-only forward migration that adds a verified provider-account registry and Portfolio Channel Bindings. The registry records provider, immutable provider account identifier/app identity, owner tenant, lifecycle state, and safe audit metadata. It enforces global `UNIQUE (provider, provider_account_id)`. An active Portfolio binding references that verified account, has the same owner tenant, and is unique by `(provider_account_id, external_identity, conversation_id)`. These are database/repository invariants; route validation alone is insufficient. The migration appends to the live migration journal and never rewrites applied Portfolio or legacy migrations.

The existing Gateway-owned Feishu transport registry/selector is the sole provider-account connection and ingress callback owner for both WebSocket/long-connection and webhook ingress. Phase 7 extends this single selector rather than starting another Feishu app/long-connection client or registering a competing callback.

For each verified provider event, the multiplexer MUST:

1. Validate and normalize the provider event, including stable provider event identity before business parsing.
2. Resolve exactly one verified provider-account registry row for the account/app identity.
3. Select exactly one handler for that account and event: legacy or Portfolio, never both.
4. For Portfolio, resolve the verified sender identity and conversation to exactly one active tenant-scoped binding that belongs to the verified account owner and permits that conversation.
5. Fail closed, with only a safe audit result, if an account/binding/handler is missing, ambiguous, disabled, malformed, colliding, or cross-tenant.
6. Pass only the normalized, verified, bound event to the selected Portfolio handler, which performs Portfolio-specific request capture, signed action resolution, or Outbox projection.

Portfolio owns the handler's domain semantics but not a separate transport. A single provider event cannot be processed by both a Legacy Copilot handler and the Portfolio handler as a Portfolio event, whether it arrives through WebSocket/long-connection or webhook ingress. A canonical Portfolio event/action version and target binding can create at most one durable delivery intent and one external delivery effect under the existing Outbox claim/deduplication contract. Retried delivery does not re-run a workflow mutation or enter another handler.

## 3. Shared foundations and cutover boundary

The transport lifecycle, SDK connection, event normalization, redaction, delivery claim mechanics, and authenticated Gateway boundary can remain shared foundations only when their invariants support the contracts above. Binding resolution and Portfolio request/action/delivery semantics stay Portfolio-owned. No shared component may translate a legacy Copilot conversation, pending action, or run into Portfolio authority.

The shared transport must keep event selection and delivery ownership unambiguous; it must not restore a Legacy Copilot handler. Task 8.4 remains responsible for the Gateway/runtime removal inventory and the retained-Portfolio-presentation audit, and must still pass the Clean Cutover backup/restore, scan, and integrated acceptance requirements.

## 4. Deferred integrated verification

Do not record Phase 6 or Phase 7 runtime verification as passed during this implementation window. The later integrated gate must run and record the actual commands, results, and environment caveats for the combined request-to-acceptance path, including:

- authenticated Portfolio API, Event Bus/WebSocket, and browser workflow behavior;
- Feishu signature, provider-event idempotency, global provider-account collision/owner checks, unique active binding resolution, free-text rejection, signed-action replay/expiry, and Outbox retry/deduplication behavior;
- absence of a second Feishu connection/callback, handler race, or dual delivery with Legacy Copilot for both WebSocket/long-connection and webhook ingress; and
- restricted-facade proof that routes/WebSocket/Web dependencies cannot access execution runtime, worker capabilities, or terminal writers;
- tenant isolation, authorization bypass, redaction, reconnect/order, and no channel-to-terminal-input negative cases; and
- the existing Task 8.2 real Claude/tmux boundary and Task 8.4 Cutover checks when those tasks are separately authorized.

The integrated gate is the earliest point at which fresh runtime/smoke evidence may be marked passed. Until then, implementation may be reviewed structurally, but all Phase 6/7 task boxes and runtime acceptance remain pending.
