# Decisions Index

This bounded index summarizes decisions that downstream GSD workflows should carry forward without re-asking.

## Product Position

- OpenForge is a local-first AI CLI control plane, not a hosted autonomous development platform.
- The strongest product wedge is reliable browser control and recovery of local AI CLI sessions.
- Copilot, Feishu, and Codex app-server features must strengthen that wedge instead of broadening into unbounded autonomy.
- AI-native project management is a traceability layer for AI CLI execution, not a generic PM-suite replacement.
- v1.4 focused on external evidence closure before any new runtime expansion.
- v1.5 focuses on first-user trial operations before any new runtime expansion.
- Phase 22 operator dry-run evidence is support/readiness evidence only; it
  cannot clear first-user or external manual gates.
- Source fallback command-prefix env values must win over root `.env` values
  so operators can run disposable dry-runs without editing local configuration.
- Trial feedback intake templates are a machine-verified contract, but a valid
  empty template is not first-user evidence.
- First-user diagnostics collection must stay tokenless from the user's
  perspective; local API token fallback is maintainer-only.
- Feedback draft generation may pre-fill bounded environment metadata, but it
  must not collect raw evidence or clear external gates.
- Feedback packet audit may reject incomplete or unsafe Markdown packets before
  triage, but passing audit must not clear external gates automatically.
- External evidence gate validation may block accidental registry drift, but it
  must not collect evidence or change gate states by itself.
- Trial intake material validation includes the first-user checklist, but it
  remains a structural guard and cannot substitute for a completed packet.
- Trial issue-route validation may prove follow-up issues are currently open,
  but it remains a read-only preflight and cannot substitute for feedback
  artifacts.
- Trial readiness validation may prove local preflights are aligned before
  collection, but it remains read-only and cannot substitute for feedback
  artifacts.
- GitHub issue-form feedback audit may prove an issue body is ready for human
  triage, but it remains read-only and cannot clear external evidence gates.
- The external gate registry must preserve both first-user feedback audit
  routes: Markdown packet audit and GitHub issue-form audit.
- Public and support first-user entrypoints must route completed feedback
  through the same audit commands before maintainer triage.
- Root and localized README trial entrypoints must expose both feedback
  collection paths so first users do not bypass the issue-form route.
- Completed first-user feedback must include Copilot smoke and boundary
  evidence before packet or issue audit can mark it ready for maintainer triage.

## Locked Decisions

| Area | Decision | Evidence |
|------|----------|----------|
| Gateway/Web split | Gateway owns REST, WebSocket, terminal, process, repository, and integration behavior; Web stays SPA-only. | `CLAUDE.md`, `docs/TECH-ARCHITECTURE.md` |
| Terminal persistence | tmux is the persistence layer; do not store terminal logs in SQLite. | `CLAUDE.md`, `docs/TECH-ARCHITECTURE.md` |
| API contract | REST APIs live under `/api/v1` and use the OpenForge envelope. | `CLAUDE.md`, `.claude/rules/api.md` |
| Tenant isolation | Business tables and repositories must scope by `user_id`. | `CLAUDE.md`, `.claude/rules/security.md` |
| Codex boundary | Codex launch paths stay subscription/SDK-managed; no provider API-key/model injection. | `MEMORY.md`, `docs/DEVELOPMENT-PLAN.md` |
| Codex app-server | Web prompt/turn input remains disabled by default; `/turn` is a feature-flag prototype. | `MEMORY.md`, `docs/CI-CD-PLAN.md` |
| Copilot boundary | Copilot is provider-backed, read-heavy, approval-gated, redacted, and non-autonomous. | `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md`, `docs/API.md` |
| Feishu boundary | Feishu is a controlled collaboration channel into Copilot, not execution authority or approval authority. | `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md` |
| Roadmap order | Close beta evidence, then public Feishu webhook safety, then first-user hardening before ledger or remote expansion. | GSD bootstrap review, `docs/superpowers/specs/2026-05-06-openforge-post-rc-roadmap-design.md` |
| v1.3 direction | Next milestone focuses on AI-native project execution traceability: Copilot proposals, Project Manager board, terminal context, provider health, and open-source trust. | `docs/reports/pm-review-audit-2026-05-22.md`, `.planning/REQUIREMENTS.md` |
| v1.4 direction | External release caveats require a canonical evidence registry and real redacted artifacts before any `Pass` reclassification. | `docs/OPEN-SOURCE-READINESS.md`, `.planning/REQUIREMENTS.md` |
| v1.4 live provider gate | `LIVE-PROVIDER` remains `Caveat` after Phase 18 because the smoke rerun returned `missing_provider_credential`; no live `Pass` can be claimed without a disposable credential and explicit model id. | `docs/reports/phase-18-live-provider-evidence-rerun-2026-05-29.md` |
| v1.4 Feishu callback gate | `FEISHU-CALLBACK` remains `Blocked` after Phase 19 because CLI bot preflight and local regression do not replace public HTTPS routing plus Feishu developer-console URL verification. | `docs/reports/phase-19-feishu-public-callback-evidence-2026-05-29.md` |
| v1.4 closeout | v1.4 is complete as a truthful evidence-closure milestone, with `LIVE-PROVIDER`, `WINDOWS-WSL`, and `FIRST-USER-FEEDBACK` preserved as `Caveat`, and `FEISHU-CALLBACK` preserved as `Blocked`. | `docs/reports/v1.4-external-evidence-closeout-2026-05-29.md` |
| v1.5 direction | First-user trial operations is the next milestone; it packages trial evidence routing and feedback triage before any runtime expansion. | `docs/superpowers/specs/2026-05-29-openforge-v1.5-first-user-trial-operations-design.md`, `.planning/phases/OF-21-first-user-trial-operations/21-01-PLAN.md` |
| v1.5 operator dry-run | Phase 22 records current-host operator evidence and a source `.env` override support gap, but it does not clear `FIRST-USER-FEEDBACK` or other external gates. | `docs/reports/phase-22-operator-trial-dry-run-2026-05-29.md` |
| v1.5 source env runner | Gateway/Web source scripts load root `.env` through an env-preserving runner so command-prefix overrides such as `OPENFORGE_DB_PATH=/tmp/...` remain authoritative for that run. | `docs/reports/phase-23-source-env-runner-2026-05-29.md` |
| v1.5 intake contract | First-user feedback issue form and Markdown template required fields, routing, and safety wording are checked by a bounded validator in CI; this does not clear `FIRST-USER-FEEDBACK`. | `docs/reports/phase-24-trial-feedback-intake-contract-2026-05-29.md` |
| v1.5 tokenless diagnostics | First-user runbook diagnostics use Web Settings export; browser-token/devtools curl fallback is rejected by the validator and remains maintainer-only if local API fallback is needed. | `docs/reports/phase-25-tokenless-trial-diagnostics-2026-05-29.md` |
| v1.5 feedback draft helper | `pnpm trial:feedback-draft` may generate a local Markdown draft with bounded metadata, but the draft is not submitted, not reviewed, and not gate-clearing evidence. | `docs/reports/phase-26-trial-feedback-draft-generator-2026-05-29.md` |
| v1.5 feedback packet audit | `pnpm trial:feedback-audit` rejects generated drafts, placeholders, missing fields, and secret-like content before maintainer triage; `gateClearingEvidence` remains false. | `docs/reports/phase-27-trial-feedback-packet-audit-2026-05-29.md` |
| v1.5 external gate drift guard | `pnpm evidence:gates-validate` requires the four external gate rows to keep their current Caveat/Blocked states and concrete rerun anchors until real artifacts justify a reviewed validator update. | `docs/reports/phase-28-external-evidence-gate-drift-guard-2026-05-29.md` |
| v1.5 trial materials consistency guard | `pnpm trial:intake-validate` validates the runbook, checklist, feedback template, and GitHub issue form as a local structural contract; it does not collect first-user evidence or clear gates. | `docs/reports/phase-29-trial-materials-consistency-guard-2026-05-29.md` |
| v1.5 trial issue route preflight | `pnpm trial:issue-routes-validate` checks GitHub issue #3, #4, and #5 are open and mapped to expected external evidence routes; `gateClearingEvidence` remains false. | `docs/reports/phase-30-trial-issue-route-preflight-2026-05-29.md` |
| v1.5 trial readiness preflight bundle | `pnpm trial:readiness-validate` aggregates trial intake, issue-route, and external gate validators before a real collection round; `gateClearingEvidence` remains false. | `docs/reports/phase-31-trial-readiness-preflight-bundle-2026-05-29.md` |
| v1.5 trial feedback issue audit | `pnpm trial:feedback-issue-audit -- --issue=<number>` audits GitHub issue-form feedback through the packet audit path; `gateClearingEvidence` remains false. | `docs/reports/phase-32-trial-feedback-issue-audit-2026-05-29.md` |
| v1.5 external gate issue-audit rerun guard | `pnpm evidence:gates-validate` requires `pnpm trial:feedback-issue-audit` in the `FIRST-USER-FEEDBACK` rerun path alongside the Markdown packet audit. | `docs/reports/phase-33-external-gate-issue-audit-rerun-guard-2026-05-29.md` |
| v1.5 first-user entrypoint audit-route guard | `pnpm trial:intake-validate` guards open-source readiness and support diagnostics docs so they preserve both feedback audit routes before maintainer triage. | `docs/reports/phase-34-first-user-entrypoint-audit-route-guard-2026-05-29.md` |
| v1.5 README trial-entrypoint guard | `pnpm trial:intake-validate` guards root and localized README trial sections so they preserve runbook, checklist, troubleshooting, feedback template, and GitHub issue-form links. | `docs/reports/phase-35-readme-trial-entrypoint-guard-2026-05-29.md` |
| v1.5 Copilot evidence packet audit guard | `pnpm trial:feedback-audit` and `pnpm trial:feedback-issue-audit` reject completed-looking feedback that omits Copilot smoke and boundary evidence before maintainer triage. | `docs/reports/phase-36-copilot-evidence-packet-audit-guard-2026-05-29.md` |
| v1.5 trial feedback candidate issue audit | `pnpm trial:feedback-issues-audit` scans GitHub `trial-feedback` issues, skips route trackers, and audits non-tracker candidates without clearing gates. | `docs/reports/phase-37-trial-feedback-candidate-issue-audit-2026-05-29.md` |

## Deferred Ideas

- Hosted collaboration, cloud deployment, billing, telemetry, and hosted marketplace.
- Autonomous remote development and raw shell/terminal control through Copilot or Feishu.
- SSH/remote execution implementation before a separate architecture/threat-model phase.
- Feishu approval links or code approval before explicit tokenized approval semantics exist.

## Canonical Current Docs

- `CLAUDE.md`
- `MEMORY.md`
- `docs/PRD-v1.1-MVP.md`
- `docs/TECH-ARCHITECTURE.md`
- `docs/DEVELOPMENT-PLAN.md`
- `docs/TEST-PLAN.md`
- `docs/CI-CD-PLAN.md`
- `docs/API.md`
- `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md`
- `docs/superpowers/specs/2026-05-06-openforge-post-rc-roadmap-design.md`
- `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md`
