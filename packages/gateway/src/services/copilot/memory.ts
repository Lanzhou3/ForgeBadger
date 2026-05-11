import { z } from "zod";

import { CopilotMemoryRepository } from "../../db/repositories/copilot-memory-repository.js";
import { CopilotRepository, type CopilotPendingAction } from "../../db/repositories/copilot-repository.js";
import { redactCopilotPayload, redactCopilotText } from "./redaction.js";
import type { CopilotToolContext, CopilotToolDefinition } from "./tool-registry.js";

const memoryScopeSchema = z.enum(["global", "project", "session"]);
const memoryKindSchema = z.enum(["fact", "preference", "decision", "project_note"]);
const memorySearchInput = z.object({
  query: z.string().trim().min(1).max(512),
  scope: memoryScopeSchema.optional(),
  projectId: z.string().min(1).nullable().optional(),
  includeNotes: z.boolean().optional(),
  limit: z.number().int().min(1).max(20).optional()
}).strict();
const memoryGetInput = z.object({
  id: z.string().min(1),
  type: z.enum(["entry", "note"]).default("entry")
}).strict();
const proposeMemoryWriteInput = z.object({
  kind: memoryKindSchema,
  scope: memoryScopeSchema,
  text: z.string().trim().min(1).max(8 * 1024),
  projectId: z.string().min(1).nullable().optional(),
  metadata: z.record(z.unknown()).optional()
}).strict();

export function createCopilotMemoryTools(): CopilotToolDefinition[] {
  return [
    {
      name: "openforge.memory_search",
      description: "Search explicit tenant-scoped Copilot memory entries and optional working notes.",
      risk: "read",
      requiresApproval: false,
      inputSchema: memorySearchInput,
      execute: async (input, context) => searchMemory(input, context)
    },
    {
      name: "openforge.memory_get",
      description: "Read one tenant-scoped Copilot memory entry or working note by id.",
      risk: "read",
      requiresApproval: false,
      inputSchema: memoryGetInput,
      execute: async (input, context) => getMemory(input, context)
    },
    {
      name: "openforge.propose_memory_write",
      description: "Prepare a durable Copilot memory write for explicit user approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeMemoryWriteInput,
      execute: async (input, context) => proposeMemoryWrite(input, context)
    }
  ];
}

export function approveCopilotMemoryWrite(
  action: CopilotPendingAction,
  context: Pick<CopilotToolContext, "db" | "userId">
) {
  const parsed = proposeMemoryWriteInput.safeParse(action.input);
  if (!parsed.success) {
    return {
      executed: false,
      error: {
        code: "copilot_memory_write_invalid",
        message: "Stored memory write action is invalid"
      }
    };
  }
  const entry = new CopilotMemoryRepository(context.db, context.userId).createEntry({
    kind: parsed.data.kind,
    scope: parsed.data.scope,
    text: parsed.data.text,
    projectId: parsed.data.projectId ?? null,
    sourceRunId: action.runId,
    metadata: safeMetadata(parsed.data.metadata)
  });
  return { executed: true, entry };
}

async function searchMemory(input: unknown, context: CopilotToolContext) {
  const parsed = memorySearchInput.parse(input);
  return {
    results: new CopilotMemoryRepository(context.db, context.userId).search({
      query: parsed.query,
      ...(parsed.scope ? { scope: parsed.scope } : {}),
      ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
      includeNotes: parsed.includeNotes ?? false,
      limit: parsed.limit ?? 10
    })
  };
}

async function getMemory(input: unknown, context: CopilotToolContext) {
  const parsed = memoryGetInput.parse(input);
  const repo = new CopilotMemoryRepository(context.db, context.userId);
  const item = parsed.type === "note" ? repo.getNote(parsed.id) : repo.getEntry(parsed.id);
  return { type: parsed.type, item };
}

async function proposeMemoryWrite(input: unknown, context: CopilotToolContext) {
  const parsed = proposeMemoryWriteInput.parse(input);
  if (!context.runId) throw new Error("Copilot run is required for pending actions");
  const redactedInput = {
    kind: parsed.kind,
    scope: parsed.scope,
    text: redactCopilotText(parsed.text),
    ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
    ...(parsed.metadata ? { metadata: safeMetadata(parsed.metadata) } : {})
  };
  const pending = new CopilotRepository(context.db, context.userId).createPendingAction(context.runId, {
    type: "openforge.propose_memory_write",
    input: redactedInput
  });
  return {
    actionId: pending.id,
    type: pending.type,
    status: pending.status,
    summary: "Pending user approval"
  };
}

function safeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const redacted = redactCopilotPayload(metadata ?? {});
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return {};
  return redacted as Record<string, unknown>;
}
