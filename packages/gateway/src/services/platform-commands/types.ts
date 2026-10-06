import type { z } from 'zod';
import type { Database } from '../../db/types.js';
import type { InMemorySessionManager } from '../session-manager.js';
export interface CommandContext {
    signal?: AbortSignal | undefined;
    db: Database;
    actionIntentId?: string;
    actionOrigin?: import('../../db/repositories/platform-action-repository.js').ActionOrigin;
    authorize?: (() => void) | undefined;
    externalAuthorize?: ((resources?: CommandResources) => void) | undefined;
    /** Trusted command only: checkpoint its own synchronous resource mutation. */
    checkpointResources?: (() => void) | undefined;
    userId: string;
    sessionManager?: InMemorySessionManager;
    masterKey?: string;
    adapterCommandRunner?: import('../../lib/dependency-check.js').CommandRunner | undefined;
    eventBus?: import('../event-bus.js').ForgeBadgerEventBus | undefined;
    runId?: string | undefined;
    stepId?: string | undefined;
    conversationId?: string | undefined;
}
export interface CommandResources {
    stopTarget?: import("../session-stop-target.js").SessionStopTarget;
    projectIds: string[];
    /** Exact session-memory resource, derived from the durable Copilot origin. */
    conversationId?: string;
    rootPaths?: string[];
    revision: string;
}
export interface CopilotApprovalRevalidation {
    runId: string;
    stepId: string;
    pendingActionId: string;
    commandId: string;
    /** Original platform input, including trusted session-memory conversation injection. */
    input: unknown;
    inputDigest: string;
    source: 'user' | 'reactive' | 'scheduled';
    /** Web decisions may renew admission; channel decisions retain their signed expiry. */
    refreshExpiry: boolean;
}
export interface PlatformCommand {
    id: string;
    capability: string;
    effect: 'database' | 'external';
    inputSchema: z.ZodType<unknown>;
    prepare?(context: CommandContext, input: unknown): Promise<void>;
    resolve(context: CommandContext, input: unknown): CommandResources;
    execute(context: CommandContext, input: unknown): unknown | Promise<unknown>;
}
