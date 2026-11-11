import { assertRestrictedTool } from '../agent/restricted-runs.js';
import { SessionRepository } from '../../db/repositories/session-repository.js';
import { CopilotMachineRootRepository } from '../../db/repositories/copilot-machine-root-repository.js';
import type { AgentToolContext } from '../agent/tool-registry.js';
import { assertChannelToolScope } from '../channels/channel-run-scope.js';
import { ChannelIdentityError } from '../channels/channel-identity-service.js';
const INTERACTIVE_OWNER_TOOLS = new Set(['takeover_session', 'submit_development_task', 'cancel_development_task', 'accept_development_task']);
export function checkAgentScope(context: AgentToolContext, name: string, raw: unknown) {
    try {
        assertChannelToolScope(context, name, raw);
    } catch (error) {
        // The flat CHANNEL_AUTHORITY_REJECTED token leaves the model guessing what was
        // out of bounds; when a foreign session was named, say so and point at the
        // in-scope escape hatch (create_session) instead of a retry loop.
        if (error instanceof ChannelIdentityError) {
            const rawInput = raw as { sessionId?: unknown; projectId?: unknown };
            if (typeof rawInput.sessionId === 'string') {
                const session = new SessionRepository(context.db, context.userId).getById(rawInput.sessionId);
                throw new Error(`CHANNEL_AUTHORITY_REJECTED: that session${session ? ` belongs to project ${session.projectId}` : ''}, which is outside this run's selected project. Do not operate sessions of other projects; to launch a fresh one inside the selected project, use create_session.`);
            }
            if (typeof rawInput.projectId === 'string')
                throw new Error(`CHANNEL_AUTHORITY_REJECTED: project ${rawInput.projectId} is outside this run's selected project; operate resources inside the selected project only.`);
            throw new Error('CHANNEL_AUTHORITY_REJECTED: the requested resource is outside this run\'s authorized scope. Operate resources inside the selected project; playbooks and skill resources are project-agnostic and may be loaded from the skill catalog.');
        }
        throw error;
    }
    if (context.executionMode === 'repair') assertRestrictedTool(context,name,raw);
    if (name === 'machine_search' || name === 'read_machine_file' || name === 'machine_tree' || name === 'verify_retrieval_evidence') {
        const input = raw as { root?: string };
        if (typeof input.root !== 'string' || !new CopilotMachineRootRepository(context.db, context.userId).getById(input.root))
            throw new Error('MACHINE_ROOT_NOT_FOUND: register this local path first with register_machine_root');
    }
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
