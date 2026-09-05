import { PlatformNoEffectError } from "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { SessionRepository, type Session } from "../../db/repositories/session-repository.js";
import { ProjectRepository } from "../../db/repositories/project-repository.js";
import type { Database } from "../../db/types.js";
import { SessionConflictError } from "../session-manager.js";
import type { ForgeBadgerEventBus } from "../event-bus.js";
import { recordActivity } from "../activity-events.js";
import { recordSessionSnapshot } from "../session-snapshots.js";
import { getAdapterLaunchStatus } from "../adapter-discovery.js";
import { createLaunchPlan, normalizeAdapter, prepareAdapterLaunchExtras } from "../session-launch-plan.js";
import { canonical } from "./actions.js";
import type { CommandContext, PlatformCommand } from "./types.js";
const inputSchema = z.object({ sessionId: z.string().min(1).max(128) }).strict();
function resolve(ctx: CommandContext, input: unknown) {
    const { sessionId } = inputSchema.parse(input);
    const session = new SessionRepository(ctx.db, ctx.userId).getById(sessionId);
    if (!session || !new ProjectRepository(ctx.db, ctx.userId).getById(session.projectId))
        throw new Error("Session not found");
    return { projectIds: [session.projectId], revision: createHash("sha256").update(canonical(session)).digest("hex") };
}
export function createSessionCommands(): PlatformCommand[] {
    return ["start", "stop", "takeover"].map(action => ({
        id: `session.${action}`, capability: `session.${action}`, effect: "external", delegatable: action !== "takeover", inputSchema, resolve,
        prepare(ctx, input) {
            return preflight(ctx, inputSchema.parse(input).sessionId, action);
        },
        execute(ctx, input) {
            const { sessionId } = inputSchema.parse(input);
            if (action === "start")
                return start(ctx, sessionId);
            if (action === "stop")
                return stop(ctx, sessionId);
            if (!ctx.sessionManager)
                throw new Error("Session runtime unavailable");
            ctx.sessionManager.takeoverSession(ctx.userId, sessionId);
            return { sessionId, takenOver: true };
        }
    }));
}
async function preflight(ctx: CommandContext, sessionId: string, action: string) {
    const manager = ctx.sessionManager;
    if (!manager)
        throw new PlatformNoEffectError("Session runtime unavailable");
    const session = new SessionRepository(ctx.db, ctx.userId).getById(sessionId);
    if (!session)
        throw new PlatformNoEffectError("Session not found", 404);
    const live = manager.getSession(sessionId);
    if (action === 'start') {
        if (live?.status === 'running' || session.status === 'running')
            throw new PlatformNoEffectError("Session already running");
        const adapter = normalizeAdapter(session.aiTool);
        if (!adapter)
            throw new PlatformNoEffectError("Unsupported session adapter", 400);
        const status = await getAdapterLaunchStatus(adapter, ctx.adapterCommandRunner);
        if (!status.launchEnabled)
            throw new PlatformNoEffectError(`${status.label} is not available for launch`);
    }
    else if (action === 'stop' && !live && !session.tmuxSession)
        throw new PlatformNoEffectError("Session is not running");
    else if (action === 'takeover' && !live)
        throw new PlatformNoEffectError("Session is not running");
}
async function start(ctx: CommandContext, sessionId: string) {
    const { db, userId, eventBus, adapterCommandRunner } = ctx;
    const sessionManager = ctx.sessionManager;
    if (!sessionManager)
        throw new Error("Session runtime unavailable");
    const sessionRepo = new SessionRepository(db, userId);
    const dbSession = sessionRepo.getById(sessionId);
    if (!dbSession)
        throw new Error("Session not found");
    let effectsStarted = false;
    let authorizationPassed = true;
    const authorize = () => {
        authorizationPassed = false;
        ctx.authorize?.();
        authorizationPassed = true;
    };
    try {
        return await sessionManager.runExclusive(sessionId, async () => {
            // Re-check state inside the mutex (memory + DB), not just DB, to catch
            // concurrent starts. Conflict → 409 with a stable code.
            const live = sessionManager.getSession(sessionId);
            const fresh = sessionRepo.getById(sessionId);
            if (live?.status === "running" || fresh?.status === "running") {
                throw new SessionConflictError("Session already running");
            }
            const adapter = normalizeAdapter(dbSession.aiTool);
            if (!adapter) {
                const err = new Error("Unsupported session adapter");
                (err as Error & {
                    httpStatus?: number;
                }).httpStatus = 400;
                throw err;
            }
            const launchStatus = await getAdapterLaunchStatus(adapter, adapterCommandRunner);
            if (!launchStatus.launchEnabled) {
                const err = new Error(`${launchStatus.label} is not available for launch`);
                (err as Error & {
                    httpStatus?: number;
                }).httpStatus = 409;
                (err as Error & {
                    details?: unknown;
                }).details = {
                    adapter: launchStatus.id,
                    command: launchStatus.command,
                    status: launchStatus.status,
                    error: launchStatus.error
                };
                throw err;
            }
            authorize();
            effectsStarted = true;
            const pluginDirs = await prepareAdapterLaunchExtras(db, userId, adapter, dbSession.workingDir, dbSession.id);
            const launchPlan = createLaunchPlan({
                adapter,
                projectRoot: dbSession.workingDir,
                sessionId: dbSession.id,
                ...(pluginDirs.length > 0 ? { pluginDirs } : {})
            });
            const attachToken = randomUUID();
            authorize();
            sessionRepo.update(dbSession.id, { attachToken });
            const session = await sessionManager.createSession({
                userId,
                sessionId: dbSession.id,
                launchPlan,
                attachToken
            });
            const updatedSession = sessionRepo.update(dbSession.id, {
                status: "running",
                attachToken: session.attachToken,
                tmuxSession: session.tmuxName,
                lastActive: new Date()
            });
            recordSessionActivity(db, eventBus, userId, updatedSession ?? dbSession, "session_started", "success", `Session ${dbSession.name} started`);
            recordSessionSnapshot({
                db,
                userId,
                session: updatedSession ?? dbSession,
                metadata: { reason: "session_started" }
            });
            return safeSession(updatedSession ?? dbSession);
        });
    }
    catch (error) {
        if (!effectsStarted)
            throw new PlatformNoEffectError(error instanceof Error ? error.message : "Session precondition failed");
        if (!authorizationPassed)
            throw error;
        if (error instanceof SessionConflictError)
            throw error;
        sessionRepo.update(sessionId, { status: "error", attachToken: "", errorMessage: error instanceof Error ? error.message : String(error) });
        recordSessionActivity(db, eventBus, userId, dbSession, "session_error", "error", error instanceof Error ? error.message : "Session operation failed");
        eventBus?.emitEvent({ type: "session_status_changed", userId, sessionId, oldStatus: dbSession.status, newStatus: "error" });
        throw error;
    }
}
async function stop(ctx: CommandContext, sessionId: string) {
    const { db, userId, eventBus, adapterCommandRunner } = ctx;
    const sessionManager = ctx.sessionManager;
    if (!sessionManager)
        throw new Error("Session runtime unavailable");
    const sessionRepo = new SessionRepository(db, userId);
    const dbSession = sessionRepo.getById(sessionId);
    if (!dbSession)
        throw new Error("Session not found");
    let effectsStarted = false;
    if (sessionManager.getSession(sessionId)) {
        effectsStarted = true;
        sessionManager.cancelProgrammaticInput(userId, sessionId);
    }
    let authorizationPassed = true;
    const authorize = () => {
        authorizationPassed = false;
        ctx.authorize?.();
        authorizationPassed = true;
    };
    try {
        return await sessionManager.runExclusive(sessionId, async () => {
            const live = sessionManager.getSession(sessionId);
            const tmuxName = live?.tmuxName ?? dbSession.tmuxSession ?? undefined;
            if (!live && !tmuxName) {
                throw new SessionConflictError("Session is not running");
            }
            const oldStatus = live?.status ?? dbSession.status;
            authorize();
            effectsStarted = true;
            await sessionManager.stopSession(sessionId, tmuxName, userId);
            const updatedSession = sessionRepo.update(dbSession.id, {
                status: "exited",
                attachToken: "",
                tmuxSession: null,
                lastActive: new Date()
            });
            recordSessionActivity(db, eventBus, userId, updatedSession ?? dbSession, "session_stopped", "success", `Session ${dbSession.name} stopped`);
            return safeSession(updatedSession ?? dbSession);
        });
    }
    catch (error) {
        if (!effectsStarted)
            throw new PlatformNoEffectError(error instanceof Error ? error.message : "Session precondition failed");
        if (!authorizationPassed)
            throw error;
        if (error instanceof SessionConflictError)
            throw error;
        sessionRepo.update(sessionId, { status: "error", errorMessage: error instanceof Error ? error.message : String(error) });
        recordSessionActivity(db, eventBus, userId, dbSession, "session_error", "error", error instanceof Error ? error.message : "Session operation failed");
        eventBus?.emitEvent({ type: "session_status_changed", userId, sessionId, oldStatus: dbSession.status, newStatus: "error" });
        throw error;
    }
}
function recordSessionActivity(db: Database, eventBus: ForgeBadgerEventBus | undefined, userId: string, session: Session, type: string, status: "info" | "success" | "warning" | "error", message: string, metadata?: unknown): void {
    recordActivity({
        db,
        eventBus,
        userId,
        sessionId: session.id,
        projectId: session.projectId,
        type,
        status,
        message,
        metadata
    });
}
function safeSession(session: Session) {
    const { attachToken: _token, modelId: _model, apiKeyId: _key, credentialMode: _credential, ...safe } = session;
    return { ...safe, tmuxName: session.tmuxSession };
}
