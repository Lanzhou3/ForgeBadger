import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { SessionSnapshotRepository, type SessionSnapshot } from "../db/repositories/session-snapshot-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../db/repositories/session-repository.js";
import { recordActivity } from "../services/activity-events.js";
import { recordSessionSnapshot } from "../services/session-snapshots.js";
import {
  createLaunchPlan,
  normalizeAdapter,
  prepareAdapterLaunchExtras
} from "./sessions.js";
import type { Database } from "../db/types.js";
import type { InMemorySessionManager } from "../services/session-manager.js";
import type { OpenForgeEventBus } from "../services/event-bus.js";
import type { CommandRunner } from "../lib/dependency-check.js";
import { getAdapterLaunchStatus } from "../services/adapter-discovery.js";

const listSnapshotSchema = z.object({
  sessionId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional()
});

export function createSnapshotRoutes(
  db: Database,
  masterKey: string,
  sessionManager: InMemorySessionManager,
  eventBus?: OpenForgeEventBus,
  adapterCommandRunner?: CommandRunner
): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = listSnapshotSchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const snapshots = new SessionSnapshotRepository(db, userId)
      .list(parseResult.data)
      .map(toSnapshotPayload);
    res.json({
      code: 0,
      data: { snapshots },
      message: ""
    });
  });

  router.post("/:id/restore", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const snapshotRepo = new SessionSnapshotRepository(db, userId);
    const snapshot = snapshotRepo.getById(req.params.id);
    if (!snapshot) {
      res.status(404).json({ code: 1, message: "Snapshot not found" });
      return;
    }

    try {
      const restored = await restoreSnapshot({
        db,
        masterKey,
        userId,
        snapshot,
        sessionManager,
        eventBus,
        adapterCommandRunner
      });
      res.json({
        code: 0,
        data: {
          session: toSessionPayload(restored.session, restored.attachToken),
          mode: restored.mode
        },
        message: ""
      });
    } catch (error) {
      res.status(409).json({
        code: 1,
        message: error instanceof Error ? error.message : "Snapshot restore failed"
      });
    }
  });

  return router;
}

interface RestoreSnapshotInput {
  db: Database;
  masterKey: string;
  userId: string;
  snapshot: SessionSnapshot;
  sessionManager: InMemorySessionManager;
  eventBus?: OpenForgeEventBus | undefined;
  adapterCommandRunner?: CommandRunner | undefined;
}

async function restoreSnapshot(input: RestoreSnapshotInput): Promise<{
  session: Session;
  attachToken: string;
  mode: "attach_tmux" | "recreate_session";
}> {
  const sessionRepo = new SessionRepository(input.db, input.userId);
  const projectRepo = new ProjectRepository(input.db, input.userId);
  const existingSession = input.snapshot.sessionId
    ? sessionRepo.getById(input.snapshot.sessionId)
    : undefined;
  const projectId = input.snapshot.projectId ?? existingSession?.projectId;
  if (!projectId) {
    throw new Error("Snapshot is missing project metadata");
  }
  const project = projectRepo.getById(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const baseSession = existingSession ?? sessionRepo.create({
    projectId: project.id,
    name: project.name,
    aiTool: project.aiTool,
    workingDir: project.path,
    ...(input.snapshot.modelId ? { modelId: input.snapshot.modelId } : {}),
    ...(input.snapshot.agentId ? { agentId: input.snapshot.agentId } : {}),
    credentialMode: "host_environment"
  });
  if (baseSession.status === "running") {
    throw new Error("Session is already running");
  }

  const adapter = normalizeAdapter(baseSession.aiTool || project.aiTool);
  if (!adapter) {
    throw new Error("Unsupported session adapter");
  }
  const launchStatus = await getAdapterLaunchStatus(adapter, input.adapterCommandRunner);
  if (!launchStatus.launchEnabled) {
    throw new Error(`${launchStatus.label} is not available for launch`);
  }

  const nextModelId = input.snapshot.modelId ?? baseSession.modelId ?? undefined;
  const nextAgentId = input.snapshot.agentId ?? baseSession.agentId ?? undefined;
  if (nextModelId || nextAgentId) {
    sessionRepo.update(baseSession.id, {
      modelId: nextModelId ?? null,
      ...(nextAgentId !== undefined ? { agentId: nextAgentId } : {})
    });
  }
  const pluginDirs = await prepareAdapterLaunchExtras(
    input.db,
    input.userId,
    adapter,
    baseSession.workingDir,
    baseSession.id
  );
  const launchPlan = createLaunchPlan({
    db: input.db,
    userId: input.userId,
    masterKey: input.masterKey,
    adapter,
    projectRoot: baseSession.workingDir,
    sessionId: baseSession.id,
    credentialMode: baseSession.credentialMode,
    ...(baseSession.apiKeyId ? { apiKeyId: baseSession.apiKeyId } : {}),
    ...(nextModelId ? { modelId: nextModelId } : {}),
    ...(pluginDirs.length > 0 ? { pluginDirs } : {})
  });

  const live = input.snapshot.tmuxSession
    ? await tryAttachExistingSession(input, baseSession, launchPlan)
    : undefined;
  const mode = live ? "attach_tmux" : "recreate_session";
  let session = live;
  if (!session) {
    const attachToken = randomUUID();
    sessionRepo.update(baseSession.id, { attachToken });
    try {
      session = await input.sessionManager.createSession({
        userId: input.userId,
        sessionId: baseSession.id,
        launchPlan,
        attachToken
      });
    } catch (error) {
      sessionRepo.update(baseSession.id, { attachToken: "" });
      throw error;
    }
  }
  const updated = sessionRepo.update(baseSession.id, {
    status: "running",
    attachToken: session.attachToken,
    tmuxSession: session.tmuxName,
    lastActive: new Date()
  }) ?? baseSession;

  recordActivity({
    db: input.db,
    eventBus: input.eventBus,
    userId: input.userId,
    sessionId: updated.id,
    projectId: updated.projectId,
    type: "snapshot_restored",
    status: "success",
    message: `Snapshot restored for ${updated.name}`,
    metadata: { snapshotId: input.snapshot.id, mode }
  });
  recordSessionSnapshot({
    db: input.db,
    userId: input.userId,
    session: updated,
    metadata: { reason: "snapshot_restored", restoredFromSnapshotId: input.snapshot.id, mode }
  });

  return { session: updated, attachToken: session.attachToken, mode };
}

async function tryAttachExistingSession(
  input: RestoreSnapshotInput,
  session: Session,
  launchPlan: ReturnType<typeof createLaunchPlan>
) {
  if (!input.snapshot.tmuxSession) {
    return undefined;
  }
  try {
    return await input.sessionManager.attachExistingSession({
      userId: input.userId,
      sessionId: session.id,
      tmuxName: input.snapshot.tmuxSession,
      launchPlan,
      ...(session.attachToken ? { attachToken: session.attachToken } : {})
    });
  } catch {
    return undefined;
  }
}

function toSnapshotPayload(snapshot: SessionSnapshot) {
  return {
    id: snapshot.id,
    sessionId: snapshot.sessionId,
    projectId: snapshot.projectId,
    tmuxSession: snapshot.tmuxSession,
    modelId: snapshot.modelId,
    agentId: snapshot.agentId,
    configVersion: snapshot.configVersion,
    metadata: parseMetadata(snapshot.metadata),
    createdAt: snapshot.createdAt.toISOString()
  };
}

function toSessionPayload(session: Session, attachToken?: string): Omit<Session, "attachToken"> & {
  attachToken?: string;
} {
  const { attachToken: _attachToken, ...safe } = session;
  return {
    ...safe,
    ...(attachToken ? { attachToken } : {})
  };
}

function parseMetadata(metadata: string | null): unknown {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata);
  } catch {
    return null;
  }
}
