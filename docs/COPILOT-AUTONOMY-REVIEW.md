# Copilot autonomy and task lifecycle review

Date: 2026-09-22. Scope: personal-project Task Packets, Gateway platform tools,
Session Server dispatch, persistent progress and original-conversation reporting.
Shared/team projects retain their delivery workflow and authorization boundary.

## Root causes

- The policy returned `auto_approve`, but the orchestrator still created pending
  owner actions. Routine writes therefore requested redundant confirmation.
- `PROGRAMMATIC_SUBMIT_NOT_READY` occurred before terminal input, yet the generic
  external-action catch classified it as unknown. A PM command may already have
  created a session, so treating the entire operation as no-effect was also wrong.
- First-session creation changed the task's resource revision inside its own
  operation and invalidated later authorization checks.
- Completion tracking used live events and a late `dispatchedAt` timestamp. Fast
  completion and Gateway restarts could lose progress. Exact session lookup also
  depended on the first 200 board items.
- Codex 0.155.1 exposes its empty composer while the model is loading. Its
  `tab to queue message` hint can appear on unsubmitted input; it does not prove
  delivery. Four-line composer extraction truncated real multiline task packets.
- Terminal output reads depended on the browser-fed cache, leaving Copilot blind
  when no browser was attached. Native trust prompts then consumed planning
  steps without giving the user an actionable blocker.

## Comparison with current upstream approaches

Sources were checked on 2026-09-22; upstream behavior can change.

| Source | Applicable approach | ForgeBadger decision |
| --- | --- | --- |
| [OpenClaw permission modes](https://docs.openclaw.ai/tools/permission-modes) and [exec approvals](https://docs.openclaw.ai/tools/exec-approvals) | Layer allowlists, per-call decisions and existing authority; automated review does not erase human-required boundaries. | Deterministic routine platform operations run automatically in direct user turns. Scope, preference, Grant, tenant and runtime checks remain mandatory. |
| [Hermes security](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/security.md) | Smart approval separates low-risk actions from dangerous or uncertain ones; approval policy and sandboxing are distinct. | Preserve native CLI trust, approval and sandbox settings. Unknown tools, global memory, takeover, stop and controlled development acceptance retain confirmation. |
| [DeepSeek Harness auto-review](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/auto-review/README.md) and [tool contracts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md) | Experimental per-action review, typed tool boundaries and fail-closed uncertainty. | Use typed not-sent failures and durable stage receipts. Do not add an LLM approval round trip for known bounded platform operations or restore the retired DSH runtime. |

## Resulting contract

1. Routine task creation/metadata, preparation, management metadata, scoped
   memory, evidence-bound closeout and operator-enabled CLI dispatch do not ask
   for another platform confirmation in a direct user turn. Automatic approval
   is bound to the exact run, step and idempotency key. Background runs do not
   acquire owner authority, and expired/revoked Grants never fall back to it.
2. Readiness is bounded and authorization is rechecked while waiting and before
   staging/Enter. Once any staging can have occurred, an uncertain result remains
   unknown and must not replay. A compound PM `confirmed` receipt may explicitly
   contain `executionStatus: incomplete` and `dispatch.status: not_sent`; a new
   authorized intent reuses preparation and performs only the remaining dispatch.
3. Each task attempt records prompt digest, origin intent, session runtime
   identity and notification watermark/anchor immediately before staging. Task
   semantics and session binding remain frozen across awaits. Local synchronous
   preparation changes are checkpointed under an immediate transaction.
4. Linked Task Packets use `pm_execute_task_packet`. Generic session dispatch
   rejects linked or ambiguously linked tasks, preventing a second prompt from
   borrowing the original attempt's completion evidence.
5. `pm_get_task_progress` is a read with an optional 0–5000 ms wait. Persistent
   reconciliation runs at startup and periodically, independently of enabling
   new dispatches. It advances confirmed current attempts to `ready_for_review`
   or `blocked`; it does not dispatch another task. Old timestamp-only tasks,
   missing anchors, changed prompts, restarted runtimes and manual intervention
   do not get automatic completion attribution.
6. `pm_close_task` verifies server-side task/attempt/receipt/notification identity.
   The original eligible conversation gets one durable status report per attempt.
   Report scanning is paginated so invalid origins cannot starve later reports.
   CLI completion never proves tests, acceptance, merge or deployment.
   A run stopped only by its step budget remains eligible for an already-confirmed
   dispatch report; other stopped, cancelled or indeterminate runs do not.
7. Terminal reads use the current Session Server snapshot without a browser.
   Cached fallback is explicitly non-live and rechecks access. Observed Codex
   directory/hooks trust prompts return `PROGRAMMATIC_SUBMIT_NATIVE_APPROVAL_REQUIRED`
   before any write; the owner resolves them in the terminal before a new attempt.

## Verification and operation

Focused regression suites cover authorization, readiness, revocation before and
after staging, partial preparation, unknown replay, fast hooks, restart recovery,
cross-tenant/old evidence, manual intervention, exact session lookup and reporting.
The final 62-file Copilot/platform/terminal regression selection passed 442 tests;
the readiness/classifier/PM/risk selection passed 52 tests. Independent Gate 3
review passed its 43 targeted tests with no critical or high findings. These
selections overlap and are not a claim about the complete workspace suite.
Gateway typechecking and an isolated emitted build with copied migration assets
also passed. The real CLI evidence below covers Codex, not every adapter or
physical Windows/ConPTY.
The opt-in real CLI harness is:

```sh
FORGEBADGER_REAL_CLI_TEST=1 pnpm --dir packages/gateway exec tsx scripts/verify-copilot-cli-flow.ts
```

It creates a temporary Git project, SQLite database, loopback Gateway and a
dedicated Session Server. Its default planner is scripted; Codex, terminal IPC,
native completion hooks and platform tools are real. It independently runs three
addition tests and checks the single original-conversation report. Native trust
dialogs require an inspected decision; no bypass flags are used. The harness
accepts a line such as `input:"\r"` on stdin to send Enter to an inspected
native dialog. Do not use this interface to submit task prompts; task delivery
must run through the platform command.

For a real Copilot planner using the existing configured default provider:

```sh
FORGEBADGER_REAL_CLI_TEST=1 FORGEBADGER_REAL_COPILOT_TEST=1 \
  node scripts/run-with-root-env.mjs pnpm --dir packages/gateway exec tsx scripts/verify-copilot-cli-flow.ts
```

The source model configuration is read-only; credentials stay in memory and are
not copied to the test database/log. If multiple users have default models, supply
`FORGEBADGER_TEST_MODEL_USER`. Only the generated task is sent to the provider.
The 2026-09-22 real-model run completed task creation, Codex dispatch, native
completion tracking, evidence-bound closeout and one original-conversation report.
It used zero platform approval prompts; the temporary project and generated
native hooks were explicitly trusted. Three unchanged addition tests passed again
in an independent process. First-use native trust paused execution; a new user
turn resumed the not-sent stage after trust was granted.

Each run writes `evidence.json` in its printed temporary root. Only its dedicated
daemon is stopped on completion; existing sessions and Gateway processes remain.

This change does not rewrite historical unknown receipts, bulk-retry old work,
auto-accept tasks, merge, deploy, or enable an adapter in production settings.
Native CLI first-use trust may still need confirmation. Rework after a completed
or uncertain attempt needs an explicit recovery path, not clearing the replay
fence. Notification deletion can intentionally make evidence unverifiable.


## Protocol investigation and repair — 2026-09-23

The user clarified that Copilot must be capable of project management, with the
model choosing its steps. The proposed promise-text/keyword completion guard was
withdrawn before deployment. Normal model stop remains normal turn completion;
project task completion still requires tool evidence, independently of chat status.

### Evidence and upstream comparison

The affected M3 run completed after two model rounds with no recorded tool call in
its final response. It did not exhaust its step budget. Its original provider
finish reason and raw wire response were not persisted, so this does not establish
whether the model chose to stop or a protocol compatibility issue caused it.
The later Kimi task-interrupted hook is a separate CLI event, not proof of a
Copilot transport interruption.

Local source snapshots reviewed: Hermes `470cf66b0`, DeepSeek Harness `cd5ef81481`.

- DSH `packages/core/agent-loop/src/agent.ts` persists a complete assistant response
  before running tools; normal no-tool responses finish. Its DeepSeek serializer
  retains text, reasoning_content and the tool-call batch together. Explicit goal
  driving is a separate opt-in facility, not an implicit PM sequence.
- Hermes `agent/chat_completion_helpers.py` preserves complete assistant/tool state
  and handles repeated complete tool names from MiniMax/NVIDIA. Its loop has bounded,
  classified recovery for empty/truncated responses. Its narrow intermediate-ack
  heuristic is primarily for Codex Responses and is not a general MiniMax fix.
- [MiniMax M3 tool-use documentation](https://platform.minimax.io/docs/guides/text-m3-function-call)
  requires the complete assistant response, including inline thinking or structured
  reasoning, to be returned during multi-turn tool use.
- [MiniMax OpenAI compatibility documentation](https://platform.minimax.io/docs/api-reference/text-openai-api)
  illustrates cumulative reasoning_details snapshots. This behavior is enabled only
  for the existing exact official endpoint allowlist; unknown incremental detail
  formats are rejected rather than guessed.

### Implemented scope

Protocol fixtures reproduced two failures: separate text/tool-call assistant
messages in OpenAI requests, and missing thinking/signature blocks in Anthropic
requests. The repair stores complete validated model responses with AES-GCM using
existing model-step receipts, then reconstructs a single assistant message and
correlated tool results. No database migration or live history rewrite is required.
Opaque replay is bound to tenant, conversation, run and model-step identity; actual
outbound serializers also verify endpoint, model/profile and format. Public events,
run inspection and summaries do not receive private replay. Different models receive
redacted visible text and normalized tools. Complete replay counts toward context
budgets; old whole turns may be summarized, but native blocks are never truncated.

Streaming tool names retain both ordinary-fragment and repeated-name candidates.
Only declared tool names can disambiguate them; two valid candidates fail closed.
Tool arguments and IDs are not guessed or repaired. All tool execution still waits
for validation of the entire response. No new automatic tool replay or generic
request retry was added. Parser errors now retain fixed, body-free diagnostics.

### Verification

- Relevant Gateway regression: 57 files, 430 tests passed. The final three protocol
  test files passed 80/80, including the subsequently added diagnostic/normal-stop
  cases. Gateway typecheck and the final temporary-output build passed.
  Independent Gates 2 and 3 passed for this protocol scope; Gate 3 independently
  reran the 80 tests and typecheck and inspected the real M3 evidence.
- Fixtures cover encrypted file-DB reopen, wrong keys/tampering/cross-step copy,
  cross-tenant reads, edit/truncate recovery, source switching, summaries, replay
  budgets, incomplete/cross-step result pairing, and multi-chunk thinking signatures.
- Real-provider smoke used the production configuration read-only, synthetic tools,
  and a disposable database. Both default MiniMax-M2 and the affected MiniMax-M3
  profile completed two dependent tool rounds then a final stop, with zero approvals.
  M3 evidence: `/var/folders/12/clm348sn173_v501mq7_qwhw0000gn/T/fb-model-replay-DRHjFf/evidence.json`.
  Each follow-up request contained one assistant per preceding model response and
  one matching tool result per call. No real project data was sent.
- The earlier real Codex project-management flow above is separate evidence; this
  protocol smoke does not replace native CLI permission or full lifecycle testing.
  The running Gateway was not restarted and its database was not migrated or written.

Reproduce the isolated real-provider protocol check:

```sh
FORGEBADGER_REAL_COPILOT_TEST=1 FORGEBADGER_TEST_MODEL_PROFILE=<configured-profile-id> \
  node scripts/run-with-root-env.mjs pnpm --dir packages/gateway exec tsx scripts/verify-copilot-model-replay.ts
```

Only synthetic read-tool requests are sent. `FORGEBADGER_TEST_MODEL_USER` selects the
owner when multiple accounts have default models. Credentials remain in memory.
