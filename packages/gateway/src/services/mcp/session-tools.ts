/**
 * External-only session tools: creating a new CLI or terminal session is an
 * MCP capability the native Copilot does not get (it drives its own project
 * shells through `terminal_open`). Execution is delegated to the `session.create`
 * platform command, so the call inherits intent/receipt idempotency, the
 * security policy, and token authority checks over the project root.
 */
import { adapterIds } from "../../lib/adapter-ids.js";
import { executeAgentAction } from "../platform-commands/agent-actions.js";
import { sessionCreateInput } from "../platform-commands/session-commands.js";
import type { AgentTool } from "../agent/tool-registry.js";

export function createMcpSessionTools(): AgentTool[] {
  return [
    {
      name: "create_session",
      description:
        "Create and launch a new AI CLI or terminal session in a project, returning the session row (id, name, aiTool, status). " +
        `aiTool is an adapter id (${adapterIds.join(", ")}) or "terminal" for a plain shell; shell selects the terminal shell (defaults to the platform shell). ` +
        "The session starts immediately in the project working directory and is owned by the token owner. " +
        "name defaults to the project name. Use start_session to relaunch a stopped session instead of creating a duplicate. " +
        "A stable operationId is required: inspect get_mcp_operation before retrying a failed launch.",
      risk: "operate",
      requiresApproval: true,
      inputSchema: sessionCreateInput,
      async execute(input, context) {
        return executeAgentAction("create_session", sessionCreateInput.parse(input), context);
      }
    }
  ];
}
