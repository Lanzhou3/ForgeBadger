/**
 * Memory tools for the Copilot harness. The model can search what it remembers
 * about the platform/projects and write durable facts, preferences, decisions,
 * and project notes. Writes are scoped and read-tool only (no approval needed
 * to record a memory).
 *
 * Queries and writes use the native Copilot platform-access service.
 */
import { z } from "zod";
import {
  listMemoryEntries,
  searchMemoryEntries,
  writeMemoryEntry
} from "../platform-access.js";
import type { Database } from "../../../db/types.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";

const searchMemoryInput = z.object({
  query: z.string().min(1).max(512),
  scope: z.enum(["global", "project", "session"]).default("global"),
  projectId: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(20).optional()
}).strict();

const writeMemoryInput = z.object({
  kind: z.enum(["fact", "preference", "decision", "project_note"]),
  scope: z.enum(["global", "project", "session"]),
  text: z.string().min(1).max(8 * 1024),
  projectId: z.string().max(128).optional(),
  metadata: z.record(z.unknown()).optional()
}).strict();

const listMemoryInput = z.object({
  scope: z.enum(["global", "project", "session"]).default("global"),
  projectId: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(50).optional()
}).strict();

function toolDb(context: AgentToolContext): { db: Database; userId: string } {
  return { db: context.db as Database, userId: context.userId as string };
}

export function createMemoryTools(): AgentTool[] {
  return [
    {
      name: "search_memory",
      description: "Search Copilot's scoped memory (global, project, or session) by keyword.",
      risk: "read",
      requiresApproval: false,
      inputSchema: searchMemoryInput,
      async execute(input, context) {
        const { query, scope, projectId, limit } = searchMemoryInput.parse(input);
        const { db, userId } = toolDb(context);
        const entries = searchMemoryEntries(db, userId, {
          query,
          scope,
          ...(projectId !== undefined ? { projectId } : {}),
          ...(limit !== undefined ? { limit } : {})
        });
        return { entries };
      }
    },
    {
      name: "list_memory",
      description: "List Copilot's memory entries in a scope.",
      risk: "read",
      requiresApproval: false,
      inputSchema: listMemoryInput,
      async execute(input, context) {
        const { scope, projectId, limit } = listMemoryInput.parse(input);
        const { db, userId } = toolDb(context);
        const entries = listMemoryEntries(db, userId, {
          scope,
          ...(projectId !== undefined ? { projectId } : {}),
          ...(limit !== undefined ? { limit } : {})
        });
        return { entries };
      }
    },
    {
      name: "write_memory",
      description: "Record a durable memory entry (fact, preference, decision, or project note).",
      risk: "read",
      requiresApproval: false,
      inputSchema: writeMemoryInput,
      async execute(input, context) {
        const { kind, scope, text, projectId, metadata } = writeMemoryInput.parse(input);
        const { db, userId } = toolDb(context);
        return writeMemoryEntry(db, userId, {
          kind,
          scope,
          text,
          ...(projectId !== undefined ? { projectId } : {}),
          ...(metadata !== undefined ? { metadata } : {})
        });
      }
    }
  ];
}
