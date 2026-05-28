# Open Source Readiness

> Status: v1.3 open-source packet | Date: 2026-05-29

OpenForge is published as a local-first AI CLI control plane. The open-source
packet is meant to make local trial, contribution, support, and security
boundaries clear before broader community use.

## License Rationale

OpenForge uses the MIT License because it is a developer tool intended for
broad local use, adapter experimentation, forks, and self-hosted workflows. MIT
keeps the project easy to inspect, modify, package, and embed while keeping the
repository's current local-first beta status explicit.

The license does not create a hosted service commitment, warranty, support SLA,
or permission to publish secrets. Users and contributors remain responsible for
protecting API keys, JWTs, browser tokens, provider payloads, Feishu secrets,
terminal content, local project paths, SQLite databases, and AI CLI config.

## Product Boundary

OpenForge is not a hosted collaboration platform, billing system, cloud worker,
or autonomous remote execution service. Current scope is:

- local Gateway and Web console;
- tmux-backed AI CLI sessions;
- project and session recovery;
- provider/model readiness;
- approval-gated Copilot and Project Manager traceability;
- local-first trial feedback and diagnostics.

Remote execution, hosted collaboration, multi-tenant cloud operation, and
unattended autonomous coding loops require separate architecture and security
review before they can become supported scope.

## Required Caveats

The open-source packet does not clear external evidence caveats. Keep these
visible until real evidence is attached:

| Caveat | Current State | Rerun Path |
|--------|---------------|------------|
| Live provider pass | Caveat until a disposable live provider credential and explicit model id are used. | Run the provider smoke/readiness flow with redacted output and record only bounded status/code/model metadata. |
| Physical Windows/WSL terminal | Caveat until a real Windows host with WSL completes the terminal checklist. | Run `docs/TRIAL-CHECKLIST.md` Windows/WSL section and attach WSL terminal evidence. |
| Feishu developer-console callback | Blocked until a real Feishu console URL verification reaches the public Gateway webhook. | Provision public HTTPS routing, run console verification, and update the Feishu evidence report. |
| Completed first-user feedback | Caveat until at least one completed feedback packet is attached or linked. | Use `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml` or `docs/TRIAL-FEEDBACK.md`. |

## Contribution Safety

Contributions should preserve:

- Gateway/Web separation;
- tmux as the terminal persistence layer;
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
  `docs/SUPPORT-DIAGNOSTICS.md` aligned;
- update closeout reports only with evidence that was actually collected.
