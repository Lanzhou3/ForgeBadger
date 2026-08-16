## ADDED Requirements

### Requirement: Feishu ingress is authenticated, bound, and idempotent
The Feishu Channel Connector MUST validate the provider signature and event identity before parsing a message or action. A forward migration MUST create a verified provider-account registry that records provider, immutable provider account identifier/app identity, owner tenant, lifecycle state, and audit-safe metadata, and enforces global `UNIQUE (provider, provider_account_id)` ownership. It MUST also create/revise only Portfolio-owned channel bindings so each active `(provider_account_id, external_identity, conversation_id)` tuple is unique and owned by the registry account's tenant. One Gateway-owned Feishu transport registry/selector MUST own both the configured account's WebSocket/long-connection lifecycle and webhook ingress callback path. It MUST verify exactly one provider-account registry row, select exactly one eligible handler (legacy or Portfolio), and, for Portfolio, map the verified external identity and conversation to exactly one active tenant-scoped Channel Binding and allowed-conversation record. Only a bound identity in an allowed conversation may create a Portfolio Request or resolve a stored Channel Action. Inbound provider events MUST be idempotent by verified provider event identity. A missing, ambiguous, disabled, colliding, or cross-tenant account/binding/handler result MUST fail closed; Portfolio MUST NOT create a second Feishu application connection, competing callback, parallel binding handler, or dual delivery path.

#### Scenario: Bound Feishu requirement message
- **WHEN** a valid Feishu message arrives from a bound identity in an allowed conversation
- **THEN** the connector creates or idempotently resolves a Portfolio Request with source metadata
- **THEN** the message content is treated only as requirement text

#### Scenario: Unbound sender or conversation
- **WHEN** a Feishu event has a valid provider signature but its sender or conversation is not bound and allowed
- **THEN** the connector does not create a Portfolio Request, authorization, or workflow mutation
- **THEN** it records a safe denied-ingress audit result without disclosing tenant data

#### Scenario: Ambiguous binding or competing handler is attempted
- **WHEN** a verified provider event resolves to zero or more than one verified provider account, eligible tenant binding, or eligible handler, or a second Portfolio Feishu transport/handler attempts to receive the same account event through WebSocket or webhook ingress
- **THEN** the shared transport fails closed before a Portfolio workflow mutation or delivery is created
- **THEN** exactly no Portfolio handler and no Legacy Copilot handler process that event as a Portfolio event
- **THEN** the Gateway records only a safe binding/transport rejection outcome

### Requirement: Provider accounts and active bindings have one auditable owner
The verified provider-account registry MUST bind a real provider account/app identity to one tenant globally by `UNIQUE (provider, provider_account_id)`. A Portfolio Channel Binding MUST reference that registry account and MUST be rejected unless its `user_id` is the registry account owner. Among active bindings, `(provider_account_id, external_identity, conversation_id)` MUST be unique. The owner/uniqueness checks are persistence constraints and repository checks, not only route validation. The new schema is an append-only forward migration and MUST NOT rewrite applied migration history.

#### Scenario: A second tenant claims an existing Feishu account
- **WHEN** another tenant tries to register the same verified `(provider, provider_account_id)`
- **THEN** the registry rejects the claim without changing the original owner or bindings
- **THEN** no account connection, ingress handler, or delivery target is created for the second tenant

#### Scenario: Binding tenant differs from account owner
- **WHEN** a caller creates or resolves a Portfolio binding whose tenant differs from the verified provider-account owner
- **THEN** persistence and the repository reject the operation without disclosing the account owner
- **THEN** the transport does not select a Portfolio handler for that candidate binding

### Requirement: Free-form channel text cannot control execution or approval
The system MUST NOT interpret Feishu free text as a terminal command, session identifier, authorization decision, action payload replacement, policy grant, or lifecycle transition. A free-form message MAY create a Portfolio Request only through the normal Intake Decision flow.

#### Scenario: Message asks to run a command
- **WHEN** a bound user sends a message containing a shell command or terminal instruction
- **THEN** the system records it as untrusted request text inside a Portfolio Request
- **THEN** no terminal input, Platform Tool call, or approval decision is issued directly from the message

#### Scenario: Message says approve
- **WHEN** a bound user sends free text such as "approve" for an outstanding action
- **THEN** the system does not consume or approve the action
- **THEN** it directs the user to the canonical Web record or signed action card

### Requirement: Channel Actions are opaque, signed, single-use references
The system MUST create a Channel Action only for an existing canonical Authorization, Intake Decision, Acceptance Decision, or other explicitly supported owner decision. The card payload MUST contain an opaque reference and a signed, expiring, single-use binding; it MUST NOT carry a fresh executable payload. On receipt, the Gateway MUST load the stored record and verify signature, identity, conversation, tenant, expiry, allowed action type, and unused state before atomically consuming the action.

#### Scenario: Owner confirms an authorization card
- **WHEN** the bound owner activates a valid, unused authorization card before expiry
- **THEN** the Gateway records the owner decision against the existing canonical ActionIntent
- **THEN** it queues the appropriate workflow command without accepting new session, command, or payload fields from the card

#### Scenario: Card replay or expiry
- **WHEN** a Channel Action is replayed, altered, used by another binding, used in another conversation, or received after expiry
- **THEN** the Gateway rejects it without changing Authorization or workflow state
- **THEN** it records a replay/validation audit outcome and does not issue terminal input

### Requirement: Feishu delivery uses a durable Outbox projection
The system MUST persist a delivery intent in a durable Outbox after a canonical Portfolio fact is committed. Each delivery MUST be deduplicated by canonical event/action version and target binding, use bounded retries, and record provider results separately from business state. A delivery retry MUST NOT rerun intake, authorization, dispatch, acceptance, or observation. The shared transport and handler selection MUST ensure that a legacy Copilot path cannot deliver the same canonical Portfolio event.

#### Scenario: Temporary Feishu delivery error
- **WHEN** Feishu delivery fails transiently after the canonical fact commits
- **THEN** the Outbox schedules only the delivery retry with bounded backoff
- **THEN** it does not recreate the Portfolio Request or rerun the underlying workflow command

#### Scenario: Web and Feishu receive the same update
- **WHEN** a Work Item progress fact is eligible for both Web event projection and Feishu notification
- **THEN** each surface receives a safe projection of the one canonical fact
- **THEN** a failure on one surface does not alter the fact or duplicate the other surface's delivery

### Requirement: Channel projections are safe and least-privilege
The Feishu connector MUST project only tenant-authorized, redacted, bounded Portfolio summaries. It MUST exclude secrets, credentials, raw terminal transcript, provider response bodies, full Task Packet text when sensitive, signed action material, and cross-project data. Channel Binding administration MUST require authenticated owner authority.

#### Scenario: Progress update includes terminal-sensitive output
- **WHEN** a CLI observation contains material classified for redaction or exceeds the channel summary limit
- **THEN** the connector sends a redacted bounded summary or a Web-record link reference
- **THEN** it does not send the raw observation to Feishu

#### Scenario: Non-owner manages bindings
- **WHEN** a non-owner attempts to create, alter, or remove a Channel Binding
- **THEN** the Gateway rejects the mutation according to tenant authorization rules
- **THEN** existing bindings and delivery targets remain unchanged
