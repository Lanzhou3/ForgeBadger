import { PlatformActions } from './actions.js';
import { createPlatformCommands } from './catalog.js';
import type { AgentToolContext } from '../agent/tool-registry.js';
import type { CommandContext } from './types.js';
import { TOOL_COMMANDS } from "./tool-commands.js";
export { TOOL_COMMANDS } from "./tool-commands.js";
export function agentActionInput(name: string, input: unknown, context: AgentToolContext) {
    return name === 'write_memory' ? { ...(input as object), ...((input as {
            scope?: string;
        }).scope === 'session' ? { conversationId: context.conversationId } : {}) } : input;
}
export function agentActions(context: AgentToolContext) {
    return new PlatformActions({ db: context.db, userId: context.userId, masterKey: context.masterKey, ...(context.sessionManager ? { sessionManager: context.sessionManager as NonNullable<CommandContext['sessionManager']> } : {}), ...(context.adapterCommandRunner ? { adapterCommandRunner: context.adapterCommandRunner as CommandContext['adapterCommandRunner'] } : {}) }, createPlatformCommands());
}
export async function executeAgentAction(name: string, input: unknown, context: AgentToolContext) {
    const actions = agentActions(context);
    const intentId = context.platformIntentId;
    if (typeof intentId !== 'string')
        throw new Error('Platform write requires an approved action intent');
    const i = actions.intents.get(intentId);
    if (!i || i.command_id !== TOOL_COMMANDS[name])
        throw new Error('Platform action command mismatch');
    const result = (await actions.execute(intentId)).result;
    if (name === 'create_project')
        return { created: true, ...result as object };
    if (name === 'pm_start_task_packet')
        return { prepared: true, ...result as object };
    return result;
}
