/**
 * Builtin Copilot skills — the progressive-disclosure knowledge layer.
 *
 * A skill is procedural knowledge (how/when/in-what-order to use the action
 * tools), NOT an executable capability: every action still goes through the
 * native tools. Three-tier disclosure:
 *   tier 1  list_skills        -> name + one-line summary (cheap, always on)
 *   tier 2  load_skill(name)   -> full markdown playbook
 *   tier 3  resources          -> embedded reference sections inside the body
 *
 * Embedded as TS constants (not fs assets) so tsx dev, next build, and the
 * published CLI bundle all see the same registry without asset copying.
 */

export interface CopilotSkill {
  /** Stable identifier used by load_skill. kebab-case. */
  readonly name: string;
  /** Tier-1 summary shown by list_skills (one line, English). */
  readonly description: string;
  /** Tier-2 full playbook body (markdown). */
  readonly body: string;
}

const AUTONOMOUS_WORK_ITEM_LOOP = `# Autonomous work-item loop

Drive ONE Project Manager work item from queue to completion without human
step-by-step instruction.

## Tools used
pm_list_task_packets, pm_get_task_packet, pm_start_task_packet,
get_session_output, dispatch_task_to_session

## Loop
1. **Pick**: \`pm_list_task_packets {projectId}\`. Prefer \`queueStatus\`
   "planned"; treat "blocked" as blocked-by-dependency and skip.
2. **Understand**: \`pm_get_task_packet {projectId, workItemId}\`. Read
   acceptanceCriteria, expectedVerification, evidenceRequirements carefully —
   they define done.
3. **Dispatch**: \`pm_start_task_packet {projectId, workItemId, aiTool?}\`.
   - Creates a linked CLI session when missing, launches its runtime, and
     delivers the packet prompt to the terminal.
   - Idempotent: with a live linked session it re-delivers the prompt.
   - Approval: this call parks as a pending action until the owner approves.
4. **Monitor**: poll \`get_session_output {sessionId, maxLines: 120}\` between
   turns. Look for: idle prompt (finished), permission dialog (tell the owner),
   error trace (analyze), or active progress (wait, do not spam).
5. **Judge**: compare final screen/state against acceptanceCriteria. Never
   claim success without evidence matching evidenceRequirements.
6. **Report**: summarize what was done, what was verified, and any owner
   decisions needed. Status/evidence updates go through PM routes (P1 tools)
   or are reported to the owner.

## Guardrails
- Never dispatch to a session leased by a Portfolio worker (409
  PORTFOLIO_WRITER_FENCE_REJECTED means hands off).
- If delivery returns 502 submission_indeterminate, the task may already have
  reached the CLI: tell the owner to inspect the terminal and never auto-retry.
- One work item at a time unless the owner asks for parallel lanes.`;

const SESSION_DISPATCH = `# Session dispatch & monitoring

Deliver instructions to running AI CLI sessions and read their screens.

## Dispatch
\`dispatch_task_to_session {sessionId, message}\` (approval required)
- Message is staged as one bracketed paste, then submitted with exactly one
  Enter after the adapter-specific settle window.
- Delivery is CONSUMED only after the current CLI composer releases the task.
- 1-4000 chars after trim; split larger plans into sequential messages.
- 409 BRIDGE_SESSION_NOT_ACTIVE: session exists in DB but not live here ->
  start it first (or ask the owner if start tooling is unavailable).
- 409 PORTFOLIO_WRITER_FENCE_REJECTED: leased to a Portfolio worker -> hands off.
- 502 submission_indeterminate: the task may already be running -> inspect the
  terminal, report the uncertainty, and do not retry automatically.

## Monitoring
\`get_session_output {sessionId, maxLines}\`
- Reads the buffered pty tail of LIVE sessions; detached/never-attached return
  empty output with live:false.
- Use maxLines <= 120 for progress checks; raise only when hunting an error.
- Interpretation hints: a bare TUI prompt usually means the CLI finished its
  turn; repeated identical output means stuck; "approve?"-style prompts mean
  escalate to the owner.

## Cadence
Poll after meaningful waits (tool completions), not on a tight loop.`;

const PROJECT_INSIGHTS = `# Project insights

Read and create projects.

## Tools
- \`list_projects {limit?}\`: id/name/path/status/aiTool overview.
- \`get_project {projectId}\`: full detail (config generation state, template).
- \`create_project {name, path}\` (approval required):
  - Path MUST be absolute and under the user's home directory for auto
    approval; outside home it requires explicit owner approval; traversal
    segments and denied system roots (/etc,/proc,/sys,/root) are denied outright.

## When to use
Before any development-management work, resolve which project id applies;
never guess ids — list first.`;

const PORTFOLIO_GOVERNANCE = `# Portfolio governance

Portfolio-level requests, dossiers, and gated work-item advancement.

## Read tools
- \`portfolio_overview\`: enrolled projects, open work items, recent activity.
- \`list_portfolio_requests {projectId?, limit?}\`.
- \`get_project_dossier {projectId}\`: objective, intended outcome, evidence.
- \`get_work_item {workItemId}\`.

## Advance (gated)
\`advance_work_item {workItemId, note?}\` moves ONE lifecycle step
(todo->in_progress->ready_for_review->done) through the Portfolio State Gate:
dispatch receipts, verified completion evidence, accepted decisions, and owner
authority are enforced. Rejections come back 409 with stable codes:
PORTFOLIO_PRECONDITION_FAILED / PORTFOLIO_INVALID_TRANSITION. Terminal states
reject. Always attach a short transition note.`;

const MEMORY_PLAYBOOK = `# Memory playbook

Durable, scoped notes the Copilot can recall later.

## Tools
- \`search_memory {query, scope?, projectId?, limit?}\`
- \`list_memory {scope?, projectId?, limit?}\`
- \`write_memory {kind, scope, text, projectId?, metadata?}\`

## Scopes
global | project (requires projectId) | session.

## Kinds
fact | preference | decision | project_note.

## Etiquette
Write decisions and owner preferences, not transient chatter. On the dsh path
write_memory is operate-gated; on the in-process path it executes directly —
either way prefer precision over volume.`;

const USAGE_ANALYSIS = `# Usage analysis

Answer spend/token questions from real telemetry.

## Tool
\`get_usage_summary {days?}\`
- sessionUsage: totalSessions, totalDurationMs, estimatedCostUsd (labeled
  "estimated"), buckets byAdapter/byProject/byModel (all-time).
- tokenUsage: total* tokens, requestCount, cacheHitRate, top buckets; honors
  days (1-365) with tokenWindowDays echoed back.

## Recipes
- "这个月花了多少": request days:30 and quote estimatedCostUsd + totalTokens,
  always stating the window and that cost is an estimate.
- "哪个项目最烧钱": rank tokenUsage.byProject / sessionUsage.byProject.
- Model comparison: diff tokenUsage.byModel entries.`;

const SAFETY_AND_APPROVALS = `# Safety & approvals

Non-negotiable operating rules.

## Approvals
Operate-class tools park as pending actions; execution happens ONLY after an
explicit owner decision via the approve/reject flow. Free-form chat like
"批准吧" never approves anything. While parked, the run is awaiting_approval:
stop and wait.

## Tool switches
Owners can disable individual tools (copilot_tool_preferences). Disabled
tools are hidden from your schema; if you still emit one you get back
"Tool disabled by owner" — respect it and pick another route.

## Hard denies
Path traversal segments, destructive shell patterns (rm -rf, mkfs, dd if=, >:)
and denied system roots (/etc, /proc, /sys, /root) are rejected before
execution. Craft inputs that never need them.

## Isolation
Every read/write is scoped to the acting user server-side. Cross-user ids are
just "not found" — never probe.

## Honesty
Preserve partial results on failure, quote real tool output as evidence, and
never fabricate verification.`;

export const BUILTIN_COPILOT_SKILLS: readonly CopilotSkill[] = [
  {
    name: "autonomous-work-item-loop",
    description:
      "End-to-end loop to autonomously complete a PM work item: pick packet, start/dispatch, monitor terminal output, judge against acceptance criteria.",
    body: AUTONOMOUS_WORK_ITEM_LOOP,
  },
  {
    name: "session-dispatch",
    description:
      "Deliver instructions to running AI CLI sessions with delivery confirmation, and read their terminal output tails safely.",
    body: SESSION_DISPATCH,
  },
  {
    name: "project-insights",
    description:
      "List/get/create projects; includes the create_project path approval rules (home directory, denied roots).",
    body: PROJECT_INSIGHTS,
  },
  {
    name: "portfolio-governance",
    description:
      "Portfolio requests/dossiers and the gated advance_work_item lifecycle with its 409 rejection codes.",
    body: PORTFOLIO_GOVERNANCE,
  },
  {
    name: "memory-playbook",
    description:
      "Scoped durable memory: search/list/write_memory usage, scopes, kinds, and writing etiquette.",
    body: MEMORY_PLAYBOOK,
  },
  {
    name: "usage-analysis",
    description:
      "Answer cost/token questions with get_usage_summary: windows, bucket ranking, estimate labeling.",
    body: USAGE_ANALYSIS,
  },
  {
    name: "safety-and-approvals",
    description:
      "Approval-flow etiquette, disabled-tool behavior, hard-denied inputs, tenant isolation, and honesty rules.",
    body: SAFETY_AND_APPROVALS,
  },
];

/** Tier-1 metadata rows (stable order). */
export function listCopilotSkillSummaries(): Array<{ name: string; description: string }> {
  return BUILTIN_COPILOT_SKILLS.map(({ name, description }) => ({ name, description }));
}

/** Tier-2 lookup. Returns undefined for unknown names. */
export function getCopilotSkill(name: string): CopilotSkill | undefined {
  return BUILTIN_COPILOT_SKILLS.find((skill) => skill.name === name);
}
