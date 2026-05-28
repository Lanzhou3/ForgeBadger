# OpenForge Trial Checklist

Use this checklist as the first-user trial entry point. Attach the completed
notes to either `docs/TRIAL-FEEDBACK.md` or the GitHub issue form
`OpenForge first-user trial feedback` at
`.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`.

The v1.1 evidence matrix remains
`docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md`. The Feishu live
callback evidence remains
`docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md`. Do not mark a
`Caveat` or `Blocked` row as `Pass` unless the required real evidence exists.
The canonical external gate registry is `docs/EXTERNAL-EVIDENCE-GATES.md`.
The first-user readiness closeout is
`docs/reports/v1.1-readiness-closeout-2026-05-21.md`, and support triage starts
from `docs/SUPPORT-DIAGNOSTICS.md`.

Do not paste raw provider keys, Feishu secrets, JWTs, browser auth token values,
sensitive terminal output, raw provider/callback bodies, private keys, attach
tokens, passwords, or unrelated project secrets into feedback, screenshots, or
evidence reports.

## Quick Smoke

### Startup Path

- [ ] Choose startup path: npm/CLI package or source fallback.
- [ ] Record OpenForge version or commit:
- [ ] Record Web URL:
- [ ] Record Gateway URL:
- [ ] Start OpenForge successfully.
- [ ] Confirm Gateway health returns the OpenForge envelope
      `{"code":0,"data":...,"message":""}`.
- [ ] Confirm `/login` loads in the browser.

### Environment And Dependencies

- [ ] OS and version:
- [ ] Shell and version:
- [ ] Browser and version:
- [ ] `node --version`:
- [ ] `tmux -V`:
- [ ] `claude --version`:
- [ ] npm/CLI only: `openforge doctor` output reviewed.
- [ ] Windows only: native Windows was used for management UI checks only.
- [ ] Windows terminal evidence, if claimed: WSL distribution/version and
      terminal trial result recorded.

### Account

- [ ] Register a new user.
- [ ] Log out and log back in.
- [ ] Confirm dashboard and sidebar load without browser console fetch errors.

### Project And Config

- [ ] Create or import a disposable project.
- [ ] Review the Claude Code template.
- [ ] Preview generated config.
- [ ] Apply generated config.
- [ ] Record any config conflict, skip, or overwrite decision.

### Project Manager Workflow

- [ ] Open the disposable project detail page.
- [ ] Open the `Project Manager` tab.
- [ ] Review the current goal summary, constraints, acceptance criteria, and
      status.
- [ ] Update goal state only if the trial needs to record a real change.
- [ ] Create or inspect a work item from the Project Manager work item list.
- [ ] Open the work item detail panel.
- [ ] Attach one bounded evidence reference using only `kind`, `label`, `ref`,
      and `path`.
- [ ] Verify the evidence reference appears on the work item without pasting
      raw evidence content.
- [ ] Move the work item through the allowed status action, or verify the
      evidence-free `done` guard requires a manual completion reason.
- [ ] Verify the ledger timeline shows the relevant safe event markers:
      status change, evidence attached, manual completion, or blocker marker.
- [ ] Use ledger filters and `Load more ledger events` if the expected marker is
      not in the first loaded window.
- [ ] Record failures with a short reproduction path and redacted screenshots or
      diagnostics.

Acceptable evidence-reference examples:

- `kind=report`, `label=Trial checklist`, `path=docs/TRIAL-CHECKLIST.md`
- `kind=test`, `label=Project Manager E2E`, `ref=project-manager.spec.ts`
- `kind=report`, `label=v1.2 closeout`,
  `path=docs/reports/v1.2-project-manager-web-workflow-closeout-2026-05-22.md`
- `kind=issue`, `label=Follow-up`, `ref=OF-123`
- `kind=pr`, `label=Workflow patch`, `ref=PR-42`
- `kind=smoke`, `label=Typecheck`, `ref=pnpm --dir packages/web run typecheck`

Forbidden Project Manager evidence content:

- raw terminal transcripts;
- Feishu message bodies;
- provider payloads;
- API keys;
- JWTs;
- private keys;
- attach tokens;
- unrelated project secrets;
- raw provider or callback bodies;
- browser auth token values.

### Claude Code Session And Terminal

- [ ] Create a Claude Code session.
- [ ] Attach to the browser terminal.
- [ ] Enter a command and observe input/output.
- [ ] Resize the browser or terminal area and confirm terminal resize.
- [ ] Refresh the browser and reconnect to the same terminal session.
- [ ] Stop the session and confirm UI state changed.
- [ ] Restart Gateway/Web and confirm session recovery behavior.
- [ ] Confirm terminal evidence came from a real browser, not only unit tests or
      mocked Playwright.
- [ ] If a Claude Code permission prompt appears, record the prompt type, what
      OpenForge showed, and the outcome without copying sensitive terminal
      output.

### Provider Readiness And Copilot Smoke

- [ ] Check `docs/EXTERNAL-EVIDENCE-GATES.md` gate `LIVE-PROVIDER` before
      claiming a live provider pass.
- [ ] Open `/models` and choose the Provider, Model, Credential, and apply
      target that will be used for the smoke.
- [ ] Click **Check readiness** in the Provider Health card. Record only
      `readiness.status`, `readiness.code`, remote error category, matched model
      id, and next step text. Do not copy API keys, Authorization headers,
      provider request/response bodies, or provider payloads.
- [ ] If Codex is the runtime under test, confirm the Codex subscription card
      shows subscription-managed identity and that provider apply remains
      disabled for Codex.
- [ ] Maintainer live-provider harness result recorded, if available:
      `pnpm smoke:copilot-provider`.
- [ ] If live provider smoke is skipped, record the visible reason: missing
      disposable credential, missing compatible provider, missing active model,
      or missing active credential.
- [ ] Configure an OpenAI or Anthropic provider with an active model and a
      disposable test credential before claiming live Copilot provider pass.
- [ ] Open `/copilot` from the sidebar.
- [ ] Ask Copilot to diagnose session launch readiness.
- [ ] Verify the response uses safe OpenForge platform state such as adapter
      discovery, dashboard health, recent activity, project detail, session
      detail, or diagnostics summary.
- [ ] If Copilot proposes an action, confirm it appears as a pending action
      before approval.
- [ ] Approve or reject the pending action and confirm the run state does not
      duplicate the submission.
- [ ] If Copilot proposes a memory write, approve or reject it and confirm the
      visible text does not expose pasted secrets.
- [ ] Confirm Copilot does not expose terminal input, raw shell execution,
      automatic tmux input, or Codex app-server `/turn` input.

### Optional Feishu Smoke

- [ ] Check `docs/EXTERNAL-EVIDENCE-GATES.md` gate `FEISHU-CALLBACK` before
      claiming a Feishu public callback pass.
- [ ] If testing live Feishu, run `pnpm smoke:feishu-public-webhook` with
      operator-controlled environment values and record only sanitized output.
- [ ] Configure a public HTTPS URL for
      `/api/v1/integrations/feishu/webhook/:publicId`.
- [ ] Run Feishu developer-console URL verification before claiming the real
      callback gate passed.
- [ ] If triggering a real `im.message.receive_v1` event, use only an allowed
      chat and mapped Feishu user.
- [ ] Verify free-form Feishu text such as `/approve <id>` cannot approve
      pending actions or send terminal input.
- [ ] Keep v1.1 public webhook deployment to a single Gateway with
      SQLite-backed replay/rate storage. Multi-instance exposure requires
      shared replay and shared rate-limit stores first.
- [ ] If the Feishu app uses top-level encrypted payloads, keep public webhook
      enablement off; v1.1 fails closed with
      `feishu_webhook_encrypted_payload_unsupported`.

### Diagnostics Export

- [ ] Export diagnostics from Settings, or record that export was unavailable.
- [ ] Check browser console for errors.
- [ ] Check browser Network tab for failed requests.
- [ ] Add screenshots or written observations.
- [ ] Add reproduction steps for each issue.
- [ ] For support triage, use `docs/SUPPORT-DIAGNOSTICS.md`.

### Feedback Capture

- [ ] Complete `docs/TRIAL-FEEDBACK.md` or open the GitHub issue form
      `OpenForge first-user trial feedback`.
- [ ] If trial intake materials changed, run `pnpm trial:intake-validate` and
      keep the output with maintainer handoff notes.
- [ ] Maintainer preflight, if routing to existing GitHub follow-up issues:
      run `pnpm trial:issue-routes-validate`.
- [ ] Optional: generate a local draft with
      `pnpm trial:feedback-draft -- --output /tmp/openforge-trial-feedback.md`
      and complete/redact it before sharing.
- [ ] If using a Markdown packet, run
      `pnpm trial:feedback-audit -- /tmp/openforge-trial-feedback.md`; treat a
      pass as ready for human triage only, not automatic gate clearance.
- [ ] Check `docs/EXTERNAL-EVIDENCE-GATES.md` gate
      `FIRST-USER-FEEDBACK` before claiming completed first-user evidence.
- [ ] Run `pnpm evidence:gates-validate` before changing any external gate
      state.
- [ ] Map each issue to the closest Phase 3 hardening requirement in the
      evidence appendix below.
- [ ] For every `pass with caveats` or `blocked` result, record affected
      surface, severity, owner, disposition, next action or no-action
      rationale, evidence needed to clear the status, follow-up route, and
      redaction review.

## Feedback Capture

Completed first-user feedback is currently a `Caveat`. The owner is
`maintainer/operator`. The caveat clears only when at least one real completed
feedback packet is attached or linked from closeout with the artifact shape in
`docs/EXTERNAL-EVIDENCE-GATES.md`:

- reproducible steps;
- affected surfaces;
- owner;
- severity;
- disposition;
- environment and dependency versions;
- redacted diagnostics or a reason diagnostics are unavailable.

Accepted collection paths:

- `docs/TRIAL-FEEDBACK.md` for a redacted Markdown packet.
- `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml` for the GitHub issue
  form named `OpenForge first-user trial feedback`.

Templates and empty issue forms do not count as completed feedback. Keep
feedback status as `Caveat` until real first-user evidence exists.

## Evidence Appendix

### Phase 3 Hardening Triage

Map every observed issue to at least one Phase 3 requirement before filing
feedback:

| Requirement | Use When The Report Shows |
|-------------|---------------------------|
| UX-01 | Missing tmux, missing Claude/Codex/OpenCode CLI, unsupported native Windows terminal mode, or unclear runtime dependency guidance. |
| UX-02 | Provider, model, or credential readiness failures that are hard to recover from or risk exposing secrets. |
| UX-03 | Copilot run, pending-action, cancellation, or waiting-for-approval state is confusing after retry, refresh, or multiple tabs. |
| UX-04 | Feedback lacks enough environment, command, browser, expected/actual, or reproduction detail to become an engineering task. |
| UX-05 | Copilot Web active-run state appears to move backward after polling, events, refresh, or out-of-order responses. |
| UX-06 | Settings, Copilot, or diagnostics panels show empty content instead of a recoverable API/query failure state. |
| UX-07 | Browser E2E evidence hides an unhandled `/api/v1/*` route, uses brittle selectors, or misses key state-ordering assertions. |

For every `pass with caveats` or `blocked` result, record:

- Affected surface:
- Severity:
- Owner:
- Disposition:
- Next action or no-action rationale:
- Evidence needed to move from `Caveat`/`Blocked` to `Pass`:
- Follow-up route, phase, or issue:
- Redaction review completed:

### Copilot Detail

- Canonical gate: `docs/EXTERNAL-EVIDENCE-GATES.md` gate `LIVE-PROVIDER`.
- Phase 6 live provider and platform evidence is tracked in
  `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md`.
- Do not remove the live-provider caveat without a disposable live provider
  credential, explicit model id, and successful redacted smoke result.
- Record only redacted JSON result, provider name, model id, status, and
  sanitized failure reason.
- Do not copy raw provider request bodies, raw provider response bodies, full
  model outputs, default headers, or plaintext credentials.

### Feishu Callback Detail

- Canonical gate: `docs/EXTERNAL-EVIDENCE-GATES.md` gate `FEISHU-CALLBACK`.
- Phase 7 Feishu live-exposure evidence is tracked in
  `docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md`.
- `lark-cli auth status`, `lark-cli doctor`, long-running event consumers, and
  simulated signed Gateway requests are preflight or regression evidence only.
- FEI-01 `Pass` requires a real Feishu developer-console HTTP callback to
  `POST /api/v1/integrations/feishu/webhook/:publicId`.
- URL verification proves public reachability and verification-token match
  only. It does not prove chat policy, tenant mapping, replay protection, rate
  limiting, or approval boundaries.
- Do not record raw auth config, app secrets, verification tokens, event
  encryption keys, raw signatures, JWTs, callback bodies, or private chat
  content.

### Windows And WSL Evidence

- Native Windows can be used for management UI checks.
- Native Windows does not count as tmux-backed browser terminal pass evidence.
- Physical Windows/WSL terminal evidence remains a `Caveat` until a real WSL
  host completes dependency checks, browser terminal attach/input/resize,
  WebSocket reconnect, Gateway restart recovery, and session cleanup checks.
- Record WSL distribution/version, `openforge doctor`, terminal trial result,
  and any environment-specific blocker.

### Manual Evidence Boundary

- CI can cover workspace tests, builds, provider regressions, mocked Copilot
  page behavior, focused tmux integration, and simulated Feishu route
  regressions.
- CI cannot replace real browser terminal behavior, real Claude Code permission
  prompt behavior, live Copilot prompt behavior against a disposable provider
  credential, physical Windows/WSL behavior, or real Feishu developer-console
  URL verification.
- Manual evidence must stay redacted. Never share raw provider keys, Feishu
  secrets, JWTs, browser auth token values, sensitive terminal output, raw
  provider/callback bodies, private keys, attach tokens, passwords, or
  unrelated project secrets.
