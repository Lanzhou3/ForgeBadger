# Phase 8: First-User Readiness Packet - Research

**Researched:** 2026-05-21T17:52:00+08:00
**Status:** Ready for planning

## User Constraints

### First-User Feedback Packet

- **D-01:** Completed first-user feedback is currently not present. Phase 8 must record this as an explicit `Caveat` or blocked evidence item, not substitute the existing feedback template as if real feedback had been collected.
- **D-02:** Feedback caveat owner is `maintainer/operator`.
- **D-03:** Accepted collection paths are the GitHub `OpenForge first-user trial feedback` issue form or a redacted Markdown packet following `docs/TRIAL-FEEDBACK.md`.
- **D-04:** The caveat can be cleared only when at least one complete real first-user feedback packet is attached or linked from the v1.1 closeout report with reproducible steps, affected surfaces, owner, severity, and mapped follow-up disposition.

### Trial Path Packaging

- **D-05:** `docs/TRIAL-CHECKLIST.md` should be reorganized around a short `Quick Smoke` path for first users plus an `Evidence Appendix` for deeper validation.
- **D-06:** The quick path must cover setup, dependency checks, provider readiness, terminal smoke, Copilot smoke, Feishu smoke when available, and feedback capture without making the first user parse every maintainer-only gate.
- **D-07:** The evidence appendix should preserve deeper maintainer details, manual evidence boundaries, diagnostics export expectations, Feishu live-callback status, provider caveats, and Windows/WSL caveats.

### Support Diagnostics Packet

- **D-08:** Phase 8 should produce one unified support diagnostics packet instead of three unrelated runbooks or checklist-only notes.
- **D-09:** The packet should be internally organized by provider failures, runtime/terminal failures, and Feishu failures.
- **D-10:** Each diagnostics section must include exact commands, expected artifacts, redaction guidance, and escalation boundaries.
- **D-11:** Diagnostics artifacts must not ask users to expose raw provider keys, Feishu app secrets, JWTs, plaintext credentials, provider request/response bodies, sensitive terminal output, or unrelated project secrets.

### v1.1 Closeout Risk Routing

- **D-12:** The v1.1 closeout report must include a user-visible caveat table plus backlog or issue routing.
- **D-13:** Remaining live-provider, physical Windows/WSL, Feishu real-console callback, and completed first-user feedback caveats must be stated explicitly with owner, clearing condition, current evidence status, and next route.
- **D-14:** The closeout report must not collapse caveats into ambiguous TODOs or imply first-user readiness gates passed when only templates, mocked tests, or local regression evidence exist.

## Project Constraints (from AGENTS.md)

- Follow `.planning/ROADMAP.md` and `docs/DEVELOPMENT-PLAN.md` for sequencing; Phase 8 is first-user readiness, not runtime expansion. [VERIFIED: AGENTS.md]
- Preserve Gateway/Web separation. Do not add Next.js API behavior for Gateway responsibilities. [VERIFIED: AGENTS.md]
- Use narrower verification commands when possible and do not claim completion without relevant verification output. [VERIFIED: AGENTS.md]
- Keep terminal persistence assumptions intact: tmux remains the persistence layer, terminal history stays out of SQLite, and terminal authority cannot be delegated to Feishu text. [VERIFIED: AGENTS.md]
- Never hardcode or expose API keys, tokens, JWT secrets, Feishu secrets, provider credentials, attach tokens, private keys, plaintext credentials, or sensitive terminal output. [VERIFIED: AGENTS.md]
- Documentation-only work may update docs directly, but still needs file-content verification, whitespace checks, and source-of-truth consistency. [VERIFIED: AGENTS.md]

## Research Question

What does the planner need to know to package Phase 8 into executable work that improves first-user readiness without overclaiming unavailable real-world evidence or asking trial users to expose secrets?

Phase 8 should produce a maintainable handoff: a short first-user trial path, a completed-or-caveated feedback packet status, a support diagnostics packet, and a v1.1 closeout report that routes remaining risks as explicit caveats or backlog items.

## Inputs Reviewed

- `AGENTS.md`
- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `.planning/PROJECT.md`
- `.planning/STATE.md`
- `.planning/MILESTONES.md`
- `.planning/RETROSPECTIVE.md`
- `.planning/phases/OF-08-first-user-readiness-packet/08-CONTEXT.md`
- `.planning/phases/OF-06-live-provider-and-platform-smoke-evidence/06-CONTEXT.md`
- `.planning/phases/OF-07-feishu-live-callback-readiness/07-CONTEXT.md`
- `docs/TRIAL-CHECKLIST.md`
- `docs/TRIAL-FEEDBACK.md`
- `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`
- `docs/reports/beta-handoff-2026-05-10.md`
- `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md`
- `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md`
- `docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md`
- `docs/SMOKE-TEST.md`
- `docs/CI-CD-PLAN.md`
- `docs/API.md`
- `package.json`
- `packages/gateway/src/routes/diagnostics.ts`
- `packages/web/src/app/(dashboard)/settings/page.tsx`
- `packages/web/src/lib/api.ts`

## Findings

### 1. Phase 8 Should Not Invent Completed Feedback

`docs/TRIAL-FEEDBACK.md` and `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml` define a good feedback artifact shape: result, startup path, environment, doctor output, startup/health, core trial path, Copilot evidence, mapped UX requirement, category, severity, caveat owner/next action, Windows/WSL evidence, diagnostics/browser evidence, reproduction steps, and safety confirmation. [VERIFIED: codebase]

No completed first-user feedback artifact is present in the active Phase 8 context. `.planning/STATE.md`, `.planning/REQUIREMENTS.md`, and `.planning/ROADMAP.md` all still identify completed first-user feedback as pending or caveated. [VERIFIED: codebase]

Planner implication:

- Create a feedback status artifact or closeout section that explicitly records `Caveat` for first-user feedback.
- The artifact must reference the GitHub issue form and Markdown template as the expected collection paths, not as completed feedback.
- BETA-03 can be planned as "attach real feedback when available or record blocked/caveated status with owner and artifact shape"; it cannot be marked complete by templates alone.

### 2. The Existing Trial Checklist Is Comprehensive But Too Linear For First Users

`docs/TRIAL-CHECKLIST.md` already covers environment, startup, account, project/config, Claude Code session, diagnostics/evidence, Phase 3 hardening triage, Copilot smoke, Feishu live callback readiness, and manual evidence boundary. [VERIFIED: codebase]

The current shape mixes first-user run steps, maintainer evidence rules, Feishu callback caveats, and release-matrix discipline in one long path. That supports completeness but conflicts with D-05/D-06's quick first-user path requirement. [VERIFIED: codebase + CONTEXT decision]

Planner implication:

- Keep the checklist as the user-facing runnable entry, but restructure it rather than creating competing trial docs.
- A good target is: intro/source-of-truth rules, `Quick Smoke`, `Record Feedback`, and `Evidence Appendix`.
- The appendix should preserve the deeper Feishu, Copilot, Windows/WSL, diagnostics, and manual evidence details so Phase 6/7 evidence discipline is not lost.

### 3. Diagnostics Capabilities Already Exist; Phase 8 Needs A Support Packet Around Them

`docs/API.md` documents `GET /api/v1/diagnostics/export` as an authenticated, tenant-scoped, local-only redacted report with runtime metadata, tenant resource counts, dashboard health, adapter definitions/runtime modes, Copilot capability metadata, Provider SSOT readiness summaries, Copilot memory counts, safe Feishu integration capability state, and selected environment values. It states the export redacts key, token, password, credential, authorization, `sk-*`, and `Bearer ...` values. [VERIFIED: codebase]

The Web Settings page exposes diagnostics export copy and download behavior through `packages/web/src/app/(dashboard)/settings/page.tsx` and `packages/web/src/lib/api.ts`. [VERIFIED: codebase]

`docs/TRIAL-FEEDBACK.md` gives the preferred Web export path and a fallback curl command. It warns against sharing plaintext keys, passwords, tokens, private keys, unrelated project secrets, or the browser auth token value. [VERIFIED: codebase]

Planner implication:

- Do not build a new diagnostics export path in Phase 8 unless execution finds a documentation/code mismatch.
- Produce a support diagnostics packet that wraps existing capabilities with exact commands, expected artifacts, redaction rules, and escalation boundaries.
- Provider diagnostics should cite Provider SSOT readiness, `pnpm smoke:copilot-provider`, and Copilot visible provider blockers.
- Runtime diagnostics should cite `openforge doctor`, `tmux -V`, terminal smoke steps, `mvp1-smoke`, `gate-d-smoke`, focused tmux integration, and physical Windows/WSL caveat requirements.
- Feishu diagnostics should cite `lark-cli auth status --verify`, `lark-cli doctor`, `pnpm smoke:feishu-public-webhook`, developer-console callback, and public webhook regression commands.

### 4. The v1.1 Evidence Matrix Is The Current Source For Caveat Status

`docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` currently covers Phases 6-7. It records live provider as `Caveat`, physical Windows/WSL as `Caveat`, Feishu developer-console callback as `Blocked`, Feishu topology/encrypted payload boundary as `Pass`, Feishu authority regression as `Pass`, and release docs consistency/redaction as `Pass`. [VERIFIED: codebase]

Phase 8 should not overwrite Phase 6/7 evidence facts. It should consume them and create a readiness closeout that explains what a first user or maintainer should do next. [VERIFIED: codebase + CONTEXT decision]

Planner implication:

- Create a v1.1 closeout report under `docs/reports/` that references the evidence matrix.
- The closeout should include user-visible caveat rows for live provider, physical Windows/WSL, Feishu developer-console callback, and completed first-user feedback.
- The closeout should route each caveat to owner, clearing condition, artifact, and backlog/follow-up route.
- If the evidence matrix is updated, update it only to point to the Phase 8 closeout and first-user readiness packet; do not reclassify old rows without new evidence.

### 5. Phase 8 Has Two Natural Plan Waves

The roadmap already proposes:

- `08-01`: Capture first-user feedback packet and support diagnostics reproduction path.
- `08-02`: Produce v1.1 readiness closeout report and route remaining risks to backlog.

The dependency is logical: closeout should depend on the final feedback status, checklist shape, support diagnostics packet, and current Phase 6/7 evidence references. [VERIFIED: ROADMAP.md]

Planner implication:

- Use two plans.
- Wave 1 should update `docs/TRIAL-CHECKLIST.md`, add or update a support diagnostics packet, and record the first-user feedback caveat/expected artifact shape.
- Wave 2 should create the v1.1 closeout report, update references/indexes if needed, update `.planning/REQUIREMENTS.md` and `.planning/STATE.md`, and run consistency/redaction checks.

### 6. Secret/Redaction Checks Need To Be Planned As First-Class Work

All Phase 8 outputs are documentation or evidence artifacts that mention commands, tokens, diagnostics, browser auth token handling, provider credentials, Feishu secrets, and terminal output. This makes accidental secret exposure the main implementation risk. [VERIFIED: codebase]

Planner implication:

- Every plan should include redaction acceptance criteria.
- Final verification should run `git diff --check` and a targeted scan over modified Phase 8 docs.
- The scan may record counts/categories and classify placeholders, but must not paste raw secret-like values into closeout evidence.

## Recommended Plan Shape

1. **Plan 08-01: First-user trial path and diagnostics packet.** Reorganize `docs/TRIAL-CHECKLIST.md` into quick path plus evidence appendix, create a unified support diagnostics packet, and record first-user feedback as a caveat with owner, collection path, artifact shape, and clearing condition.
2. **Plan 08-02: v1.1 readiness closeout and source-of-truth routing.** Create a v1.1 closeout report with user-visible caveats/backlog routing, link Phase 8 artifacts from the existing evidence matrix/docs, update GSD requirement/state metadata, and run redaction/coverage checks.

## Risks

| Risk | Why It Matters | Planning Mitigation |
|------|----------------|---------------------|
| False-green first-user feedback | Templates are not real feedback | Record feedback as `Caveat` until at least one complete real feedback packet is attached or linked |
| Checklist remains too long | First users may abandon or skip critical evidence | Put runnable essentials in `Quick Smoke`; move maintainer-only detail to `Evidence Appendix` |
| Diagnostics packet duplicates stale facts | Competing docs create support confusion | Link to existing API, smoke, CI, Phase 6, and Phase 7 evidence docs as source-of-truth references |
| Caveats are buried in internal docs | Users may interpret v1.1 as fully passed | Use a user-visible caveat table in the closeout report with owner and clearing condition |
| Secret leakage in support docs | Users may paste provider keys, Feishu secrets, JWTs, or terminal output | Include explicit forbidden data classes and run targeted scans before closeout |

## Validation Architecture

### Automated Validation

- `git diff --check`.
- `rg -n "Quick Smoke|Evidence Appendix|Support Diagnostics|First-user feedback|Caveat|Blocked|Pass|owner|clearing condition|docs/TRIAL-FEEDBACK.md|OpenForge first-user trial feedback" docs/TRIAL-CHECKLIST.md docs/TRIAL-FEEDBACK.md .github/ISSUE_TEMPLATE/openforge-trial-feedback.yml docs/reports/*.md`.
- `rg -n "provider|runtime|terminal|Feishu|diagnostics/export|openforge doctor|pnpm smoke:copilot-provider|pnpm smoke:feishu-public-webhook|lark-cli auth status --verify|lark-cli doctor" <support diagnostics artifact>`.
- `rg -n "live provider|Windows/WSL|Feishu developer-console callback|first-user feedback|owner|clearing condition|backlog|issue|Caveat|Blocked|Pass" <v1.1 closeout artifact>`.
- `gsd-sdk query check.decision-coverage-plan .planning/phases/OF-08-first-user-readiness-packet .planning/phases/OF-08-first-user-readiness-packet/08-CONTEXT.md`.
- Targeted secret scan over modified Phase 8 docs for unclassified raw `sk-`, `Bearer `, `Authorization: Bearer`, `OPENFORGE_MASTER_KEY=`, `OPENFORGE_JWT_SECRET=`, `OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY=`, `OPENAI_API_KEY=`, `ANTHROPIC_API_KEY=`, `APP_SECRET`, `verification token`, `event encrypt key`, raw provider request/response body, raw callback body, browser auth token value, private key headers, or terminal transcript content.

### Manual-Only Validation

- Attaching a real first-user feedback issue or Markdown packet.
- Physical Windows/WSL terminal smoke.
- Live provider pass with disposable provider credential and explicit model id.
- Real Feishu developer-console URL verification and optional live message event.

### Acceptance Rules For Plans

- Every plan must reference one or more of `BETA-03`, `READY-01`, `READY-02`, and `READY-03`.
- Every task must include `<read_first>` and `<acceptance_criteria>`.
- No plan may mark first-user feedback complete without a real feedback artifact.
- No plan may remove live provider, physical Windows/WSL, or Feishu callback caveats without corresponding real evidence.
- Support artifacts must state what to collect, what to redact, and when to escalate for provider, runtime/terminal, and Feishu failures.
- The v1.1 closeout report must expose caveats to first users/maintainers, not just internal planning readers.

## RESEARCH COMPLETE
