# External Evidence Gates

> Status: v1.5 evidence registry with Feishu long-connection gate | Date: 2026-06-13

This registry is the source of truth for external ForgeBadger release gates.
Repository tests, mocked browser checks, documentation, templates, and empty
issue forms are useful support artifacts, but they do not clear an external
gate by themselves.

Run `pnpm evidence:gates-validate` before changing this registry. The validator
keeps current Caveat/Blocked states in place until a required external artifact
is linked and reviewed.

## Purpose And Scope

ForgeBadger is a local-first AI CLI control plane. The current external gates
focus on release trust: live provider behavior, real Windows/WSL terminal
behavior, Feishu bot long-connection behavior, and completed first-user
feedback.

This registry does not add hosted collaboration, cloud workers, autonomous
remote execution, Feishu execution authority, or raw evidence storage. It
defines what evidence is required before a gate can move to `Pass`.

## Gate States

Use only these states:

- `Pass`: the required artifact exists, is redacted, and matches the clearing
  condition for the gate.
- `Caveat`: a collection path exists, but the artifact is missing, partial, or
  not representative enough to clear the gate.
- `Blocked`: collection cannot proceed without an external dependency such as a
  disposable credential, explicit model id, physical Windows/WSL host, Feishu
  developer-console access, or real user feedback packet.

Do not infer `Pass` from mocked tests, documentation links, checklist presence,
empty templates, local-only substitutes, or successful preflight commands that
do not exercise the external boundary.

## Gate Registry

| Gate | Current State | Owner | Clearing Condition | Rerun Path | Target Destination |
|------|---------------|-------|--------------------|------------|--------------------|
| `LIVE-PROVIDER` | `Caveat` | Release maintainer with disposable provider credential | `pnpm smoke:copilot-provider` runs with an explicit provider, explicit model id, and disposable credential; result is redacted and maps failure classes if not passing. | Run `pnpm smoke:copilot-provider` after configuring an explicit provider/model/credential outside the repository. | `docs/reports/phase-18-live-provider-evidence-rerun-2026-05-29.md`; historical baseline in `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md`; follow-up issue #3. |
| `WINDOWS-WSL` | `Caveat` | Release maintainer with physical Windows host and WSL | A real WSL run records dependency checks, browser terminal attach/input/resize, reconnect, Gateway restart recovery, and cleanup. Native Windows management UI checks do not clear terminal evidence. | Run the Windows/WSL section in `docs/TRIAL-CHECKLIST.md` on physical hardware. | `docs/reports/v1.4-external-evidence-closeout-2026-05-29.md`; historical baseline in `docs/reports/phase-6-terminal-gate-evidence-2026-05-21.md`; follow-up issue #4. |
| `FEISHU-BOT-WS` | `Caveat` | ForgeBadger operator with Feishu bot long-connection access | A real Feishu bot WebSocket or persistent connection run receives an `im.message.receive_v1` event from an allowed DM or group, routes it through ForgeBadger policy, sends a bounded reply or creates a pending action, reconnects after interruption, and preserves no-free-form-approval and no-terminal-input boundaries. Candidate reports pass automated redaction/audit checks, but the reports explicitly require maintainer review before this gate can move to `Pass`. | Configure a Feishu self-built bot for persistent connection event subscription, subscribe to `im.message.receive_v1`, run `pnpm smoke:feishu-bot-websocket` against the authenticated Gateway fixture path, then run `pnpm smoke:feishu-bot-live -- --require-gate-evidence --output <report.json>`, run `pnpm evidence:feishu-bot-live-audit -- <report.json>`, and run `pnpm evidence:feishu-bot-live-report -- --report <report.json> --output <report.md>` before maintainer review. Public webhook URL verification is optional compatibility evidence, not the primary gate. | Candidate artifacts pending explicit maintainer acceptance: `docs/reports/phase-41-feishu-bot-live-evidence-2026-06-14.json`; `docs/reports/phase-41-feishu-bot-live-evidence-2026-06-14.md`; historical public webhook blocker baseline in `docs/reports/phase-19-feishu-public-callback-evidence-2026-05-29.md`; historical local callback baseline in `docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md`. |
| `FIRST-USER-FEEDBACK` | `Caveat` | Maintainer/operator collecting a real trial packet | At least one completed redacted first-user feedback packet is attached or linked with severity, owner, disposition, affected surface, environment, reproduction detail, and follow-up route or no-action rationale. | Use `docs/TRIAL-FEEDBACK.md` or `.github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml`; run `pnpm trial:feedback-audit -- <packet.md>` for Markdown packets, `pnpm trial:feedback-issue-audit -- --issue=<number>` for a specific GitHub issue-form feedback item, or `pnpm trial:feedback-issues-audit` to scan non-tracker GitHub feedback candidates before maintainer triage. | `docs/reports/v1.4-external-evidence-closeout-2026-05-29.md`; follow-up issue #5 or a completed trial feedback issue. |

## Required Artifact Shapes

### `LIVE-PROVIDER`

Allowed:

- command: `pnpm smoke:copilot-provider`;
- provider name and explicit model id;
- smoke status: `passed`, `skipped`, or `failed`;
- ForgeBadger readiness code or provider failure class;
- timestamp, commit, and environment summary;
- redacted artifact path or issue link.

Forbidden:

- plaintext provider keys;
- Authorization headers;
- raw provider request bodies;
- raw provider response bodies;
- full model outputs;
- browser auth token values;
- JWTs or attach tokens.

### `WINDOWS-WSL`

Allowed:

- Windows version and WSL distribution/version;
- `forgebadger doctor`, `node --version`, `tmux -V`, and AI CLI version summaries;
- browser terminal attach/input/resize/reconnect result;
- Gateway restart recovery result;
- cleanup result;
- redacted screenshot or written observation.

Forbidden:

- raw terminal transcripts;
- shell history;
- secrets printed by local commands;
- private project paths beyond bounded, non-sensitive summaries;
- local databases or config files.

### `FEISHU-BOT-WS`

Allowed:

- Feishu app mode and domain summary, not secret values;
- long-connection/WebSocket startup timestamp and sanitized Gateway status;
- event subscription mode and subscribed event names, especially
  `im.message.receive_v1`;
- bounded DM or group receive evidence with chat/user identifiers redacted or
  shortened;
- bounded reply or pending-action result;
- reconnect or restart observation;
- evidence that allowlist/user mapping, redaction, no-free-form-approval,
  no-terminal-input, and Project Manager mutation boundaries were applied.

Forbidden:

- Feishu app secrets;
- verification token values;
- encrypt keys;
- raw event bodies;
- signatures, nonces, or private chat content;
- raw WebSocket frames;
- raw callback request or response bodies.

### Optional `FEISHU-CALLBACK`

Public Feishu webhook callback support remains available as a compatibility
path for deployments that deliberately expose Gateway over HTTPS. It is no
longer the primary first-user gate because the preferred local-first bot path
uses Feishu/Lark persistent connection mode and does not require public inbound
network exposure. Any future public webhook claim must still preserve signature,
replay, allowlist, redaction, encrypted-payload fail-closed, and no-free-form
approval boundaries.

### `FIRST-USER-FEEDBACK`

Allowed:

- affected surface;
- severity;
- owner;
- disposition;
- environment summary;
- reproduction steps;
- redacted diagnostics or a reason diagnostics are unavailable;
- follow-up issue, phase, or explicit no-action rationale.

Forbidden:

- API keys, JWTs, attach tokens, passwords, private keys, browser auth tokens;
- raw terminal output;
- provider payloads;
- Feishu message bodies;
- local `.env` files, SQLite databases, or private AI CLI config.

## Redaction Rules

All gate artifacts must be reviewed before sharing. Keep only summaries,
counts, bounded statuses, public metadata, command names, ForgeBadger request
paths, sanitized error codes, timestamps, and redacted screenshots.

Do not publish raw provider payloads, Feishu bodies, terminal transcripts,
tokens, credentials, private local paths, databases, or private project data.

## Closeout Rule

A phase or milestone closeout may move an external gate to `Pass` only when it
links the required artifact and states why the artifact satisfies the clearing
condition. If the artifact is missing, partial, mocked, local-only, or merely a
template/checklist, keep the gate as `Caveat` or `Blocked` with owner and next
action.
