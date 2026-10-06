import { toolUnavailableReason } from "../agent/tool-availability.js";
/**
 * MCP (Model Context Protocol) bridge for the Gateway.
 *
 * External AI agents connect to the /mcp endpoint and invoke the same
 * platform tools the native Copilot uses. The bridge reuses the AgentTool
 * registry with MCP-only project preparation tools: zod validation, policy,
 * 48KB output cap, and — for operate tools — the platform command pipeline
 * (intent preview/decide/execute with durable receipts).
 *
 * Approval semantics: an MCP caller cannot complete the interactive approval
 * loop, so the `operate` scope on the access token is the owner's standing
 * authorization — intents are previewed and approved inline with
 * `owner_action` authority (the same authority the Web console uses).
 * Operations the security policy marks as high-risk approval-gated are
 * refused except for root-bound project creation. Tools disabled in the Copilot
 * capability settings are hidden and rejected here too.
 */
import { randomUUID } from "node:crypto";
import { PlatformActionRepository } from "../../db/repositories/platform-action-repository.js";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { CopilotToolPreferenceRepository } from "../../db/repositories/copilot-tool-preference-repository.js";
import { McpTokenRepository, type McpTokenScope } from "../../db/repositories/mcp-token-repository.js";
import { SessionRepository } from "../../db/repositories/session-repository.js";
import { ProjectRepository } from "../../db/repositories/project-repository.js";
import { ProjectManagerRepository, type ProjectManagerWorkItem } from "../../db/repositories/project-manager-repository.js";
import type { Database } from "../../db/types.js";
import type { CommandRunner } from "../../lib/dependency-check.js";
import { createSecurityPolicy, logSecurityDecision, type SecurityPolicyInput } from "../agent/security-policy.js";
import { redactAgentErrorMessage, redactAgentValue } from "../agent/redaction.js";
import {
  executeAgentTool,
  zodToJsonSchema,
  type AgentTool,
  type AgentToolContext
} from "../agent/tool-registry.js";
import { createPlatformTools } from "../agent/tools/index.js";
import { createMcpProjectTools } from "../agent/tools/projects.js";
import { agentActionInput, agentActions, TOOL_COMMANDS } from "../platform-commands/agent-actions.js";
import { canonicalRoot } from "../platform-commands/actions.js";
import { checkAgentScope } from "../platform-commands/agent-scope.js";
import type { InMemorySessionManager } from "../session-manager.js";
import { resolveTaskPacketSession } from "../project-manager/task-packets.js";
import { assertMcpTokenAuthority } from "./token-authority.js";

const MCP_CLI_TOOLS = new Set(["pm_execute_task_packet", "import_project", "apply_project_config", "list_templates", "preview_project_config"]);
const MCP_SCOPED_TOOLS = new Set([
  "list_projects", "get_project", "list_sessions", "get_session", "get_session_output", "get_session_writer",
  "list_templates", "preview_project_config", "create_project", "import_project",
  "apply_project_config", "pm_create_work_item", "pm_update_work_item",
  "pm_prepare_task_packet", "pm_execute_task_packet", "pm_get_task_packet",
  "pm_list_task_packets", "pm_get_task_progress", "pm_close_task",
  "pm_get_goal", "pm_get_work_item", "pm_get_management", "pm_list_ledger", "pm_update_management",
  "list_project_files", "read_project_file", "project_graph_search",
  "project_graph_symbol_detail", "project_graph_impact", "project_graph_affected_paths",
  "start_session", "stop_session", "update_project"
]);
// Existing-project grants cannot create new project identities or read global catalogs.
const MCP_SELECTED_PROJECT_EXCLUDED = new Set(["create_project", "import_project", "list_templates"]);

// A new Copilot capability must not silently expand existing external credentials.
// Listing, execution lookup and discovery use this same explicit capability table.
const MCP_ALLOWED_TOOLS = new Set([...MCP_SCOPED_TOOLS,
  'get_project_git_status', 'read_project_diff', 'research_project', 'search_project_files',
  'list_development_tasks', 'get_development_task', 'pm_overview', 'list_playbooks',
  'load_playbook', 'read_skill_resource', 'search_memory', 'list_memory', 'write_memory', 'get_usage_summary'
]);

function usesSelectedProjects(deps: McpBridgeDeps): boolean {
  return new McpTokenRepository(deps.db).findActiveById(deps.tokenId, deps.userId)?.allowedProjects != null;
}

const operationIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

export interface McpBridgeDeps {
  db: Database;
  masterKey: string;
  userId: string;
  tokenId: string;
  scopes: McpTokenScope[];
  appVersion: string;
  sessionManager?: InMemorySessionManager | undefined;
  adapterCommandRunner?: CommandRunner | undefined;
}

export function buildMcpServer(deps: McpBridgeDeps): Server {
  const preferences = new CopilotToolPreferenceRepository(deps.db, deps.userId);
  const canOperate = deps.scopes.includes("operate");
  const canDispatch = canOperate && deps.scopes.includes("cli_dispatch");
  const selectedProjects = usesSelectedProjects(deps);
  const scoped = canDispatch || selectedProjects;
  const candidates = [...createPlatformTools(), ...createMcpProjectTools()];
  const tools = candidates.filter(
    (tool) => MCP_ALLOWED_TOOLS.has(tool.name) && (tool.risk === "read" || canOperate) && preferences.isEnabled(tool.name) && !toolUnavailableReason(tool.name, !!deps.sessionManager) && (!MCP_CLI_TOOLS.has(tool.name) || canDispatch) && (!scoped || MCP_SCOPED_TOOLS.has(tool.name)) && (!selectedProjects || !MCP_SELECTED_PROJECT_EXCLUDED.has(tool.name))
  );
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

  const server = new Server(
    { name: "forgebadger-gateway", version: deps.appVersion },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: mcpInputSchema(tool, canDispatch)
    })), ...(canDispatch ? [{ name: "get_mcp_operation", description: "Read the durable receipt for a prior MCP operationId without replaying it.", inputSchema: { type: "object", properties: { operationId: { type: "string" } }, required: ["operationId"], additionalProperties: false } }] : [])]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "get_mcp_operation" && canDispatch) {
      try {
        const operationId = (request.params.arguments as { operationId?: unknown } | undefined)?.operationId;
        if (typeof operationId !== "string" || !operationIdPattern.test(operationId)) throw new Error("Invalid operationId");
        assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId);
        const actions = new PlatformActionRepository(deps.db, deps.userId);
        const intent = actions.byKey(mcpOperationKey(deps.tokenId, operationId));
        if (!intent) return { content: [{ type: "text" as const, text: JSON.stringify({ found: false }) }] };
        assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId, JSON.parse(intent.resources_json));
        const receipt = actions.receipt(intent.id);
        return { content: [{ type: "text" as const, text: JSON.stringify({ found: true, intentId: intent.id, status: intent.status, receipt: receipt ? { outcome: receipt.outcome, createdAt: receipt.createdAt } : null }) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: redactAgentErrorMessage(error instanceof Error ? error.message : "Tool execution failed") }] };
      }
    }
    const tool = toolsByName.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Unknown or unavailable tool: ${request.params.name}` }]
      };
    }
    try {
      const output = await executeMcpTool(tool, request.params.arguments ?? {}, deps);
      return { content: [{ type: "text" as const, text: JSON.stringify(redactAgentValue(output)) }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: redactAgentErrorMessage(error instanceof Error ? error.message : "Tool execution failed") }]
      };
    }
  });

  return server;
}

async function executeMcpTool(tool: AgentTool, rawInput: unknown, deps: McpBridgeDeps): Promise<unknown> {
  assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId);
  const hasCliScope = deps.scopes.includes("cli_dispatch");
  const selectedProjects = usesSelectedProjects(deps);
  const scoped = hasCliScope || selectedProjects;
  const operationId = tool.risk === "operate" && hasCliScope && rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
    ? (rawInput as Record<string, unknown>).operationId : undefined;
  if (tool.risk === "operate" && hasCliScope && (typeof operationId !== "string" || !operationIdPattern.test(operationId))) {
    throw new Error("A stable operationId is required for MCP writes");
  }
  const toolInput = operationId === undefined ? rawInput : Object.fromEntries(Object.entries(rawInput as Record<string, unknown>).filter(([key]) => key !== "operationId"));
  const parsed = tool.inputSchema.safeParse(toolInput);
  if (!parsed.success) {
    throw new Error("Tool input is invalid");
  }
  if (scoped && tool.risk === "read") assertMcpReadInput(deps, tool.name, parsed.data);

  const context: AgentToolContext = {
    userId: deps.userId,
    db: deps.db,
    masterKey: deps.masterKey,
    ...(scoped && (tool.name === "list_projects" || tool.name === "list_sessions") ? { allowedProjectIds: allowedMcpProjectIds(deps) } : {}),
    externalAuthorize: (resources?: import("../platform-commands/types.js").CommandResources) => assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId, resources),
    availableToolNames: [...createPlatformTools(), ...createMcpProjectTools()].filter(candidate =>
      (candidate.risk === "read" || deps.scopes.includes("operate")) &&
      new CopilotToolPreferenceRepository(deps.db, deps.userId).isEnabled(candidate.name) &&
      !toolUnavailableReason(candidate.name, !!deps.sessionManager) &&
      MCP_ALLOWED_TOOLS.has(candidate.name) &&
      (!MCP_CLI_TOOLS.has(candidate.name) || (deps.scopes.includes("operate") && hasCliScope)) &&
      (!scoped || MCP_SCOPED_TOOLS.has(candidate.name)) &&
      (!selectedProjects || !MCP_SELECTED_PROJECT_EXCLUDED.has(candidate.name))
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
  const rootScopedCreate = tool.name === "create_project" && hasCliScope && typeof (parsed.data as { path?: unknown }).path === "string";
  if (rootScopedCreate) {
    assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId, { projectIds: [], rootPaths: [canonicalRoot((parsed.data as { path: string }).path)], revision: "" });
  }
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
    (decision.action === "require_approval" && decision.riskClass === "high" && !rootScopedCreate)
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
      idempotencyKey: typeof operationId === "string" ? mcpOperationKey(deps.tokenId, operationId) : randomUUID()
    });
    context.platformIntentId = intent.id;
  }

  const result = await executeAgentTool(tool, parsed.data, context);
  if (!result.ok) {
    throw new Error(result.error ?? "Tool execution failed");
  }
  if (typeof context.platformIntentId === "string") {
    const receipt = new PlatformActionRepository(deps.db, deps.userId).receipt(context.platformIntentId);
    if (receipt && receipt.outcome !== "confirmed") throw new Error(`MCP operation outcome ${receipt.outcome}; inspect get_mcp_operation before retrying`);
  }
  if (scoped && tool.risk === "read") {
    assertMcpReadInput(deps, tool.name, parsed.data);
    return filterMcpReadOutput(deps, tool.name, result.output);
  }
  return result.output;
}

function assertMcpReadInput(deps: McpBridgeDeps, name: string, input: unknown): void {
  const values = input as { projectId?: unknown; sessionId?: unknown; workItemId?: unknown; limit?: unknown };
  if (typeof values.projectId === "string") {
    assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId, { projectIds: [values.projectId], revision: "" });
    const repo = new ProjectManagerRepository(deps.db, deps.userId);
    if (name === "pm_list_task_packets") {
      const items = repo.listWorkItems(values.projectId, typeof values.limit === "number" ? { limit: values.limit } : {});
      for (const item of items) assertMcpTaskSession(deps, values.projectId, item);
    } else if (["pm_get_task_packet", "pm_get_task_progress", "pm_get_work_item"].includes(name) && typeof values.workItemId === "string") {
      const item = repo.getWorkItem(values.projectId, values.workItemId);
      if (item) assertMcpTaskSession(deps, values.projectId, item);
    }
    return;
  }
  if (typeof values.sessionId === "string") {
    const session = new SessionRepository(deps.db, deps.userId).getById(values.sessionId);
    if (session) assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId, {
      projectIds: [session.projectId], rootPaths: [session.workingDir], revision: ""
    });
    return;
  }
  if (!["list_projects", "list_sessions", "list_templates"].includes(name)) throw new Error("MCP read requires a project or session ID");
}

function assertMcpTaskSession(deps: McpBridgeDeps, projectId: string, item: ProjectManagerWorkItem): void {
  const session = resolveTaskPacketSession(deps.db, deps.userId, projectId, item);
  if (!session) return;
  assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId, {
    projectIds: [projectId], rootPaths: [session.workingDir], revision: ""
  });
}

function filterMcpReadOutput(deps: McpBridgeDeps, name: string, value: unknown): unknown {
  if (name !== "list_projects" && name !== "list_sessions") return value;
  const result = value as Record<string, unknown>;
  const key = name === "list_projects" ? "projects" : "sessions";
  const rows = result[key];
  if (!Array.isArray(rows)) throw new Error("Scoped MCP list is too large; narrow the request");
  const visible = rows.filter((row: unknown) => {
    if (!row || typeof row !== "object") return false;
    const record = row as { id?: unknown; projectId?: unknown };
    const projectId = name === "list_projects" ? record.id : record.projectId;
    if (typeof projectId !== "string") return false;
    try {
      const session = name === "list_sessions" && typeof record.id === "string"
        ? new SessionRepository(deps.db, deps.userId).getById(record.id)
        : undefined;
      if (name === "list_sessions" && !session) return false;
      assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId, {
        projectIds: [projectId], ...(session ? { rootPaths: [session.workingDir] } : {}), revision: ""
      });
      return true;
    } catch { return false; }
  });
  assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId);
  return { ...result, [key]: visible, count: visible.length };
}

function allowedMcpProjectIds(deps: McpBridgeDeps): string[] {
  const ids: string[] = [];
  for (const project of new ProjectRepository(deps.db, deps.userId).list()) {
    try {
      assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId, { projectIds: [project.id], revision: "" });
      ids.push(project.id);
    } catch { /* Only canonical projects in the token root are listed. */ }
  }
  assertMcpTokenAuthority(deps.db, deps.userId, deps.tokenId);
  return ids;
}

function mcpOperationKey(tokenId: string, operationId: string): string {
  return `mcp:${tokenId}:${operationId}`;
}

function mcpInputSchema(tool: AgentTool, hasCliScope: boolean): Record<string, unknown> {
  const schema = tool.modelInputSchema ?? zodToJsonSchema(tool.inputSchema);
  if (tool.risk !== "operate" || !hasCliScope) return schema;
  return {
    ...schema,
    properties: { ...(schema.properties as Record<string, unknown> | undefined), operationId: { type: "string", description: "Stable caller-generated ID; reuse on retry and inspect get_mcp_operation before any new attempt." } },
    required: [...(Array.isArray(schema.required) ? schema.required : []), "operationId"]
  };
}
