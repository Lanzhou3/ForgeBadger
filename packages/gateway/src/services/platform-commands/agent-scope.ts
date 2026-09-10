import { CopilotGrantRepository } from '../../db/repositories/copilot-grant-repository.js';
import { SessionRepository } from '../../db/repositories/session-repository.js';
import { listProjectSummaries, listSessionSummaries } from '../agent/platform-access.js';
import type { AgentToolContext } from '../agent/tool-registry.js';
const GLOBAL_TOOLS = new Set(['list_skills', 'load_skill', 'get_usage_summary']);
export function grantedToolVisible(name: string) {
    return !GLOBAL_TOOLS.has(name);
}
export function checkAgentScope(context: AgentToolContext, name: string, raw: unknown) {
    const grantId = context.grantId as string | undefined;
    if (!grantId)
        return;
    const g = new CopilotGrantRepository(context.db, context.userId).get(grantId);
    if (!g || g.status !== 'active' || g.expiresAt <= Date.now())
        throw new Error('Grant unavailable, expired or revoked');
    if (!grantedToolVisible(name))
        throw new Error('Global capability unavailable in project grant');
    const input = raw as Record<string, unknown>;
    let projectId = typeof input.projectId === 'string' ? input.projectId : undefined;
    if (typeof input.sessionId === 'string') {
        const s = new SessionRepository(context.db, context.userId).getById(input.sessionId);
        if (!s)
            throw new Error('Session not found');
        if (projectId && projectId !== s.projectId)
            throw new Error('Session project mismatch');
        projectId = s.projectId;
    }
    if (projectId && !g.scope.projectIds.includes(projectId))
        throw new Error('Project outside grant scope');
    if ((name === 'search_memory' || name === 'list_memory' || name === 'write_memory') && (input.scope === undefined || input.scope === 'global'))
        throw new Error('Global memory unavailable in project grant');
}
export function scopedListResult(context: AgentToolContext, name: string, raw: unknown): unknown | undefined {
    const grantId = context.grantId as string | undefined;
    if (!grantId)
        return undefined;
    const g = new CopilotGrantRepository(context.db, context.userId).get(grantId)!;
    const v = raw as {
        limit?: number;
        projectId?: string;
    };
    if (name === 'list_projects') {
        const projects = listProjectSummaries(context.db, context.userId, {allowedProjectIds:g.scope.projectIds,limit:v.limit??100});
        return { projects, count: projects.length };
    }
    if (name === 'list_sessions') {
        const sessions = listSessionSummaries(context.db,context.userId,{allowedProjectIds:g.scope.projectIds,limit:v.limit??100,...(v.projectId?{projectId:v.projectId}:{})});
        return { sessions, count: sessions.length };
    }
    return undefined;
}
