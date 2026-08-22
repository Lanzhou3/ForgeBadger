/**
 * OpenForge bridge Cordis plugin: exposes the OpenForge platform capabilities
 * as model-facing tools, backed by the Gateway internal copilot-bridge API.
 *
 * Tool groups:
 * - 项目开发任务: `list_work_items` / `advance_work_item` (operate-gated)
 * - 下发任务至会话: `list_sessions` / `dispatch_task_to_session` (operate-gated)
 *
 * Operate tools are registered only when `OPENFORGE_BRIDGE_ENABLE_OPERATE` is
 * "1"/"true"; the default surface is read-only. With the operate surface on,
 * every operate call is gated behind the dsh approval seam and bridged to the
 * Gateway pending-action flow (see approval-bridge.ts) — the tool body runs
 * only after an owner approval.
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
const OPERATE_TOOL_NAMES = new Set(["advance_work_item", "dispatch_task_to_session"]);

/**
 * Build the bridge tool definitions against one client. Exported for tests:
 * each definition's `execute` is directly callable with a stub exec.
 * Operate tools (advance_work_item, dispatch_task_to_session) are included
 * only when `options.enableOperate` is set; with the approval bridge active
 * (registerApprovalBridge) their calls park on an owner decision before the
 * body runs.
 * @param client - internal API client.
 * @param options - tool surface switches.
 * @returns registry-ready tool definitions.
 */
export function createBridgeTools(client: BridgeClient, options: { enableOperate?: boolean } = {}): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    defineTool({
      name: "list_work_items",
      description:
        "List OpenForge project development work items (portfolio tasks). "
        + "Each item carries id, title, state, project and priority.",
      parameters: {
        projectId: { type: "string", description: "Optional project id filter" },
        status: { type: "string", description: "Optional state filter: todo | in_progress | blocked | ready_for_review | done | cancelled" },
      },
      output: {
        schema: { type: "array", items: { type: "object", additionalProperties: true } },
        render: (_args, value) => renderJson(value),
      },
      async execute(args, exec) {
        return client.listWorkItems(
          { ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
            ...(args.status !== undefined ? { status: args.status } : {}) },
          exec.signal,
        );
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
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => renderJson(value),
      },
      async execute(args, exec) {
        return client.advanceWorkItem(args.id, args.note, exec.signal);
      },
    }),

    defineTool({
      name: "list_sessions",
      description:
        "List OpenForge AI CLI sessions (tmux-backed terminal sessions) with adapter, project and status.",
      parameters: {},
      output: {
        schema: { type: "array", items: { type: "object", additionalProperties: true } },
        render: (_args, value) => renderJson(value),
      },
      async execute(_args, exec) {
        return client.listSessions(exec.signal);
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
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => renderJson(value),
      },
      async execute(args, exec) {
        return client.dispatchToSession(args.sessionId, args.message, exec.signal);
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
