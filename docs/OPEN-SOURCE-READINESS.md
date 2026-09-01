# Open Source Readiness

> Status: v1.4 external evidence closeout | Date: 2026-05-29

ForgeBadger is published as a local-first AI CLI control plane. The open-source
packet is meant to make local trial, contribution, support, and security
boundaries clear before broader community use.

ForgeBadger should be introduced as an operations cockpit for existing AI CLIs,
not as a replacement for Cursor, Claude Code, Codex, OpenCode, or hosted coding
agents. Its open-source value is the control layer around local
terminal-multiplexer sessions (tmux on macOS/Linux/WSL, psmux ≥ 3.3.8 on
native Windows):
first-value activation guidance, runtime readiness, recoverable sessions,
Project Manager task packets, bounded handoff exports, Feishu long-connection
collaboration, and starter packs for repeatable work.

## License Rationale

ForgeBadger uses the MIT License because it is a developer tool intended for
broad local use, adapter experimentation, forks, and self-hosted workflows. MIT
keeps the project easy to inspect, modify, package, and embed while keeping the
repository's current local-first beta status explicit.

The license does not create a hosted service commitment, warranty, support SLA,
or permission to publish secrets. Users and contributors remain responsible for
protecting API keys, JWTs, browser tokens, provider payloads, Feishu secrets,
terminal content, local project paths, SQLite databases, and AI CLI config.

## Product Boundary

ForgeBadger is not a hosted collaboration platform, billing system, cloud worker,
or autonomous remote execution service. Current scope is:

- local Gateway and Web console;
- Dashboard first-value activation path for runtime, CLI adapter, model,
  project, template, and first-session setup;
- multiplexer-backed AI CLI sessions;
- project and session recovery;
- provider/model readiness;
- approval-gated native Copilot and Project Manager traceability;
- built-in starter packs that create Project Manager task packets for review,
  bugfix, docs sync, test generation, release notes, and first-user evidence;
- local-first trial feedback and diagnostics.

Remote execution, hosted collaboration, multi-tenant cloud operation, and
unattended autonomous coding loops require separate architecture and security
review before they can become supported scope.

## Portable Install Boundary

The default pnpm workspace contains only the Gateway, Web console, and published
CLI. The retired DeepSeek Harness bridge package and temporary `link:`
dependencies are removed. A normal clone has no Harness checkout prerequisite
for install, recursive typecheck, test, build, or runtime operation.

The npm artifact bundles the compiled Gateway and a Next standalone Web runtime.
Release verification rejects missing Gateway runtime dependencies, symlinks,
and Web binaries compiled for the maintainer's platform. Native npm dependencies
that are declared normally, including `better-sqlite3` and `node-pty`, remain
installed for the target platform by the user's package manager.

System terminal runtimes are not installed by npm postinstall. `forgebadger
doctor` is read-only and leaves an uninitialized state path untouched.
`forgebadger start`/`init` may execute only a fixed, confirmation-gated install
command in an interactive non-CI TTY; if the runtime remains unready they exit
non-zero before creating runtime/project state or starting services. Direct
Gateway startup applies the same readiness gate before account-recovery state,
database initialization/session recovery, or HTTP/WebSocket listen.

## Required Caveats

The open-source packet does not clear external evidence caveats. v1.4 added a
canonical registry and closeout report, but the external gates below still stay
visible until real evidence is attached. The canonical gate registry is
`docs/EXTERNAL-EVIDENCE-GATES.md`; if this table and the registry differ, use
the registry for state, artifact shape, owner, and closeout rules.

| Caveat | Current State | Rerun Path |
|--------|---------------|------------|
| Live provider pass | Caveat until a disposable live provider credential and explicit model id are used. | Run the provider smoke/readiness flow with redacted output and record only bounded status/code/model metadata. |
| Physical Windows/WSL terminal | Caveat until a physical native Windows ConPTY + psmux lifecycle and/or real WSL tmux lifecycle completes the checklist. | Run `docs/TRIAL-CHECKLIST.md` Windows/WSL section and attach bounded, redacted terminal-runtime evidence. Ubuntu/Linux CI does not clear this gate. |
| Feishu bot long connection | `FEISHU-BOT-WS` stays Caveat until a real Feishu bot persistent-connection run is recorded. | Configure a self-built Feishu bot for persistent connection event subscription, subscribe to `im.message.receive_v1`, run `pnpm smoke:feishu-bot-live -- --require-gate-evidence --output <report.json>`, audit the saved report with `pnpm evidence:feishu-bot-live-audit -- <report.json>`, generate `pnpm evidence:feishu-bot-live-report -- --report <report.json> --output <report.md>`, and record redacted receive/reply/reconnect evidence. Public webhook verification is optional compatibility evidence, not the primary gate. |
| Completed first-user feedback | `FIRST-USER-FEEDBACK` stays Caveat until at least one completed feedback packet is attached or linked. | Use `.github/ISSUE_TEMPLATE/forgebadger-trial-feedback.yml` or `docs/TRIAL-FEEDBACK.md`; run `pnpm trial:feedback-audit -- <packet.md>` for Markdown packets, `pnpm trial:feedback-issue-audit -- --issue=<number>` for a specific GitHub issue-form feedback item, or `pnpm trial:feedback-issues-audit` to scan non-tracker GitHub feedback candidates before maintainer triage. |

Current closeout: `docs/reports/v1.4-external-evidence-closeout-2026-05-29.md`.

## Contribution Safety

Contributions should preserve:

- Gateway/Web separation;
- platform multiplexer as the terminal persistence layer: tmux on
  macOS/Linux/WSL and psmux on native Windows;
- no terminal scrollback or raw provider payload storage in SQLite;
- explicit approval before write actions proposed by Copilot or Feishu;
- tenant scoping on all Gateway-owned state;
- redacted diagnostics and issue attachments.

Do not include local `.env` files, databases, API keys, provider request or
response bodies, raw terminal transcripts, Feishu message bodies, browser auth
tokens, or private AI CLI configuration in issues, pull requests, screenshots,
or test fixtures.

## Maintainer Checklist

Before presenting the repository as broadly ready for first external users:

- confirm `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and issue templates are current;
- rerun the automated checks listed in `docs/RELEASE-PLAN.md`;
- keep `docs/SMOKE-TEST.md`, `docs/TRIAL-CHECKLIST.md`, and
  `docs/SUPPORT-DIAGNOSTICS.md` aligned with
  `docs/EXTERNAL-EVIDENCE-GATES.md`;
- update closeout reports only with evidence that was actually collected.
