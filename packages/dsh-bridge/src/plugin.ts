/**
 * OpenForge bridge Cordis plugin: exposes the OpenForge platform capabilities
 * as model-facing tools, backed by the Gateway internal copilot-bridge API.
 *
 * Tool surface (14 tools, parity with the in-process Copilot harness tools):
 * - 项目: `list_projects` / `get_project` / `create_project` (operate-gated)
 * - 会话: `list_sessions` / `dispatch_task_to_session` (operate-gated)
 * - 项目开发任务: `list_work_items` / `get_work_item` / `advance_work_item` (operate-gated)
 *   plus `portfolio_overview` / `list_portfolio_requests` / `get_project_dossier`
 * - 记忆: `search_memory` / `list_memory` / `write_memory` (operate-gated)
 *
 * Names, descriptions, and parameter names mirror the Copilot harness tools
 * (gateway `services/agent/tools/*`) so model behavior does not diverge
 * between the two paths.
 *
 * Operate tools are registered only when `OPENFORGE_BRIDGE_ENABLE_OPERATE` is
 * "1"/"true"; the default surface is read-only. With the operate surface on,
 * every operate call is gated behind the dsh approval seam and bridged to the
 * Gateway pending-action flow (see approval-bridge.ts) — the tool body runs
 * only after an owner approval. Note the harness treats `write_memory` as an
 * ungated write; this path gates it like the other writes (fail-safe).
 *
 * Configuration comes from the environment (see bridge-config.ts); a missing
 * required variable fails plugin load with an explicit message.
 *
 * @module
 */

import type { Context } from "@deepseek-ai/cordis";
import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";

import { registerApprovalBridge } from "./approval-bridge.js";
import { BridgeClient } from "./bridge-client.js";
import { loadBridgeConfig } from "./bridge-config.js";

export const name = "openforge-bridge";
export const inject = ["tools"];

/** Render a canonical JSON value as model-facing text. */
function renderJson(value: unknown): { type: "text"; text: string }[] {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

/** Tools that write platform state; gated behind OPENFORGE_BRIDGE_ENABLE_OPERATE. */
const OPERATE_TOOL_NAMES = new Set([
  "advance_work_item",
  "dispatch_task_to_session",
  "create_project",
  "pm_start_task_packet",
  "write_memory",
]);

const listOutput = {
  schema: { type: "array", items: { type: "object", additionalProperties: true } },
  render: (_args: unknown, value: unknown) => renderJson(value),
} as const;
const objectOutput = {
  schema: { type: "object", additionalProperties: true },
  render: (_args: unknown, value: unknown) => renderJson(value),
} as const;

/**
 * Build the bridge tool definitions against one client. Exported for tests:
 * each definition's `execute` is directly callable with a stub exec.
 * Operate tools (see OPERATE_TOOL_NAMES) are included only when
 * `options.enableOperate` is set; with the approval bridge active
 * (registerApprovalBridge) their calls park on an owner decision before the
 * body runs.
 * @param client - internal API client.
 * @param options - tool surface switches.
 * @returns registry-ready tool definitions.
 */
export function createBridgeTools(client: BridgeClient, options: { enableOperate?: boolean } = {}): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    // ---- 项目 ----
    defineTool({
      name: "list_projects",
      description: "List the user's projects with name, path, status, and AI tool.",
      parameters: {
        limit: { type: "number", description: "Optional max number of projects (1-100, default 50)" },
      },
      output: listOutput,
      async execute(args, exec) {
        return client.listProjects(
          { ...(args.limit !== undefined ? { limit: args.limit as number } : {}) },
          exec.signal,
        );
      },
    }),

    defineTool({
      name: "get_project",
      description: "Get a single project by id with full detail.",
      parameters: {
        projectId: { type: "string", required: true, description: "Project id" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.getProject(args.projectId, exec.signal);
      },
    }),

    defineTool({
      name: "create_project",
      description:
        "Create a new OpenForge project (approval required). "
        + "The path must be an absolute path; paths outside the user's home directory or "
        + "containing traversal segments are denied by the platform security policy.",
      parameters: {
        name: { type: "string", required: true, description: "Project name (1-200 chars)" },
        path: { type: "string", required: true, description: "Absolute project directory path" },
        description: { type: "string", description: "Optional project description (max 2000 chars)" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.createProject(
          {
            name: args.name,
            path: args.path,
            ...(args.description !== undefined ? { description: args.description } : {}),
          },
          exec.signal,
        );
      },
    }),

    // ---- 会话 ----
    defineTool({
      name: "list_sessions",
      description: "List the user's AI CLI sessions with status, adapter, and project.",
      parameters: {
        projectId: { type: "string", description: "Optional project id filter" },
        limit: { type: "number", description: "Optional max number of sessions (1-100, default 50)" },
      },
      output: listOutput,
      async execute(args, exec) {
        return client.listSessions(
          { ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
            ...(args.limit !== undefined ? { limit: args.limit as number } : {}) },
          exec.signal,
        );
      },
    }),

    defineTool({
      name: "dispatch_task_to_session",
      description:
        "Dispatch a task to an OpenForge session: the message is delivered to the session's "
        + "terminal as its next instruction. Delivery is confirmed by terminal read-back: if the "
        + "session's CLI is showing a modal dialog the call fails with delivery_unconfirmed — "
        + "ask the user to check the session terminal before retrying. Returns the dispatch receipt.",
      parameters: {
        sessionId: { type: "string", required: true, description: "Target session id" },
        message: { type: "string", required: true, description: "Task instruction delivered to the session" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.dispatchToSession(args.sessionId, args.message, exec.signal);
      },
    }),

    // ---- 项目开发任务 / portfolio ----
    defineTool({
      name: "list_work_items",
      description:
        "List OpenForge project development work items (portfolio tasks). "
        + "Each item carries id, title, state, project and priority.",
      parameters: {
        projectId: { type: "string", description: "Optional project id filter" },
        status: { type: "string", description: "Optional state filter: todo | in_progress | blocked | ready_for_review | done | cancelled" },
      },
      output: listOutput,
      async execute(args, exec) {
        return client.listWorkItems(
          { ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
            ...(args.status !== undefined ? { status: args.status } : {}) },
          exec.signal,
        );
      },
    }),

    defineTool({
      name: "get_work_item",
      description: "Get a portfolio work item by id.",
      parameters: {
        workItemId: { type: "string", required: true, description: "Work item id" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.getWorkItem(args.workItemId, exec.signal);
      },
    }),

    defineTool({
      name: "advance_work_item",
      description:
        "Advance one OpenForge work item automatically by ONE lifecycle step "
        + "(todo -> in_progress -> ready_for_review -> done; blocked -> in_progress). "
        + "There is no action/target parameter: the next state is decided by the platform's "
        + "state machine, which enforces preconditions (dispatch receipt, verified completion, "
        + "etc.). When a precondition is not met the call fails with a 409 error naming the "
        + "unmet condition — report that to the user instead of retrying blindly.",
      parameters: {
        id: { type: "string", required: true, description: "Work item id" },
        note: { type: "string", description: "Optional note recorded with the transition (1-256 chars)" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.advanceWorkItem(args.id, args.note, exec.signal);
      },
    }),

    defineTool({
      name: "portfolio_overview",
      description: "Get portfolio overview: enrolled projects, open work items, and recent activity.",
      parameters: {},
      output: objectOutput,
      async execute(_args, exec) {
        return client.portfolioOverview(exec.signal);
      },
    }),

    defineTool({
      name: "list_portfolio_requests",
      description: "List portfolio requests, optionally filtered by project.",
      parameters: {
        projectId: { type: "string", description: "Optional project id filter" },
        limit: { type: "number", description: "Optional max number of requests (1-100, default 50)" },
      },
      output: listOutput,
      async execute(args, exec) {
        return client.listPortfolioRequests(
          { ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
            ...(args.limit !== undefined ? { limit: args.limit as number } : {}) },
          exec.signal,
        );
      },
    }),

    defineTool({
      name: "get_project_dossier",
      description: "Get a project's portfolio dossier (objective, intended outcome, current evidence).",
      parameters: {
        projectId: { type: "string", required: true, description: "Project id" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.getProjectDossier(args.projectId, exec.signal);
      },
    }),

    // ---- 用量统计 ----
    defineTool({
      name: "get_usage_summary",
      description: "Get usage statistics: session duration and estimated cost by adapter/project/model (all time), plus token consumption totals and top buckets. Optional 'days' limits the token statistics to the last N days.",
      parameters: {
        days: { type: "number", description: "Optional trailing window in days (1-365) for the token statistics" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.usageSummary({
          ...(args.days !== undefined ? { days: args.days as number } : {}),
        }, exec.signal);
      },
    }),

    // ---- 技能（渐进式披露知识层）----
    defineTool({
      name: "list_skills",
      description: "List available Copilot skills (name + one-line summary). Skills are playbooks that teach how to combine action tools for complete engineering workflows — consult them before multi-step operations.",
      parameters: {},
      output: objectOutput,
      async execute(_args, exec) {
        return client.listSkills(exec.signal);
      },
    }),

    defineTool({
      name: "load_skill",
      description: "Load the full playbook body of one skill by name (from list_skills). Returns step-by-step guidance, exact tool names/parameters, error codes, and recovery rules.",
      parameters: {
        name: { type: "string", required: true, description: "Skill name from list_skills" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.loadSkill(args.name as string, exec.signal);
      },
    }),

    // ---- 终端输出 ----
    defineTool({
      name: "get_session_output",
      description: "Read the tail of a session's buffered terminal output (last CLI screen lines). Use it to inspect progress or completion of a dispatched task. Requires the session to be live in this Gateway process.",
      parameters: {
        sessionId: { type: "string", required: true, description: "Session id" },
        maxLines: { type: "number", description: "Optional tail length in lines (1-500, default 80)" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.sessionOutput(
          args.sessionId as string,
          args.maxLines as number | undefined,
          exec.signal,
        );
      },
    }),

    // ---- 项目开发管理（PM 板）----
    defineTool({
      name: "pm_list_task_packets",
      description: "List the Project Manager task packets for a project — the development queue with per-item prompt, acceptance criteria, verification expectations, linked session, and queue status.",
      parameters: {
        projectId: { type: "string", required: true, description: "Project id" },
        limit: { type: "number", description: "Optional max packets to return" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.listTaskPackets(
          args.projectId as string,
          args.limit as number | undefined,
          exec.signal,
        );
      },
    }),

    defineTool({
      name: "pm_get_task_packet",
      description: "Get one Project Manager task packet by work item id: full prompt, acceptance criteria, expected verification, evidence requirements, runtime adapter, and linked-session status.",
      parameters: {
        projectId: { type: "string", required: true, description: "Project id" },
        workItemId: { type: "string", required: true, description: "Work item id" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.getTaskPacket(args.projectId as string, args.workItemId as string, exec.signal);
      },
    }),

    defineTool({
      name: "pm_start_task_packet",
      description: "Start executing a development work item autonomously: ensure a linked CLI session exists, launch its runtime when the gateway can, bind the task packet context. Approval required.",
      parameters: {
        projectId: { type: "string", required: true, description: "Project id" },
        workItemId: { type: "string", required: true, description: "Work item id" },
        aiTool: { type: "string", description: "Optional runtime adapter: claude | opencode | codex | kimi" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.startTaskPacket(
          args.projectId as string,
          {
            workItemId: args.workItemId as string,
            ...(args.aiTool !== undefined ? { aiTool: args.aiTool as string } : {}),
          },
          exec.signal,
        );
      },
    }),

    // ---- 记忆 ----
    defineTool({
      name: "search_memory",
      description: "Search Copilot's scoped memory (global, project, or session) by keyword.",
      parameters: {
        query: { type: "string", required: true, description: "Keyword query (1-512 chars)" },
        scope: { type: "string", description: "Memory scope: global | project | session (default global)" },
        projectId: { type: "string", description: "Optional project id filter" },
        limit: { type: "number", description: "Optional max number of entries (1-20, default 10)" },
      },
      output: listOutput,
      async execute(args, exec) {
        return client.searchMemory(
          {
            query: args.query,
            ...(args.scope !== undefined ? { scope: args.scope } : {}),
            ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
            ...(args.limit !== undefined ? { limit: args.limit as number } : {}),
          },
          exec.signal,
        );
      },
    }),

    defineTool({
      name: "list_memory",
      description: "List Copilot's memory entries in a scope.",
      parameters: {
        scope: { type: "string", description: "Memory scope: global | project | session (default global)" },
        projectId: { type: "string", description: "Optional project id filter" },
        limit: { type: "number", description: "Optional max number of entries (1-50, default 50)" },
      },
      output: listOutput,
      async execute(args, exec) {
        return client.listMemoryEntries(
          { ...(args.scope !== undefined ? { scope: args.scope } : {}),
            ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
            ...(args.limit !== undefined ? { limit: args.limit as number } : {}) },
          exec.signal,
        );
      },
    }),

    defineTool({
      name: "write_memory",
      description:
        "Record a durable memory entry (fact, preference, decision, or project note). "
        + "Requires owner approval on this path.",
      parameters: {
        kind: { type: "string", required: true, description: "Entry kind: fact | preference | decision | project_note" },
        scope: { type: "string", required: true, description: "Memory scope: global | project | session" },
        text: { type: "string", required: true, description: "Memory text (1-8192 chars)" },
        projectId: { type: "string", description: "Project id (required when scope is project)" },
        metadata: { type: "object", additionalProperties: true, description: "Optional structured metadata" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.writeMemory(
          {
            kind: args.kind as string,
            scope: args.scope as string,
            text: args.text as string,
            ...(args.projectId !== undefined ? { projectId: args.projectId as string } : {}),
            ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
          },
          exec.signal,
        );
      },
    }),

    // ---- 项目图谱（只读 CodeGraph 索引）----
    defineTool({
      name: "project_graph_search",
      description:
        "Search code symbols in one project's CodeGraph index by name (functions, classes, "
        + "interfaces, routes). Returns symbol ids usable with project_graph_symbol_detail / "
        + "project_graph_impact. Unavailable when the project has no index (codegraph init not run).",
      parameters: {
        projectId: { type: "string", required: true, description: "Project id" },
        q: { type: "string", required: true, description: "Symbol name query (1-100 chars)" },
        kind: { type: "string", description: "Optional symbol kind filter, e.g. function | class | interface" },
        limit: { type: "number", description: "Optional max results (1-20, default 10)" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.projectGraphSearch(
          {
            projectId: args.projectId as string,
            q: args.q as string,
            ...(args.kind !== undefined ? { kind: args.kind as string } : {}),
            ...(args.limit !== undefined ? { limit: args.limit as number } : {}),
          },
          exec.signal,
        );
      },
    }),

    defineTool({
      name: "project_graph_symbol_detail",
      description:
        "Get one code symbol's definition (file + line) plus its direct callers and callees "
        + "from the project's CodeGraph index.",
      parameters: {
        projectId: { type: "string", required: true, description: "Project id" },
        symbolId: { type: "string", required: true, description: "Opaque symbol id from project_graph_search" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.projectGraphSymbolDetail(
          { projectId: args.projectId as string, symbolId: args.symbolId as string },
          exec.signal,
        );
      },
    }),

    defineTool({
      name: "project_graph_impact",
      description:
        "Compute the blast radius of changing one code symbol: the reverse call/reference "
        + "closure up to depth hops, with affected file paths and lines.",
      parameters: {
        projectId: { type: "string", required: true, description: "Project id" },
        symbolId: { type: "string", required: true, description: "Opaque symbol id from project_graph_search" },
        depth: { type: "number", description: "Traversal hops 1-3 (default 2)" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.projectGraphImpact(
          {
            projectId: args.projectId as string,
            symbolId: args.symbolId as string,
            ...(args.depth !== undefined ? { depth: args.depth as number } : {}),
          },
          exec.signal,
        );
      },
    }),

    defineTool({
      name: "project_graph_affected_paths",
      description:
        "Compute which code symbols are affected by changes to given files (project-relative "
        + "paths, e.g. from git status): multi-file reverse blast radius with per-symbol depth.",
      parameters: {
        projectId: { type: "string", required: true, description: "Project id" },
        paths: { type: "array", required: true, items: { type: "string" }, description: "Changed file paths (1-50 entries)" },
        depth: { type: "number", description: "Traversal hops 1-3 (default 2)" },
      },
      output: objectOutput,
      async execute(args, exec) {
        return client.projectGraphAffectedPaths(
          {
            projectId: args.projectId as string,
            paths: args.paths as string[],
            ...(args.depth !== undefined ? { depth: args.depth as number } : {}),
          },
          exec.signal,
        );
      },
    }),
  ];
  const all = tools;
  return options.enableOperate === true
    ? all
    : all.filter((tool) => !OPERATE_TOOL_NAMES.has(tool.name));
}

/**
 * Register the bridge tools on the tools service. Reads configuration from
 * the process environment and fails load when it is invalid.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const config = loadBridgeConfig(process.env);
  const client = new BridgeClient(config);
  for (const tool of createBridgeTools(client, { enableOperate: config.enableOperate })) {
    ctx.tools.register(tool);
  }
  // M3: with the operate surface on, gate those tools behind the dsh approval
  // seam and forward the questions to the Gateway pending-action flow. Without
  // operate tools nothing ever asks, so the bridge is only registered then.
  if (config.enableOperate) {
    registerApprovalBridge(ctx);
  }
}
