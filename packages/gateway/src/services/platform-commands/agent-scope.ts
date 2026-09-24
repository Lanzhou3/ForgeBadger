import { SessionRepository } from '../../db/repositories/session-repository.js';
import type { AgentToolContext } from '../agent/tool-registry.js';
const INTERACTIVE_OWNER_TOOLS = new Set(['takeover_session', 'submit_development_task', 'cancel_development_task', 'accept_development_task']);
export function checkAgentScope(context: AgentToolContext, name: string, raw: unknown) {
    if (!INTERACTIVE_OWNER_TOOLS.has(name))
        return;
    if (context.source !== 'user')
        throw new Error('This operation requires direct interactive owner authority');
    const input = raw as { projectId?: string; sessionId?: string };
    if (typeof input.sessionId === 'string') {
        const s = new SessionRepository(context.db, context.userId).getById(input.sessionId);
        if (!s)
            throw new Error('Session not found');
        if (input.projectId !== undefined && input.projectId !== s.projectId)
            throw new Error('Session project mismatch');
    }
}
