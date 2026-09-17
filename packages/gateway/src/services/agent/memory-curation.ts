/**
 * Memory curation — the best-effort auto-digest seam.
 *
 * After a completed turn, the orchestrator fire-and-forgets a lightweight LLM
 * call that proposes durable memory entries (decisions / preferences / facts)
 * worth persisting. Writes go through the same scoped AgentMemoryRepository as
 * the model's own `write_memory` tool, and every failure is silent: curation
 * must never surface as a turn failure.
 *
 * Gated off by default via FORGEBADGER_COPILOT_MEMORY_CURATION so users opt in
 * to the extra model spend.
 */
import type { Database } from "../../db/types.js";
import type { AgentLlmClient } from "./orchestrator-types.js";
import { AgentMemoryRepository } from "./memory.js";

export interface ProposeMemoryInput {
  userText: string;
  assistantText: string;
  projectId?: string;
  conversationId?: string;
  canCommit?: () => boolean;
  signal?: AbortSignal;
  modelId?: string;
}

export interface MemoryProposalItem {
  kind: "fact" | "preference" | "decision" | "project_note";
  scope: "global" | "project" | "session";
  text: string;
  projectId?: string;
}

export interface MaybePersistMemoryOptions {
  db: Database;
  userId: string;
  llm: AgentLlmClient;
  userText: string;
  assistantText: string;
  projectId?: string;
  conversationId?: string;
  canCommit?: () => boolean;
  signal?: AbortSignal;
  modelId?: string;
}

export function isMemoryCurationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FORGEBADGER_COPILOT_MEMORY_CURATION === "1"
    || env.FORGEBADGER_COPILOT_MEMORY_CURATION?.toLowerCase() === "true";
}

export async function maybePersistMemory(options: MaybePersistMemoryOptions): Promise<void> {
  if (!isMemoryCurationEnabled()) return;
  let proposals: MemoryProposalItem[];
  try {
    proposals = await options.llm.proposeMemory({
      userText: options.userText,
      assistantText: options.assistantText,
      ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
      ...(options.signal ? { signal: options.signal } : {})
    });
  } catch {
    return;
  }
  if (!Array.isArray(proposals) || proposals.length === 0 || !(options.canCommit?.() ?? true)) return;

  const repo = new AgentMemoryRepository(options.db, options.userId);
  for (const item of proposals) {
    try {
      repo.create({
        kind: item.kind,
        scope: item.scope,
        text: item.text,
        ...(item.scope === "project" && options.projectId ? { projectId: options.projectId } : {}),
        ...(item.scope === "session" && options.conversationId ? { conversationId: options.conversationId } : {})
      });
    } catch {
      // Per-item write failure (empty text, bad scope) is dropped, not raised.
    }
  }
}
