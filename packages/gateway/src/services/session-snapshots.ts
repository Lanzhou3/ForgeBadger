import { SessionSnapshotRepository, type SessionSnapshot } from "../db/repositories/session-snapshot-repository.js";
import type { Session } from "../db/repositories/session-repository.js";
import type { Database } from "../db/types.js";

export interface RecordSessionSnapshotInput {
  db: Database;
  userId: string;
  session: Session;
  configVersion?: string | undefined;
  metadata?: unknown;
}

export function recordSessionSnapshot(input: RecordSessionSnapshotInput): SessionSnapshot {
  const metadata = normalizeMetadata(input.metadata);
  return new SessionSnapshotRepository(input.db, input.userId).create({
    sessionId: input.session.id,
    projectId: input.session.projectId,
    tmuxSession: input.session.tmuxSession,
    modelId: input.session.modelId,
    configVersion: input.configVersion,
    metadata: {
      ...metadata,
      adapter: input.session.aiTool
    }
  });
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
}
