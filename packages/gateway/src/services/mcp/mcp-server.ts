import { toolUnavailableReason } from "../agent/tool-availability.js";
/**
 * MCP (Model Context Protocol) bridge for the Gateway.
 *
 * External AI agents connect to the /mcp endpoint and invoke the same
 * platform tools the native Copilot uses. The bridge reuses the AgentTool
 * registry as-is: zod input validation, the security policy engine, the
 * 48KB output cap, and — for operate tools — the platform command pipeline
 * (intent preview/decide/execute with durable receipts).
 *
 * Approval semantics: an MCP caller cannot complete the interactive approval
 * loop, so the `operate` scope on the access token is the owner's standing
 * authorization — intents are previewed and approved inline with
 * `owner_action` authority (the same authority the Web console uses).
 * Operations the security policy marks as high-risk approval-gated are
 * refused instead of auto-approved. Tools the owner disabled in the Copilot
 * capability settings are hidden and rejected here too.
 */
import { randomUUID } from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { CopilotToolPreferenceRepository } from "../../db/repositories/copilot-tool-preference-repository.js";
import type { McpTokenScope } from "../../db/repositories/mcp-token-repository.js";
import type { Database } from "../../db/types.js";
import type { CommandRunner } from "../../lib/dependency-check.js";
import { createSecurityPolicy, logSecurityDecision, type SecurityPolicyInput } from "../agent/security-policy.js";
import {
  executeAgentTool,
  zodToJsonSchema,
  type AgentTool,
  type AgentToolContext
} from "../agent/tool-registry.js";
import { createPlatformTools } from "../agent/tools/index.js";
import { agentActionInput, agentActions, TOOL_COMMANDS } from "../platform-commands/agent-actions.js";
import { checkAgentScope } from "../platform-commands/agent-scope.js";
import type { InMemorySessionManager } from "../session-manager.js";

/** CLI-control tools stay Copilot-only: MCP tokens never dispatch into terminals. */
const MCP_EXCLUDED_TOOLS = new Set(["dispatch_task_to_session", "pm_execute_task_packet"]);

export interface McpBridgeDeps {
  db: Database;
  masterKey: string;
  userId: string;
  scopes: McpTokenScope[];
  appVersion: string;
  sessionManager?: InMemorySessionManager | undefined;
  adapterCommandRunner?: CommandRunner | undefined;
}

export function buildMcpServer(deps: McpBridgeDeps): Server {
  const preferences = new CopilotToolPreferenceRepository(deps.db, deps.userId);
  const canOperate = deps.scopes.includes("operate");
  const tools = createPlatformTools().filter(
    (tool) => (tool.risk === "read" || canOperate) && preferences.isEnabled(tool.name) && !toolUnavailableReason(tool.name, !!deps.sessionManager) && !MCP_EXCLUDED_TOOLS.has(tool.name)
  );
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

  const server = new Server(
    { name: "forgebadger-gateway", version: deps.appVersion },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.modelInputSchema ?? zodToJsonSchema(tool.inputSchema)
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolsByName.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Unknown or unavailable tool: ${request.params.name}` }]
      };
    }
    try {
      const output = await executeMcpTool(tool, request.params.arguments ?? {}, deps);
      return { content: [{ type: "text" as const, text: JSON.stringify(output) }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Tool execution failed" }]
      };
    }
  });

  return server;
}

async function executeMcpTool(tool: AgentTool, rawInput: unknown, deps: McpBridgeDeps): Promise<unknown> {
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error("Tool input is invalid");
  }

  const context: AgentToolContext = {
    userId: deps.userId,
    db: deps.db,
    masterKey: deps.masterKey,
    availableToolNames: createPlatformTools().filter(candidate =>
      (candidate.risk === "read" || deps.scopes.includes("operate")) &&
      new CopilotToolPreferenceRepository(deps.db, deps.userId).isEnabled(candidate.name) &&
      !toolUnavailableReason(candidate.name, !!deps.sessionManager) &&
      !MCP_EXCLUDED_TOOLS.has(candidate.name)
    ).map(candidate=>candidate.name),
    ...(deps.sessionManager ? { sessionManager: deps.sessionManager } : {}),
    ...(deps.adapterCommandRunner ? { adapterCommandRunner: deps.adapterCommandRunner } : {})
  };
  checkAgentScope(context, tool.name, parsed.data);

  // Session-scoped memory is bound to a Copilot conversation, which does not
  // exist for MCP callers; fail with an actionable message instead of the
  // platform command's bare "Conversation not found".
  if (tool.name === "write_memory" && (parsed.data as { scope?: string }).scope === "session") {
    throw new Error("Session-scoped memory requires a Copilot conversation; use scope 'global' or 'project' over MCP");
  }

  const policy = createSecurityPolicy();
  const policyInput: SecurityPolicyInput = {
    userId: deps.userId,
    toolName: tool.name,
    toolRisk: tool.risk,
    requiresApproval: tool.requiresApproval,
    input: parsed.data
  };
  const decision = policy.evaluate(policyInput);
  logSecurityDecision({
    db: deps.db,
    userId: deps.userId,
    operation: tool.name,
    input: parsed.data,
    action: decision.action,
    reason: decision.reason
  });
  // The operate scope on the token authorizes low/medium approval-gated calls
  // (there is no human in the loop to approve them). High-risk operations the
  // policy says a human must confirm are refused outright instead.
  if (
    decision.action === "deny" ||
    (decision.action === "require_approval" && decision.riskClass === "high")
  ) {
    throw new Error(`Denied by security policy: ${decision.reason}`);
  }

  if (tool.risk === "operate") {
    const commandId = TOOL_COMMANDS[tool.name];
    if (!commandId) {
      throw new Error("Tool requires interactive approval and is unavailable over MCP");
    }
    const actions = agentActions(context);
    const intent = actions.preview({
      commandId,
      input: agentActionInput(tool.name, parsed.data, context),
      idempotencyKey: randomUUID()
    });
    context.platformIntentId = intent.id;
  }

  const result = await executeAgentTool(tool, parsed.data, context);
  if (!result.ok) {
    throw new Error(result.error ?? "Tool execution failed");
  }
  return result.output;
}
