import { checkAgentScope, scopedListResult } from "../platform-commands/agent-scope.js";
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
): Promise<{ ok: boolean; output?: unknown; error?: string }> {
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AgentToolValidationError(tool.inputSchema.safeParse(rawInput).error?.message ?? "Tool input is invalid");
  }
  try {
    checkAgentScope(context, tool.name, parsed.data);
    const scoped = scopedListResult(context, tool.name, parsed.data);
    const output = tool.risk === "operate" && TOOL_COMMANDS[tool.name]
      ? await executeAgentAction(tool.name, parsed.data, context)
      : scoped !== undefined ? scoped : await tool.execute(parsed.data, context);
    return { ok: true, output: capOutput(output) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Tool execution failed" };
  }
}

function capOutput(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (json === undefined) return value;
  if (Buffer.byteLength(json, "utf8") <= MAX_TOOL_OUTPUT_BYTES) return value;
  // Truncate the stringified form to the byte cap, preserving valid JSON shape
  // as a { truncated: true } envelope.
  const cut = Buffer.from(json, "utf8").subarray(0, MAX_TOOL_OUTPUT_BYTES).toString("utf8");
  return { truncated: true, preview: `${cut}…` };
}

/** Convert a zod schema to a JSON schema (best-effort for the model surface). */
export function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  return zodToJsonSchemaInner(schema);
}

function zodToJsonSchemaInner(schema: z.ZodType<unknown>): Record<string, unknown> {
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJsonSchemaInner(schema.element) };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType<unknown>>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchemaInner(value);
      if (!(value instanceof z.ZodOptional)) required.push(key);
    }
    return { type: "object", properties, ...(required.length ? { required } : {}) };
  }
  if (schema instanceof z.ZodOptional) return zodToJsonSchemaInner(schema.unwrap());
  if (schema instanceof z.ZodNullable) return { ...zodToJsonSchemaInner(schema.unwrap()), nullable: true };
  if (schema instanceof z.ZodNull) return { type: "null" };
  if (schema instanceof z.ZodDefault) return zodToJsonSchemaInner(schema.removeDefault());
  if (schema instanceof z.ZodEffects) return zodToJsonSchemaInner(schema.innerType());
  if (schema instanceof z.ZodUnion) {
    const options = schema.options as readonly z.ZodType<unknown>[];
    return { anyOf: options.map((option) => zodToJsonSchemaInner(option)) };
  }
  return { type: "object" };
}
