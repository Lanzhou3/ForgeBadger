# ForgeBadger Competitive Differentiation Plan

> Date: 2026-06-13
> Status: v1.6 planning candidate. This plan does not clear v1.5 external
> evidence gates and does not expand autonomous execution authority.

## PM Verdict

ForgeBadger has product value, but not as another AI editor. The stronger wedge is
an **AI CLI operations cockpit** for developers and small teams that already use
Claude Code, Codex, OpenCode, or similar terminal agents and need reliable
browser control, resumable local sessions, auditable evidence, and lightweight
team coordination.

The differentiated promise should be:

> Start a local AI coding task in under 10 minutes, keep it recoverable through
> tmux, govern what it can do, and export a bounded handoff/evidence packet for
> review or team follow-up.

## Competitive Baseline

| Product | Public pattern | Lesson for ForgeBadger |
|---------|----------------|----------------------|
| [GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) | Delegates repository work to a background agent that researches, plans, changes a branch, and can create pull requests. | Users want task delegation and reviewable outcomes, not terminal plumbing. ForgeBadger should add a task packet/work queue on top of local sessions. |
| [OpenAI Codex](https://developers.openai.com/codex/) | Positions as one coding agent across app, IDE, CLI, web, GitHub, Slack, and Linear surfaces. | Do not compete on model quality or editor surface. Compete as the local-first control plane that can supervise multiple existing CLI agents. |
| [Claude Code](https://code.claude.com/docs/en/overview) | Terminal-native agent that edits files, runs commands, uses git, integrates MCP, and supports repeatable workflows. | Treat Claude Code-style CLIs as first-class runtimes. ForgeBadger should inject context, monitor readiness, and preserve sessions instead of replacing the CLI. |
| [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) | Specialized agents run in their own contexts for repeated task patterns and parallel work. | Starter packs should map ForgeBadger agents/templates/skills to concrete task types such as review, bugfix, docs sync, and trial evidence. |
| [Replit Agent](https://docs.replit.com/references/agent/overview) | Converts plain-language ideas into apps, sets up projects, checks work, fixes problems, and guides publishing. | ForgeBadger needs a first-value flow, not a settings maze: import/create project, verify runtime, start a session, and show the next action. |
| [Lark Node SDK long connection](https://github.com/larksuite/node-sdk) | Long connection mode lets local development receive event callbacks without public ingress during testing. | Feishu should use bot long connection as the primary collaboration path. Public webhook callback remains optional compatibility evidence, not a product blocker. |

## Differentiation Thesis

ForgeBadger should avoid becoming a general IDE or a hosted autonomous developer.
The fast path is to own the layer between AI CLIs and the team:

1. **Local-first runtime control:** tmux-backed, browser-accessible, recoverable
   sessions for existing AI CLIs.
2. **Multi-agent/CLI governance:** one place to see runtime readiness, model
   provider readiness, project context, sessions, and approval boundaries.
3. **Task-to-session continuity:** convert project-manager work items into
   launchable task packets with acceptance criteria and evidence expectations.
4. **Evidence and handoff:** export bounded summaries of what was asked, what
   ran, what changed, what still needs review, and which gates remain caveated.
5. **Feishu-native team loop:** receive bot commands and post bounded status or
   approval requests through long connection without requiring public callback
   ingress.

## v1.6 Candidate Roadmap

### Phase 38: First-Value Activation Loop

Goal: reduce first useful session setup to one guided path.

Deliverables:

- Dashboard "Start here" flow that checks tmux, CLI adapters, provider/model
  readiness, and project availability.
- One-click route to create/import a project and start the first Claude Code
  session with the selected template.
- Settings/runtime refresh remains available, but first-run blockers are
  surfaced on the launch path.

Success metrics:

- Time to first running local AI CLI session is under 10 minutes for a prepared
  developer machine.
- No session launch blocker appears only after the user reaches the terminal.
- All runtime blockers have copyable setup commands or a concrete next action.

### Phase 39: Task Packet And Work Queue

Goal: turn project-manager work items into launchable AI CLI tasks.

Deliverables:

- A task packet model containing project, CLI adapter, template/agent, prompt,
  acceptance criteria, expected verification, and evidence requirements.
- "Start task" action that creates or links a session and writes the task
  context into the session safely.
- Work queue view showing planned, running, waiting-for-review, blocked, and
  completed task packets.

Success metrics:

- A user can start a bugfix/review/docs task from a work item without manually
  reconstructing context.
- Task packets preserve tenant isolation and do not grant new autonomous shell
  authority beyond the existing terminal/session model.

### Phase 40: Session Handoff And Evidence Pack

Goal: make each AI CLI session reviewable after the terminal work ends.

Deliverables:

- Bounded session handoff summary with task prompt, runtime metadata, linked
  project/session, operator notes, commands/tests recorded by explicit action,
  and open review items.
- Redacted Markdown export suitable for GitHub issue, PR, or Feishu follow-up.
- Evidence-pack audit that rejects placeholders, raw secrets, and raw terminal
  dumps before sharing.

Success metrics:

- A completed session can produce a review packet in under 2 minutes.
- Handoff exports are useful without storing raw terminal history in SQLite.

### Phase 41: Feishu Long-Connection Collaboration Bridge

Goal: add a team entrypoint without requiring a public callback URL.

Deliverables:

- Feishu bot long-connection receive path for bounded commands such as
  `/forgebadger status`, `/forgebadger sessions`, and `/forgebadger task <id>`.
- Official Feishu/Lark SDK live smoke command:
  `pnpm smoke:feishu-bot-live -- --require-gate-evidence --output
  <report.json>`.
- Saved report audit command:
  `pnpm evidence:feishu-bot-live-audit -- <report.json>`.
- Markdown maintainer report command:
  `pnpm evidence:feishu-bot-live-report -- --report <report.json> --output
  <report.md>`.
- Policy routing that can return status, create pending actions, or reject
  unsafe/free-form terminal control.
- Reconnect and duplicate-event evidence path for the `FEISHU-BOT-WS` gate.

Success metrics:

- A real bot long-connection run records receive, route, bounded reply or
  pending action, terminal rejection, and reconnect behavior.
- Public webhook callback verification remains optional compatibility evidence.

### Phase 42: Starter Packs And Distribution Loop

Goal: make ForgeBadger feel useful immediately for repeatable AI development work.

Deliverables:

- Built-in task packs for code review, bugfix, docs sync, test generation,
  release note drafting, and first-user trial evidence.
- Each pack defines recommended CLI adapter, prompt frame, acceptance checklist,
  verification guidance, and evidence fields.
- Open-source onboarding page that highlights local-first control, Feishu
  long-connection collaboration, and evidence-based trust.

Success metrics:

- A new user can choose a starter pack and start a meaningful task without
  writing a custom template first.
- At least three packs create reviewable task packets and handoff exports.

## What To Avoid

- Do not position ForgeBadger as a better Cursor, Copilot, Codex, or Claude Code.
- Do not add hosted cloud workers before v1.5 first-user evidence closes or a
  separate remote-execution milestone is approved.
- Do not allow Feishu free-form terminal input.
- Do not store raw terminal logs in SQLite.
- Do not treat a long-connection smoke, live provider smoke, or first-user
  feedback draft as gate-clearing evidence without the existing registry audit.

## Fastest Landing Order

1. Ship Phase 38 first because activation is the biggest adoption leak.
2. Ship Phase 39 second because task packets convert ForgeBadger from a session
   console into a work system.
3. Ship Phase 40 third because reviewable evidence is the trust moat.
4. Ship Phase 41 when real Feishu bot access is available.
5. Ship Phase 42 alongside or after Phase 39/40 so starter packs exercise the
   real task packet and evidence flow.
