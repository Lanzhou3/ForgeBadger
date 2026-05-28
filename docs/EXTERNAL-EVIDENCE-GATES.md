# External Evidence Gates

> Status: v1.5 evidence registry with drift guard | Date: 2026-05-29

This registry is the source of truth for external OpenForge release gates.
Repository tests, mocked browser checks, documentation, templates, and empty
issue forms are useful support artifacts, but they do not clear an external
gate by themselves.

Run `pnpm evidence:gates-validate` before changing this registry. The validator
keeps current Caveat/Blocked states in place until a required external artifact
is linked and reviewed.

## Purpose And Scope

OpenForge is a local-first AI CLI control plane. v1.4 focuses on release trust:
live provider behavior, real Windows/WSL terminal behavior, Feishu public
callback behavior, and completed first-user feedback.

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
  disposable credential, explicit model id, physical Windows/WSL host, public
  HTTPS route, Feishu developer-console access, or real user feedback packet.

Do not infer `Pass` from mocked tests, documentation links, checklist presence,
empty templates, local-only substitutes, or successful preflight commands that
do not exercise the external boundary.

## Gate Registry

| Gate | Current State | Owner | Clearing Condition | Rerun Path | Target Destination |
|------|---------------|-------|--------------------|------------|--------------------|
| `LIVE-PROVIDER` | `Caveat` | Release maintainer with disposable provider credential | `pnpm smoke:copilot-provider` runs with an explicit provider, explicit model id, and disposable credential; result is redacted and maps failure classes if not passing. | Run `pnpm smoke:copilot-provider` after configuring an explicit provider/model/credential outside the repository. | `docs/reports/phase-18-live-provider-evidence-rerun-2026-05-29.md`; historical baseline in `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md`; follow-up issue #3. |
| `WINDOWS-WSL` | `Caveat` | Release maintainer with physical Windows host and WSL | A real WSL run records dependency checks, browser terminal attach/input/resize, reconnect, Gateway restart recovery, and cleanup. Native Windows management UI checks do not clear terminal evidence. | Run the Windows/WSL section in `docs/TRIAL-CHECKLIST.md` on physical hardware. | `docs/reports/v1.4-external-evidence-closeout-2026-05-29.md`; historical baseline in `docs/reports/phase-6-terminal-gate-evidence-2026-05-21.md`; follow-up issue #4. |
| `FEISHU-CALLBACK` | `Blocked` | OpenForge operator with public HTTPS Gateway route and Feishu console access | Feishu developer-console URL verification reaches `/api/v1/integrations/feishu/webhook/:publicId`; evidence confirms public routing and preserves signature, replay, allowlist, redaction, and no-free-form-approval boundaries. | Provision public HTTPS routing, configure public webhook, and run Feishu console URL verification. | `docs/reports/phase-19-feishu-public-callback-evidence-2026-05-29.md`; historical baseline in `docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md`. |
| `FIRST-USER-FEEDBACK` | `Caveat` | Maintainer/operator collecting a real trial packet | At least one completed redacted first-user feedback packet is attached or linked with severity, owner, disposition, affected surface, environment, reproduction detail, and follow-up route or no-action rationale. | Use `docs/TRIAL-FEEDBACK.md` or `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`; run `pnpm trial:feedback-audit -- <packet.md>` for Markdown packets or `pnpm trial:feedback-issue-audit -- --issue=<number>` for GitHub issue-form feedback before maintainer triage. | `docs/reports/v1.4-external-evidence-closeout-2026-05-29.md`; follow-up issue #5 or a completed trial feedback issue. |

## Required Artifact Shapes

### `LIVE-PROVIDER`

Allowed:

- command: `pnpm smoke:copilot-provider`;
- provider name and explicit model id;
- smoke status: `passed`, `skipped`, or `failed`;
- OpenForge readiness code or provider failure class;
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
- `openforge doctor`, `node --version`, `tmux -V`, and AI CLI version summaries;
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

### `FEISHU-CALLBACK`

Allowed:

- public HTTPS route shape, not secret values;
- callback attempt timestamp and sanitized Gateway status;
- URL verification result;
- evidence that signature/raw-body, replay/rate, tenant allowlist, user mapping,
  and redaction boundaries were applied;
- evidence that free-form text cannot approve pending actions, send terminal
  input, or mutate Project Manager state.

Forbidden:

- Feishu app secrets;
- verification token values;
- encrypt keys;
- raw event bodies;
- signatures, nonces, or private chat content;
- raw callback request or response bodies.

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
counts, bounded statuses, public metadata, command names, OpenForge request
paths, sanitized error codes, timestamps, and redacted screenshots.

Do not publish raw provider payloads, Feishu bodies, terminal transcripts,
tokens, credentials, private local paths, databases, or private project data.

## Closeout Rule

A phase or milestone closeout may move an external gate to `Pass` only when it
links the required artifact and states why the artifact satisfies the clearing
condition. If the artifact is missing, partial, mocked, local-only, or merely a
template/checklist, keep the gate as `Caveat` or `Blocked` with owner and next
action.
