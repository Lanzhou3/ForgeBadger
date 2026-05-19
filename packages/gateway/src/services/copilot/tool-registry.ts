import { z } from "zod";

import type { CommandRunner } from "../../lib/dependency-check.js";
import type { Database } from "../../db/types.js";
import type { CopilotServiceError } from "./types.js";
import { hasBlockedCopilotSensitiveOutput, hasCopilotPrivateKeyMaterial, redactCopilotPayload } from "./redaction.js";

export type CopilotToolRisk = "read" | "prepare" | "write";

export interface CopilotToolContext {
  db: Database;
  userId: string;
  masterKey: string;
  runId?: string;
  adapterCommandRunner?: CommandRunner;
  sessionManager?: {
    captureHistory(sessionId: string): Promise<string>;
    listSessions?(): Array<{
      id: string;
      status: string;
      tmuxName: string;
    }>;
  };
}

export interface CopilotToolDefinition {
  name: string;
  description: string;
  risk: CopilotToolRisk;
  requiresApproval: boolean;
  inputSchema: z.ZodType<unknown>;
  modelInputSchema?: Record<string, unknown>;
  execute(input: unknown, context: CopilotToolContext): Promise<unknown>;
}

export interface CopilotToolRegistry {
  tools: Map<string, CopilotToolDefinition>;
  readToolNames: string[];
}

export type ExecuteCopilotToolResult =
  | { ok: true; output: unknown; requiresApproval: boolean }
  | { ok: false; error: CopilotServiceError };

const MAX_COPILOT_TOOL_OUTPUT_BYTES = 64 * 1024;

export class CopilotToolValidationError extends Error {
  readonly code = "copilot_tool_validation_failed";

  constructor(message = "Copilot tool input is invalid") {
    super(message);
    this.name = "CopilotToolValidationError";
  }
}

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
  let output: unknown;
  try {
    output = await tool.execute(parsed.data, context);
  } catch (error) {
    if (error instanceof CopilotToolValidationError) {
      return fail(error.code, error.message);
    }
    return fail("copilot_tool_execution_failed", "Copilot tool execution failed");
  }
  const rawSerializedOutput = serializeToolOutput(output);
  const redactedOutput = redactCopilotPayload(output);
  if (hasCopilotPrivateKeyMaterial(rawSerializedOutput) || isBlockedToolOutput(redactedOutput)) {
    return fail("copilot_redaction_blocked_output", "Copilot tool output was blocked by safety policy");
  }
  return {
    ok: true,
    output: redactedOutput,
    requiresApproval: tool.requiresApproval
  };
}

export function toModelToolDefinitions(registry: CopilotToolRegistry) {
  return [...registry.tools.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.modelInputSchema ?? {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }));
}

function fail(code: string, message: string): { ok: false; error: CopilotServiceError } {
  return { ok: false, error: { code, message } };
}

function isBlockedToolOutput(output: unknown): boolean {
  const serialized = serializeToolOutput(output);
  if (Buffer.byteLength(serialized, "utf8") > MAX_COPILOT_TOOL_OUTPUT_BYTES) return true;
  return hasBlockedCopilotSensitiveOutput(serialized);
}

function serializeToolOutput(output: unknown): string {
  try {
    return JSON.stringify(output) ?? String(output);
  } catch {
    return "[unserializable]";
  }
}
