import { PlatformNoEffectError } from "./errors.js";
import { stopSessionInput, resolveSessionStopTarget, assertSessionStopTargetLive, sessionExecutionScope } from "../session-stop-target.js";
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
import { createLaunchPlan, createTerminalLaunchPlan, checkTerminalShell, resolveAvailableTerminalShell, normalizeSessionKind, prepareAdapterLaunchExtras, TERMINAL_SHELLS } from "../session-launch-plan.js";
import { isNativeSessionResolvable, probeLatestNativeSessionId } from "../session-native-id.js";
import { adapterIds } from "../../lib/adapter-ids.js";
import { canonical } from "./actions.js";
import type { CommandContext, PlatformCommand } from "./types.js";
const inputSchema = z.object({ sessionId: z.string().min(1).max(128) }).strict();

/**
 * `session.start` input. `resume` is tri-state-free on purpose: omitted means
 * "resume the native session when one is known" (the card-click default),
 * `false` forces a fresh conversation and discards the stored handle.
 */
const startSessionInput = z.object({
    sessionId: z.string().min(1).max(128),
    resume: z.boolean().optional()
}).strict();

/**
 * `session.create` names the runtime kind explicitly (`aiTool` "terminal" for a
 * shell, or an adapter id). Projects with no `aiTool` cannot be resolved
 * implicitly here: the caller must say what to launch.
 */
export const sessionCreateInput = z.object({
    projectId: z.string().min(1).max(128),
    aiTool: z.enum([...adapterIds, "terminal"]),
    shell: z.enum(TERMINAL_SHELLS).optional(),
    /** Display name; defaults to the project name. */
    name: z.string().trim().min(1).max(200).optional()
}).strict();
export type SessionCreateInput = z.infer<typeof sessionCreateInput>;

function createProjectRoot(ctx: CommandContext, projectId: string) {
    const project = new ProjectRepository(ctx.db, ctx.userId).getById(projectId);
    if (!project)
        throw new PlatformNoEffectError("Project not found", 404);
    return project;
}

function createResources(ctx: CommandContext, input: unknown) {
    const v = sessionCreateInput.parse(input);
    const project = createProjectRoot(ctx, v.projectId);
    return { projectIds: [project.id], rootPaths: [project.path], revision: createHash("sha256").update(canonical(project)).digest("hex") };
}
function resolve(ctx: CommandContext, input: unknown, action: string) {
    const parsed = (action === "stop" ? stopSessionInput : action === "start" ? startSessionInput : inputSchema).parse(input);
    const { sessionId } = parsed;
    const session = new SessionRepository(ctx.db, ctx.userId).getById(sessionId);
    if (!session || !new ProjectRepository(ctx.db, ctx.userId).getById(session.projectId))
        throw new Error("Session not found");
    const stopTarget = action === "stop" ? resolveSessionStopTarget(ctx, stopSessionInput.parse(input)) : undefined;
    return { projectIds: [session.projectId], rootPaths: [session.workingDir], revision: createHash("sha256").update(canonical(session)).digest("hex"), ...(stopTarget ? { stopTarget } : {}) };
}
export function createSessionCommands(): PlatformCommand[] {
    return [createSessionCommand(), ...["start", "stop", "takeover"].map((action): PlatformCommand => ({
        id: `session.${action}`, capability: `session.${action}`, effect: "external", inputSchema: action === "stop" ? stopSessionInput : action === "start" ? startSessionInput : inputSchema,
        resolve: (ctx, input) => resolve(ctx, input, action),
        prepare(ctx, input) {
            return preflight(ctx, (action === "stop" ? stopSessionInput : action === "start" ? startSessionInput : inputSchema).parse(input).sessionId, action, input);
        },
        execute(ctx, input) {
            if (action === "start")
                return start(ctx, startSessionInput.parse(input));
            const { sessionId } = inputSchema.parse(input);
            if (action === "stop")
                return stop(ctx, stopSessionInput.parse(input));
            if (!ctx.sessionManager)
                throw new Error("Session runtime unavailable");
            ctx.sessionManager.takeoverSession(ctx.userId, sessionId);
            return { sessionId, takenOver: true };
        }
    }))];
}

/**
 * Create a session row and launch its runtime in one intent. The row is only
 * written after preflight passes and authority is re-authorized, so a refused
 * launch leaves no orphan session behind.
 */
function createSessionCommand(): PlatformCommand {
    return {
        id: "session.create", capability: "session.create", effect: "external", inputSchema: sessionCreateInput,
        resolve: (ctx, input) => createResources(ctx, input),
        prepare(ctx, input) {
            return preflightCreate(ctx, sessionCreateInput.parse(input));
        },
        execute(ctx, input) {
            return create(ctx, sessionCreateInput.parse(input));
        }
    };
}

async function preflightCreate(ctx: CommandContext, input: SessionCreateInput) {
    if (!ctx.sessionManager)
        throw new PlatformNoEffectError("Session runtime unavailable");
    createProjectRoot(ctx, input.projectId);
    const kind = normalizeSessionKind(input.aiTool);
    if (!kind)
        throw new PlatformNoEffectError("Unsupported session adapter", 400);
    if (kind === "terminal") {
        let shell = input.shell;
        if (!shell) {
            try { shell = await resolveAvailableTerminalShell(undefined, undefined, ctx.adapterCommandRunner); }
            catch (error) { throw new PlatformNoEffectError(error instanceof Error ? error.message : "No supported shell is installed"); }
        }
        const shellStatus = await checkTerminalShell(shell, undefined, undefined, ctx.adapterCommandRunner);
        if (!shellStatus.available)
            throw new PlatformNoEffectError(`${shell} is not available for launch`);
        return;
    }
    const status = await getAdapterLaunchStatus(kind, ctx.adapterCommandRunner, ctx.sessionManager?.terminalBackendHealth());
    if (!status.launchEnabled)
        throw new PlatformNoEffectError(`${status.label} is not available for launch`);
}

async function create(ctx: CommandContext, input: SessionCreateInput) {
    const { db, userId, eventBus, adapterCommandRunner } = ctx;
    const sessionManager = ctx.sessionManager;
    if (!sessionManager)
        throw new Error("Session runtime unavailable");
    const project = createProjectRoot(ctx, input.projectId);
    const kind = normalizeSessionKind(input.aiTool);
    if (!kind)
        throw new Error("Unsupported session adapter");
    const sessionRepo = new SessionRepository(db, userId);
    let effectsStarted = false;
    let created!: Session;
    let authorizationPassed = true;
    const authorize = () => {
        authorizationPassed = false;
        ctx.authorize?.();
        authorizationPassed = true;
    };
    try {
        // Everything that can still refuse the launch runs before the row
        // exists, so a rejected preflight leaves no orphan session.
        let shell;
        if (kind === "terminal") {
            shell = input.shell ?? await resolveAvailableTerminalShell(undefined, undefined, adapterCommandRunner);
            const shellStatus = await checkTerminalShell(shell, undefined, undefined, adapterCommandRunner);
            if (!shellStatus.available)
                throw new PlatformNoEffectError(`${shell} is not available for launch`);
        } else {
            const launchStatus = await getAdapterLaunchStatus(kind, adapterCommandRunner, sessionManager.terminalBackendHealth());
            if (!launchStatus.launchEnabled)
                throw new PlatformNoEffectError(`${launchStatus.label} is not available for launch`);
        }
        const pluginDirs = kind === "terminal" ? [] : await prepareAdapterLaunchExtras(db, userId, kind, project.path);
        authorize();
        const dbSession = sessionRepo.create({
            projectId: project.id,
            name: input.name ?? project.name,
            aiTool: kind,
            workingDir: project.path,
            credentialMode: "host_environment"
        });
        created = dbSession;
        effectsStarted = true;
        recordSessionActivity(db, eventBus, userId, dbSession, "session_created", "info", `Session ${dbSession.name} created`);
        // Launch plans embed the session id in FORGEBADGER_SESSION_ID, so they
        // are built only once the row (and therefore its id) exists.
        const launchPlan = kind === "terminal"
            ? createTerminalLaunchPlan({ projectRoot: dbSession.workingDir, sessionId: dbSession.id, ...(shell ? { shell } : {}) })
            : createLaunchPlan({ adapter: kind, projectRoot: dbSession.workingDir, sessionId: dbSession.id, ...(pluginDirs.length > 0 ? { pluginDirs } : {}) });
        const attachToken = randomUUID();
        authorize();
        sessionRepo.update(dbSession.id, { attachToken });
        const live = await sessionManager.createSession({ userId, sessionId: dbSession.id, launchPlan, attachToken });
        const updated = sessionRepo.update(dbSession.id, {
            status: "running",
            attachToken: live.attachToken,
            runtimeSessionName: live.runtimeSessionName,
            lastActive: new Date()
        });
        recordSessionActivity(db, eventBus, userId, updated ?? dbSession, "session_started", "success", `Session ${dbSession.name} started`);
        recordSessionSnapshot({ db, userId, session: updated ?? dbSession, metadata: { reason: "session_started" } });
        eventBus?.emitEvent({ type: "session_created", userId, sessionId: dbSession.id, projectId: project.id, name: dbSession.name });
        eventBus?.emitEvent({ type: "session_status_changed", userId, sessionId: dbSession.id, oldStatus: dbSession.status, newStatus: "running" });
        return safeSession(updated ?? dbSession);
    }
    catch (error) {
        if (!effectsStarted)
            throw new PlatformNoEffectError(error instanceof Error ? error.message : "Session precondition failed");
        if (!authorizationPassed)
            throw error;
        sessionRepo.update(created.id, { status: "error", attachToken: "", errorMessage: error instanceof Error ? error.message : String(error) });
        recordSessionActivity(db, eventBus, userId, created, "session_error", "error", error instanceof Error ? error.message : "Session creation failed");
        eventBus?.emitEvent({ type: "session_status_changed", userId, sessionId: created.id, oldStatus: created.status, newStatus: "error" });
        throw error;
    }
}
async function preflight(ctx: CommandContext, sessionId: string, action: string, input: unknown) {
    if (action === "stop") await assertSessionStopTargetLive(ctx, stopSessionInput.parse(input));
    const manager = ctx.sessionManager;
    if (!manager)
        throw new PlatformNoEffectError("Session runtime unavailable");
    const session = new SessionRepository(ctx.db, ctx.userId).getById(sessionId);
    if (!session)
        throw new PlatformNoEffectError("Session not found", 404);
    const live = manager.getSession(sessionId);
    if (action === 'start') {
        // A `running` status is only a real conflict if a pty is actually alive.
        // A stale claim (CLI exited with no attached terminal, or the daemon
        // restarted) must not block a restart — start proceeds and heals it.
        const claimsRunning = live?.status === 'running' || session.status === 'running';
        if (claimsRunning && await manager.hasLiveTerminal(sessionId, session.runtimeSessionName ?? undefined))
            throw new PlatformNoEffectError("Session already running");
        const kind = normalizeSessionKind(session.aiTool);
        if (!kind)
            throw new PlatformNoEffectError("Unsupported session adapter", 400);
        if (kind === "terminal") {
            let shell;
            try { shell = await resolveAvailableTerminalShell(undefined, undefined, ctx.adapterCommandRunner); }
            catch (error) { throw new PlatformNoEffectError(error instanceof Error ? error.message : "No supported shell is installed"); }
            const shellStatus = await checkTerminalShell(shell, undefined, undefined, ctx.adapterCommandRunner);
            if (!shellStatus.available)
                throw new PlatformNoEffectError(`${shell} is not available for launch`);
        } else {
            const adapter = kind;
            const status = await getAdapterLaunchStatus(adapter, ctx.adapterCommandRunner, ctx.sessionManager?.terminalBackendHealth());
            if (!status.launchEnabled)
                throw new PlatformNoEffectError(`${status.label} is not available for launch`);
        }
    }
    else if (action === 'stop' && !live && !session.runtimeSessionName)
        throw new PlatformNoEffectError("Session is not running");
    else if (action === 'takeover' && !live)
        throw new PlatformNoEffectError("Session is not running");
}
async function start(ctx: CommandContext, input: { sessionId: string; resume?: boolean | undefined }) {
    const { db, userId, eventBus, adapterCommandRunner } = ctx;
    const sessionManager = ctx.sessionManager;
    if (!sessionManager)
        throw new Error("Session runtime unavailable");
    const sessionRepo = new SessionRepository(db, userId);
    const dbSession = sessionRepo.getById(input.sessionId);
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
        return await sessionManager.runExclusive(input.sessionId, async () => {
            // Re-check state inside the mutex. A `running` claim is only a
            // conflict when a pty is genuinely alive; a stale claim (CLI exited
            // unobserved / daemon restart) is startable and gets healed by the
            // createSession below overwriting the row.
            const fresh = sessionRepo.getById(input.sessionId);
            if (
                (fresh?.status === "running") &&
                (await sessionManager.hasLiveTerminal(input.sessionId, fresh.runtimeSessionName ?? undefined))
            ) {
                throw new SessionConflictError("Session already running");
            }
            const kind = normalizeSessionKind(dbSession.aiTool);
            if (!kind) {
                const err = new Error("Unsupported session adapter");
                (err as Error & {
                    httpStatus?: number;
                }).httpStatus = 400;
                throw err;
            }
            let launchPlan;
            let resumeId: string | undefined;
            let handleWrite: string | null | undefined;
            if (kind === "terminal") {
                const shell = await resolveAvailableTerminalShell(undefined, undefined, adapterCommandRunner);
                const shellStatus = await checkTerminalShell(shell, undefined, undefined, adapterCommandRunner);
                if (!shellStatus.available) {
                    const err = new Error(`${shell} is not available for launch`);
                    (err as Error & {
                        httpStatus?: number;
                    }).httpStatus = 409;
                    (err as Error & {
                        details?: unknown;
                    }).details = { shell, command: shellStatus.command, error: shellStatus.error };
                    throw err;
                }
                authorize();
                effectsStarted = true;
                launchPlan = createTerminalLaunchPlan({
                    projectRoot: dbSession.workingDir,
                    sessionId: dbSession.id,
                    shell
                });
            } else {
                const adapter = kind;
                const launchStatus = await getAdapterLaunchStatus(adapter, adapterCommandRunner, sessionManager.terminalBackendHealth());
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
                const pluginDirs = await prepareAdapterLaunchExtras(db, userId, adapter, dbSession.workingDir);
                // Native session resume: the stored id (captured from CLI hooks)
                // wins; otherwise probe the CLI's local session store once. An
                // id whose artifact is gone is discarded and the session starts
                // fresh instead of failing. An explicit resume:false starts a
                // brand-new conversation and forgets the handle, because the
                // new process is the session from now on. The row write is
                // deferred past the final re-authorization (it is this
                // command's own effect, like the attach-token rotation).
                if (input.resume !== false) {
                    let candidate = dbSession.nativeSessionId;
                    if (!candidate)
                        candidate = (await probeLatestNativeSessionId(adapter, dbSession.workingDir)) ?? null;
                    if (candidate) {
                        if (await isNativeSessionResolvable(adapter, candidate, dbSession.workingDir)) {
                            resumeId = candidate;
                            if (candidate !== dbSession.nativeSessionId)
                                handleWrite = candidate;
                        } else if (dbSession.nativeSessionId) {
                            handleWrite = null;
                        }
                    }
                } else if (dbSession.nativeSessionId) {
                    handleWrite = null;
                }
                launchPlan = createLaunchPlan({
                    adapter,
                    projectRoot: dbSession.workingDir,
                    sessionId: dbSession.id,
                    ...(pluginDirs.length > 0 ? { pluginDirs } : {}),
                    ...(resumeId ? { resumeSessionId: resumeId } : {})
                });
            }
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
                runtimeSessionName: session.runtimeSessionName,
                lastActive: new Date()
            });
            if (kind !== "terminal" && handleWrite !== undefined)
                sessionRepo.update(dbSession.id, { nativeSessionId: handleWrite });
            recordSessionActivity(db, eventBus, userId, updatedSession ?? dbSession, resumeId ? "session_resumed" : "session_started", "success", resumeId ? `Session ${dbSession.name} resumed` : `Session ${dbSession.name} started`);
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
        sessionRepo.update(input.sessionId, { status: "error", attachToken: "", errorMessage: error instanceof Error ? error.message : String(error) });
        recordSessionActivity(db, eventBus, userId, dbSession, "session_error", "error", error instanceof Error ? error.message : "Session operation failed");
        eventBus?.emitEvent({ type: "session_status_changed", userId, sessionId: input.sessionId, oldStatus: dbSession.status, newStatus: "error" });
        throw error;
    }
}
/** Shared runtime launch path: session.start and pm.task.execute both spawn the CLI through here. */
export async function startSessionRuntime(ctx: CommandContext, sessionId: string) {
    return start(ctx, { sessionId });
}
async function stop(ctx: CommandContext, input: z.infer<typeof stopSessionInput>) {
    const { sessionId } = input;
    const { db, userId, eventBus, adapterCommandRunner } = ctx;
    const sessionManager = ctx.sessionManager;
    if (!sessionManager)
        throw new Error("Session runtime unavailable");
    const sessionRepo = new SessionRepository(db, userId);
    const dbSession = sessionRepo.getById(sessionId);
    if (!dbSession)
        throw new Error("Session not found");
    await assertSessionStopTargetLive(ctx, input);
    ctx.authorize?.();
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
            // Revalidate after any wait for an in-flight submission/lifecycle operation.
            await assertSessionStopTargetLive(ctx, input);
            const executionScope = sessionExecutionScope(dbSession, sessionManager);
            const live = sessionManager.getSession(sessionId);
            // Runtime session name (DB column `runtime_session_name`, historical naming).
            const runtimeSession = live?.runtimeSessionName ?? dbSession.runtimeSessionName ?? undefined;
            if (!live && !runtimeSession) {
                throw new SessionConflictError("Session is not running");
            }
            const oldStatus = live?.status ?? dbSession.status;
            authorize();
            effectsStarted = true;
            await sessionManager.stopSession(sessionId, runtimeSession, userId);
            const updatedSession = sessionRepo.update(dbSession.id, {
                status: "exited",
                attachToken: "",
                runtimeSessionName: null,
                lastActive: new Date()
            });
            recordSessionActivity(db, eventBus, userId, updatedSession ?? dbSession, "session_stopped", "success", `Session ${dbSession.name} stopped`);
            return { ...safeSession(updatedSession ?? dbSession), terminalStopped: true, stopScope: "terminal_process_group",
                externalExecutionStopped: null, ...(executionScope === "external_runtime_unverified" ? { warning: "CODEX_EXTERNAL_RUNTIME_UNVERIFIED: Only the terminal was stopped; a shared Codex daemon may still run the task and hold its thread lock." } : {}) };
        });
    }
    catch (error) {
        if (!effectsStarted)
            throw new PlatformNoEffectError(error instanceof Error ? error.message : "Session precondition failed");
        if (!authorizationPassed)
            throw error;
        if (error instanceof SessionConflictError)
            throw error;
        if (error instanceof PlatformNoEffectError) throw new Error(error.message);
        sessionRepo.update(sessionId, { status: "error", errorMessage: error instanceof Error ? error.message : String(error) });
        recordSessionActivity(db, eventBus, userId, dbSession, "session_error", "error", error instanceof Error ? error.message : "Session operation failed");
        eventBus?.emitEvent({ type: "session_status_changed", userId, sessionId, oldStatus: dbSession.status, newStatus: "error" });
        throw error;
    }
}
function recordSessionActivity(db: Database, eventBus: ForgeBadgerEventBus | undefined, userId: string, session: Session, type: string, status: "info" | "success" | "warning" | "error", message: string, metadata?: unknown): void {    recordActivity({
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
    return safe;
}
