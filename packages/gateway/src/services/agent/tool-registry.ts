import { ARCHIVABLE_TOOLS, MAX_ARTIFACT_BYTES } from './tool-artifact-policy.js';
import { assertRestrictedTool } from "./restricted-runs.js";
import { zodToJsonSchema } from "./tool-schema.js";
import { redactAgentErrorMessage, redactAgentValue } from "./redaction.js";
import { checkAgentScope } from "../platform-commands/agent-scope.js";
import { executeAgentAction, TOOL_COMMANDS } from "../platform-commands/agent-actions.js";
/**
 * Tool registry for the Copilot harness.
 *
 * Every platform capability the model can invoke is a registered AgentTool.
 * Tools carry a risk tier: "read" tools execute freely, "operate" tools are
 * gated behind owner approval (the orchestration layer routes them to a
 * pending action and waits). All tool input is validated with a zod schema at
 * the boundary; output is size-capped so no single result can overflow the
 * model context.
 */
import { z } from "zod";
import type { AgentToolRisk } from "./types.js";
import type { RiskClass } from "./security-policy.js";

export interface AgentToolContext {
  userId: string;
  conversationId?: string;
  projectId?: string;
  db: import("../../db/types.js").Database;
  masterKey: string;
  [key: string]: unknown;
}

export interface AgentTool {
  name: string;
  description: string;
  risk: AgentToolRisk;
  requiresApproval: boolean;
  /** Advisory risk classification used by the security policy engine. */
  riskClass?: RiskClass;
  inputSchema: z.ZodType<unknown>;
  /** JSON-schema form handed to the model (anthropic/openai compatible). */
  modelInputSchema?: Record<string, unknown>;
  execute(input: unknown, context: AgentToolContext): Promise<unknown>;
}

export interface AgentToolRegistry {
  tools: Map<string, AgentTool>;
  toModelSchemas(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

export const MAX_TOOL_OUTPUT_BYTES = 48 * 1024;

export class AgentToolValidationError extends Error {
  readonly code = "agent_tool_validation_failed";
  constructor(message = "Tool input is invalid") {
    super(message);
    this.name = "AgentToolValidationError";
  }
}

export function createAgentToolRegistry(tools: AgentTool[]): AgentToolRegistry {
  const map = new Map(tools.map((t) => [t.name, t]));
  return {
    tools: map,
    toModelSchemas() {
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.modelInputSchema ?? zodToJsonSchema(t.inputSchema)
      }));
    }
  };
}

export function getAgentTool(registry: AgentToolRegistry, name: string): AgentTool | undefined {
  return registry.tools.get(name);
}

/**
 * Validate and execute a single tool call. Returns the (redacted + capped)
 * output. Throws AgentToolValidationError on bad input; execute errors are
 * returned as { ok: false } rather than thrown so the model can recover.
 */
export async function executeAgentTool(
  tool: AgentTool,
  rawInput: unknown,
  context: AgentToolContext
): Promise<{ ok: boolean; output?: unknown; error?: string; artifactContent?: string }> {
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AgentToolValidationError(tool.inputSchema.safeParse(rawInput).error?.message ?? "Tool input is invalid");
  }
  try {
    if (context.executionMode && tool.risk !== 'read' && !(context.executionMode === 'repair' && tool.name === 'submit_development_task')) throw new Error('COPILOT_RESTRICTED_TOOL: read-only tools required');
    assertRestrictedTool(context, tool.name, parsed.data);
    checkAgentScope(context, tool.name, parsed.data);
    const output = tool.risk === "operate" && TOOL_COMMANDS[tool.name]
      ? await executeAgentAction(tool.name, parsed.data, context)
: await tool.execute(parsed.data, context);
    const redacted = redactAgentValue(output);
    const serialized = JSON.stringify(redacted);
    const eligible = tool.risk === 'read' && ARCHIVABLE_TOOLS.has(tool.name);
    const oversized = serialized !== undefined && Buffer.byteLength(serialized) > MAX_TOOL_OUTPUT_BYTES;
    return { ok: true, output: capOutput(redacted, eligible),
      ...(eligible && oversized && Buffer.byteLength(serialized) <= MAX_ARTIFACT_BYTES ? { artifactContent: serialized } : {}) };
  } catch (error) {
    return { ok: false, error: redactAgentErrorMessage(error instanceof Error ? error.message : "Tool execution failed") };
  }
}

function capOutput(value: unknown, eligible: boolean): unknown {
  const json = JSON.stringify(value);
  if (json === undefined) return value;
  if (Buffer.byteLength(json, "utf8") <= MAX_TOOL_OUTPUT_BYTES) return value;
  // A small JSON-safe preview leaves room for metadata even with heavily escaped text.
  return { truncated: true, preview: `${json.slice(0, 4096)}…`, artifact: {
    status: eligible && Buffer.byteLength(json) > MAX_ARTIFACT_BYTES ? 'too_large' : 'unavailable',
    bytes: Buffer.byteLength(json),
  } };
}

export { zodToJsonSchema } from "./tool-schema.js";
