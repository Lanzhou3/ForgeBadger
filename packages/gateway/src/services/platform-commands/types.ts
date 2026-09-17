import type { z } from 'zod';
import type { Database } from '../../db/types.js';
import type { InMemorySessionManager } from '../session-manager.js';
export interface CommandContext {
    db: Database;
    authorize?: (() => void) | undefined;
    userId: string;
    sessionManager?: InMemorySessionManager;
    masterKey?: string;
    adapterCommandRunner?: import('../../lib/dependency-check.js').CommandRunner | undefined;
    eventBus?: import('../event-bus.js').ForgeBadgerEventBus | undefined;
}
export interface CommandResources {
    projectIds: string[];
    rootPaths?: string[];
    revision: string;
}
export interface PlatformCommand {
    id: string;
    capability: string;
    effect: 'database' | 'external';
    delegatable: boolean;
    inputSchema: z.ZodType<unknown>;
    prepare?(context: CommandContext, input: unknown): Promise<void>;
    resolve(context: CommandContext, input: unknown): CommandResources;
    execute(context: CommandContext, input: unknown): unknown | Promise<unknown>;
}
