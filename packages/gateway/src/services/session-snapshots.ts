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
  return new SessionSnapshotRepository(input.db, input.userId).create({
    sessionId: input.session.id,
    projectId: input.session.projectId,
    tmuxSession: input.session.tmuxSession,
    modelId: input.session.modelId,
    agentId: input.session.agentId,
    configVersion: input.configVersion,
    metadata: input.metadata
  });
}
