# Security Policy

ForgeBadger manages local project files, terminal sessions, provider credentials,
tmux processes, WebSocket terminal access, and SQLite state. Treat all reports
as sensitive until proven otherwise.

## Supported Scope

Current security support covers the local-first ForgeBadger repository:

- `packages/gateway`
- `packages/web`
- `packages/cli`
- database migrations and local runtime configuration
- documented first-user trial and support workflows

Hosted multi-tenant operation, cloud worker pools, billing, hosted marketplace
features, autonomous remote execution, and production Feishu encrypted payload
handling are not supported scope unless a future architecture document says
otherwise.

## Report Privately

Do not open a public issue if the report includes or enables:

- credential disclosure or decrypted API key exposure;
- JWT/session/attach-token bypass;
- tenant isolation bypass;
- project path traversal or symlink escape;
- terminal WebSocket authorization bypass;
- Copilot or Feishu write execution without pending-action approval;
- plaintext secrets in diagnostics, logs, generated config, SQLite, or issue
  attachments;
- executable reproduction steps against a real user's machine or credential.

Send private security details to the project maintainer through the repository
owner's preferred private channel. If no private channel is available, open a
minimal public issue that says a private security report is needed, without
exploit details, secrets, logs, or reproduction payloads.

## What Not To Share Publicly

Never paste:

- API keys, JWTs, passwords, private keys, browser auth tokens, attach tokens;
- `.env` files, SQLite databases, local logs with secrets, or AI CLI config;
- provider request/response bodies or Authorization headers;
- raw terminal transcripts, shell histories, or command output that may include
  secrets;
- Feishu app secrets, event bodies, signatures, verification tokens, encrypt
  keys, or message bodies.

Use redacted diagnostics from `docs/SUPPORT-DIAGNOSTICS.md` and bounded
evidence fields instead.

## Security Model

This document describes the security model. Key invariants:

- Gateway and Web stay separate.
- Gateway owns filesystem, credential, WebSocket, and terminal-process
  boundaries.
- API keys are encrypted at rest and decrypted only in Gateway memory.
- Terminal sessions persist through tmux; terminal scrollback is not stored in
  SQLite.
- User-controlled paths must stay under approved project roots.
- Copilot, Feishu, and model output cannot mutate project-manager state or send
  terminal input without explicit approval.

## Caveats

ForgeBadger remains a local-first beta-oriented control plane. The repository's
open-source packet does not clear the current live-provider, physical
Windows/WSL, Feishu developer-console callback, or completed first-user
feedback caveats. Those require real redacted evidence before status can move
to `Pass`.
