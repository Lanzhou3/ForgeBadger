import { z } from "zod";

import type { CommandRunner } from "../../lib/dependency-check.js";
import type { Database } from "../../db/types.js";
import type { CopilotServiceError } from "./types.js";
import { redactCopilotPayload } from "./redaction.js";

export type CopilotToolRisk = "read" | "prepare" | "write";

export interface CopilotToolContext {
  db: Database;
  userId: string;
  masterKey: string;
  runId?: string;
  adapterCommandRunner?: CommandRunner;
}

export interface CopilotToolDefinition {
  name: string;
  description: string;
  risk: CopilotToolRisk;
  requiresApproval: boolean;
  inputSchema: z.ZodType<unknown>;
  execute(input: unknown, context: CopilotToolContext): Promise<unknown>;
}

export interface CopilotToolRegistry {
  tools: Map<string, CopilotToolDefinition>;
  readToolNames: string[];
}

export type ExecuteCopilotToolResult =
  | { ok: true; output: unknown; requiresApproval: boolean }
  | { ok: false; error: CopilotServiceError };

export function createCopilotToolRegistry(
  tools: CopilotToolDefinition[]
): CopilotToolRegistry {
  const entries = tools.map((tool) => [tool.name, tool] as const);
  const map = new Map(entries);
  return {
    tools: map,
    readToolNames: tools.filter((tool) => tool.risk === "read").map((tool) => tool.name)
  };
}

export async function executeCopilotTool(
  registry: CopilotToolRegistry,
  name: string,
  input: unknown,
  context: CopilotToolContext
): Promise<ExecuteCopilotToolResult> {
  const tool = registry.tools.get(name);
  if (!tool) return fail("copilot_tool_not_allowed", "Copilot tool is not allowed");
  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) return fail("copilot_tool_validation_failed", "Copilot tool input is invalid");
  const output = await tool.execute(parsed.data, context);
  return {
    ok: true,
    output: redactCopilotPayload(output),
    requiresApproval: tool.requiresApproval
  };
}

export function toModelToolDefinitions(registry: CopilotToolRegistry) {
  return [...registry.tools.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: { type: "object" }
  }));
}

function fail(code: string, message: string): { ok: false; error: CopilotServiceError } {
  return { ok: false, error: { code, message } };
}
