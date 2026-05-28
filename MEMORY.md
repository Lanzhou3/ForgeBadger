# OpenForge Project Memory

> Updated: 2026-05-29

## Current Stage

- v1.3 AI-Native Project Execution Traceability is complete and archived under
  `.planning/milestones/v1.3-*`. It shipped Copilot-to-Project-Manager
  traceability, Project Manager board workflow, safe terminal workspace
  context, provider readiness UX, and the open-source readiness packet.
- v1.4 External Evidence Closure is complete and archived under
  `.planning/milestones/v1.4-*`. It converted the remaining live-provider,
  physical Windows/WSL, Feishu developer-console callback, and first-user
  feedback caveats into a canonical evidence gate registry plus real redacted
  artifacts or precise blockers. Phase 17 created the registry; Phase 18 reran
  `pnpm smoke:copilot-provider` and recorded `LIVE-PROVIDER` as `Caveat` with
  `missing_provider_credential`; Phase 19 reran Feishu CLI preflight,
  `pnpm smoke:feishu-public-webhook`, Feishu/Copilot regression, and Gateway
  typecheck, then recorded `FEISHU-CALLBACK` as `Blocked`; Phase 20 published
  `docs/reports/v1.4-external-evidence-closeout-2026-05-29.md`, preserving
  `WINDOWS-WSL` and `FIRST-USER-FEEDBACK` as `Caveat`.
- v1.5 First-User Trial Operations completed its Phase 21 foundation. Phase 21
  selected the next milestone, defined the first-user trial packet, evidence
  routing, and gate-preserving verification loop, updated the first-user
  feedback template and GitHub issue form, removed first-user browser-token
  fallback guidance, and kept all external gates caveated or blocked until real
  artifacts exist.
- Phase 22 completed a maintainer/operator dry-run of the v1.5 trial loop on
  the current host. It recorded Linux `not_wsl`, Node `v24.14.1`, pnpm
  `10.33.2`, tmux `3.4`, Claude Code `2.1.152`, OpenCode `1.15.4`, Codex CLI
  `0.134.0`, `openforge doctor` terminal mode `native_tmux`, Gateway/Web
  loopback startup health, provider smoke skipped with
  `missing_provider_credential`, and the source dev-script `.env` override
  behavior as a docs/support gap. It did not clear any external gate.
- Phase 23 fixed that source fallback `.env` override gap with
  `scripts/run-with-root-env.mjs`, `scripts/run-with-root-env.test.mjs`,
  Gateway/Web package script wiring, CI harness coverage, source fallback docs,
  and real Gateway/Web prefix smoke evidence. Command-prefix env values now win
  over root `.env` while `.env` still fills missing values.
- Phase 24 added `scripts/validate-trial-feedback-intake.mjs` and
  `scripts/validate-trial-feedback-intake.test.mjs` so the first-user trial
  feedback GitHub issue form and Markdown template are machine-validated for
  required fields, field types, dropdown options, triage routing, redaction
  language, and unsafe raw-evidence requests. CI script harness coverage now
  includes the intake contract. This does not clear `FIRST-USER-FEEDBACK`.
- Phase 25 extended the intake validator to `docs/TRIAL-RUNBOOK.md` and removed
  first-user browser-token diagnostics fallback. The runbook now directs first
  users to Settings -> Export diagnostics JSON and labels local API fallback as
  maintainer-only. Validator coverage rejects browser developer tools, Local
  Storage, `openforge.token`, and `authorization: Bearer <token>` guidance in
  first-user runbook text. This does not clear `FIRST-USER-FEEDBACK`.
- Phase 26 added `scripts/create-trial-feedback-draft.mjs`,
  `scripts/create-trial-feedback-draft.test.mjs`, and
  `pnpm trial:feedback-draft`. The helper generates a local Markdown draft with
  bounded metadata, redacts token-shaped values, and explicitly states it is
  not submitted, not reviewed, and not gate-clearing evidence. This does not
  clear `FIRST-USER-FEEDBACK`.
- Phase 27 added `scripts/audit-trial-feedback-packet.mjs`,
  `scripts/audit-trial-feedback-packet.test.mjs`, and
  `pnpm trial:feedback-audit`. The audit rejects generated drafts,
  placeholder-only packets, missing required fields, and obvious secret-like
  content before maintainer triage. Passing audit means ready for maintainer
  triage only; `gateClearingEvidence` remains false and this does not clear
  `FIRST-USER-FEEDBACK`.
- Phase 28 added `scripts/validate-external-evidence-gates.mjs`,
  `scripts/validate-external-evidence-gates.test.mjs`, and
  `pnpm evidence:gates-validate`. The validator keeps
  `LIVE-PROVIDER=Caveat`, `WINDOWS-WSL=Caveat`,
  `FEISHU-CALLBACK=Blocked`, and `FIRST-USER-FEEDBACK=Caveat` unless a future
  reviewed change updates the validator with linked real artifact evidence.
- Phase A local-first release closure is accepted by repository reports:
  `docs/reports/browser-terminal-smoke-2026-05-06.md`,
  `docs/reports/claude-permission-smoke-2026-05-07.md`, and
  `docs/reports/release-candidate-2026-05-06.md`.
- Phase C product hardening review items are closed for this pass:
  terminal WebSocket malformed frames are ignored by a typed parser,
  project creation/import payloads remain runtime-CLI-agnostic while the
  database keeps a legacy config hint for template compatibility, and Web
  session status display/filtering normalizes terminal end states to stopped.
- Phase B Codex app-server work is accepted for beta feedback as a guarded
  observable control-plane prototype. The Gateway now owns Codex
  app-server protocol integration for managed sessions, normalizes Codex
  app-server notifications into OpenForge activity events, and aligns outgoing
  frames with `codex-cli 0.130.0` generated bindings instead of a standard
  JSON-RPC wrapper. Real `app-server-websocket` initialize validation is closed
  for the current local toolchain through `pnpm smoke:codex-app-server`, using
  isolated temporary `HOME` and `CODEX_HOME`, capability-token WebSocket auth,
  no prompt/thread/turn requests, and unchanged host `~/.codex` config/auth
  fingerprints around the smoke. The Web prototype is now framed as
  "Codex Background Tasks" and reads the Gateway capability endpoint plus
  `features.turnInputEnabled` from safe session payloads so users can see that
  real task input is disabled by default even before a background session exists.
  It also shows safe session runtime status (endpoint, PID, update time, and
  error text) plus a read-only recent activity feed filtered to Codex app-server
  lifecycle, initialize/thread, notification, and process error events. The Web
  event stream refreshes that feed and the safe app-server session list when
  matching app-server activity events arrive. Natural child-process exits and
  child errors now remain observable as stopped/error manager state and activity
  rows after runtime resources and capability-token files are cleaned up. The
  activity feed now renders localized lifecycle/operation/error/notification
  labels, Gateway-generated notification summaries, and safe details only,
  without surfacing prompt/text/response-like protocol content. Unsafe process
  errors are downgraded to a generic summary before activity persistence.
  Page-level Playwright coverage now verifies the zero-quota Web boundary with
  mocked Gateway APIs: the page renders capability/session/activity status,
  hides any prompt/turn send control, avoids `/turn` requests, and does not
  display transcript-like metadata. The start API now rejects provider-managed
  credential fields (`stored_encrypted_key`, `apiKeyId`, and `modelId`) for
  Codex app-server launch, keeping this path subscription-managed instead of
  silently ignoring provider injection input. Normal Codex terminal sessions now
  enforce the same provider/model boundary during session creation/start and at
  launch-plan construction.
- Terminal persistence remains tmux-backed. Gateway dependency reporting and
  CLI doctor/start messaging now distinguish native tmux support, missing tmux,
  and native Windows environments that require WSL for the built-in browser
  terminal. `openforge start` keeps management services startable but prints a
  terminal-runtime warning when the host cannot support tmux-backed browser
  terminals.
- Post-beta release gate work is now recorded in
  `docs/reports/post-beta-release-gates-2026-05-10.md`. `.github/workflows/ci.yml`
  is tracked and covers workspace typecheck/test/build, script harness tests,
  Provider/Codex boundary regression, Codex Background Tasks Web smoke, npm
  build/verify/smoke, and environment-gated release notes. The Playwright config
  now forces loopback hosts into `NO_PROXY` so proxy settings cannot make the
  webServer readiness check mistake a proxy 400 for a running Next dev server.
- Model provider management has moved to provider-scoped profiles. The latest
  model work added cc-switch-inspired provider presets, dynamic model sync for
  OpenAI-compatible model-list endpoints, provider-scoped model default/update/
  delete flows, and provider credential rotate/delete flows. Current commit
  series: `c83e595 feat: 支持服务商模型同步` followed by the provider
  management closure commit.
- Platform AI Copilot product-hardening shipped through
  [PR #2](https://github.com/Lanzhou3/OpenForge/pull/2)
  `feat: add release gates and platform copilot` from branch
  `post-beta-release-gates`; PR #2 merged into `master` on 2026-05-19. The
  branch now carries follow-up GSD planning commits for Phase 1 Beta Evidence
  Closure after `853969c docs(01): capture phase context` and
  `4db4dc8 docs(01): create phase plan`. Provider-backed Copilot runs, read
  tools, approval-gated pending actions, provider/model selectors, active memory
  recall, cancellation/timeout handling, audit logging, provider diagnostics,
  output redaction, and Web hardening are covered by repository tests,
  Playwright smoke coverage, package smoke, and CI.
  The latest Copilot evidence snapshot tracked here is `e024e7f
  docs: add copilot live smoke examples`; GitHub Actions for that head passed
  Workspace Static Checks, Codex Background Task Gates, NPM Package
  Build/Verify/Smoke, and Environment-Gated Release Notes. Later docs-only
  progress-source sync commits may sit on top of that evidence head. The PR
  body now tracks the remaining external gates as
  [#3](https://github.com/Lanzhou3/OpenForge/issues/3) live provider smoke,
  [#4](https://github.com/Lanzhou3/OpenForge/issues/4) physical Windows/WSL
  smoke, and [#5](https://github.com/Lanzhou3/OpenForge/issues/5) first-user
  Copilot hardening feedback.
- Copilot live-provider validation now has an executable harness:
  `pnpm smoke:copilot-provider`. With no disposable provider credential in the
  current environment it intentionally reports `missing_provider_credential`;
  with `OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1`, missing live config is a
  hard failure. The remaining acceptance work is therefore external evidence,
  not another local proxy check.
- Copilot diagnostics now expose bounded Provider SSOT readiness directly under
  the diagnostics Copilot section, so read tools and support handoffs can
  distinguish legacy API key rows from a usable active provider/model/credential
  configuration without surfacing secrets or foreign-tenant providers.

## Source Of Truth

- Release decision: `docs/reports/release-candidate-2026-05-06.md`
- Beta handoff: `docs/reports/beta-handoff-2026-05-10.md`
- Post-RC sequence: `docs/superpowers/specs/2026-05-06-openforge-post-rc-roadmap-design.md`
- Codex app-server boundary: `docs/reports/codex-app-server-architecture-2026-05-06.md`
- Phase B acceptance: `docs/reports/phase-b-codex-app-server-acceptance-2026-05-10.md`
- Platform AI Copilot product audit:
  `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md`
- Trial checklist and feedback routing: `docs/TRIAL-CHECKLIST.md`,
  `docs/TRIAL-FEEDBACK.md`, `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`
- API surface: `docs/API.md`

## Next Work

1. Use the validated v1.5 tokenless runbook, trial packet intake, optional
   feedback draft helper, packet audit helper, and external gate validator for
   the next real first-user run: affected surface, severity, owner,
   disposition or next action, environment summary, reproduction detail,
   diagnostics status, follow-up route or no-action rationale, and redaction
   review.
2. Keep `FEISHU-CALLBACK` `Blocked` until public HTTPS Gateway routing,
   operator webhook setup environment, and Feishu developer-console URL
   verification are available. Phase 19 proved bot CLI preflight and local
   regression only; those do not clear the real callback gate.
3. Keep `WINDOWS-WSL` as `Caveat` until a real Windows/WSL host completes the
   terminal checklist. Phase 20 recorded the current host as Linux `not_wsl`,
   which is not physical WSL evidence.
4. Keep `FIRST-USER-FEEDBACK` as `Caveat` until a completed redacted feedback
   packet is attached or linked with severity, owner, disposition, environment,
   reproduction detail, diagnostics status, and follow-up route.
5. Rerun the `LIVE-PROVIDER` gate only after a disposable provider credential
   and explicit model id are available; Phase 18 currently records
   `missing_provider_credential`.
6. Keep Codex app-server turn input disabled unless the Gateway is explicitly
   started with `OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1`. Treat `/turn` as a
   default-403 feature-flag prototype API, not a Web-exposed user workflow.
   Gateway does not persist prompt/response transcript content; add
   user-facing retention controls before exposing real turn input in Web. Do not
   add provider API-key or model override application to this Codex app-server
   path.
7. If stopped/error app-server records grow in long-running usage, add an
   explicit TTL or pagination strategy instead of deleting them immediately and
   losing observable process state.
8. Run a physical Windows/WSL manual smoke when that platform is available; the
   current pass covers CLI mode behavior, CI/release gate automation, checklist
   fields, and runbook remediation, not a real Windows host. Record that
   evidence in GitHub issue #4.
9. Collect first-user Copilot hardening feedback through the trial feedback
   form and issue #5. Focus on dependency failure states, CLI availability
   recovery, provider configuration recovery, and platform-specific
   remediation.
10. Keep SSH/remote execution as a separate architecture item, not part of the
   local Codex app-server prototype.
