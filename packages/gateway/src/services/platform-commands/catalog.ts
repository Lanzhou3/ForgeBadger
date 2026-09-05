import { getAdapterLaunchStatus } from '../adapter-discovery.js';
import { createHash } from 'node:crypto';
import { createManagementCommands } from '../project-manager/management.js';
import { z } from 'zod';
import { mkdirSync, statSync } from 'node:fs';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { SessionRepository } from '../../db/repositories/session-repository.js';
import { ProjectManagerRepository } from '../../db/repositories/project-manager-repository.js';
import { AgentMemoryRepository } from '../agent/memory.js';
import { buildTaskPacket, createTaskPacketContext, createTaskPacketSessionName, resolveTaskPacketSession, withTaskPacketSessionLink, toTaskPacketSessionDto } from '../project-manager/task-packets.js';
import { createSessionCommands } from './session-commands.js';
import { assertAdapterAutonomy } from '../adapter-autonomy.js';
import { canonical, canonicalRoot } from './actions.js';
import type { CommandContext, PlatformCommand } from './types.js';
const id = z.string().min(1).max(128);
const projectInput = z.object({ projectId: id }).strict();
export const projectCreateInput = z.object({ name: z.string().trim().min(1).max(200), path: z.string().trim().min(1).max(1024), description: z.string().max(2000).optional(), techStack: z.string().max(2000).optional() }).strict();
export const workItemCreateInput = z.object({ projectId: id, title: z.string().min(1).max(256), description: z.string().max(4000).nullable().optional(), priority: z.number().int().min(0).max(100).optional(), acceptanceCriteria: z.array(z.string().max(1000)).max(50).optional(), stageId: id.nullable().optional() }).strict();
const evidenceRef = z.object({ kind: z.string().min(1).max(64).optional(), label: z.string().min(1).max(256).optional(), status: z.string().min(1).max(64).optional(), ref: z.string().min(1).max(512).optional(), path: z.string().min(1).max(512).optional(), sessionId: id.optional(), feishuChatId: id.optional(), feishuMessageId: id.optional(), createdAt: z.string().min(1).max(64).optional() }).strict();
const workItemWithEvidence = workItemCreateInput.extend({ status: z.literal('todo').optional(), evidenceRefs: z.array(evidenceRef).max(20).optional(), feishuRefs: z.array(evidenceRef).max(20).optional() });
export const workItemUpdateInput = z.object({ projectId: id, workItemId: id, title: z.string().min(1).max(256).optional(), description: z.string().max(4000).nullable().optional(), priority: z.number().int().min(0).max(100).optional(), acceptanceCriteria: z.array(z.string().max(1000)).max(50).optional(), stageId: id.nullable().optional() }).strict();
export const taskPrepareInput = z.object({ projectId: id, workItemId: id, aiTool: z.enum(['claude', 'opencode', 'codex', 'kimi']).optional() }).strict();
export const memoryWriteInput = z.object({ kind: z.enum(['fact', 'preference', 'decision', 'project_note']), scope: z.enum(['global', 'project', 'session']), text: z.string().min(1).max(8192), projectId: id.optional(), conversationId: id.optional(), metadata: z.record(z.unknown()).optional() }).strict();
function project(ctx: CommandContext, id: string) {
    const p = new ProjectRepository(ctx.db, ctx.userId).getById(id);
    if (!p)
        throw new Error('Project not found');
    return p;
}
function projectResources(ctx: CommandContext, input: unknown) {
    const { projectId } = projectInput.passthrough().parse(input);
    const p = project(ctx, projectId);
    return { projectIds: [projectId], revision: createHash('sha256').update(canonical(p)).digest('hex') };
}
function itemResources(ctx: CommandContext, input: unknown) {
    const v = z.object({ projectId: id, workItemId: id }).passthrough().parse(input);
    const p = project(ctx, v.projectId);
    const item = new ProjectManagerRepository(ctx.db, ctx.userId).getWorkItem(v.projectId, v.workItemId);
    if (!item)
        throw new Error('Work item not found');
    return { projectIds: [p.id], revision: createHash('sha256').update(canonical({ p, item })).digest('hex') };
}
function sessionResources(ctx: CommandContext, input: unknown) {
    const v = z.object({ sessionId: id }).passthrough().parse(input);
    const s = new SessionRepository(ctx.db, ctx.userId).getById(v.sessionId);
    if (!s)
        throw new Error('Session not found');
    project(ctx, s.projectId);
    return { projectIds: [s.projectId], revision: createHash('sha256').update(canonical(s)).digest('hex') };
}
function command<T>(c: Omit<PlatformCommand, 'capability'>): PlatformCommand {
    return { ...c, capability: c.id };
}
export function createPlatformCommands(): Map<string, PlatformCommand> {
    const commands: PlatformCommand[] = [
        command({ id: 'project.create', effect: 'external', delegatable: true, inputSchema: projectCreateInput,
            resolve(_ctx, input) {
                const v = projectCreateInput.parse(input);
                return { projectIds: [], rootPaths: [canonicalRoot(v.path)], revision: canonicalRoot(v.path) };
            },
            execute(ctx, input) {
                const v = projectCreateInput.parse(input);
                const root = canonicalRoot(v.path);
                mkdirSync(root, { recursive: true });
                if (!statSync(root).isDirectory())
                    throw new Error('Project root must be a directory');
                return new ProjectRepository(ctx.db, ctx.userId).create({ ...v, path: canonicalRoot(root), aiTool: '' });
            } }),
        command({ id: 'project.metadata.update', effect: 'database', delegatable: true, inputSchema: projectInput.extend({ name: z.string().min(1).max(200).optional(), description: z.string().max(2000).optional() }), resolve: projectResources,
            execute(ctx, input) {
                const v = z.object({ projectId: id, name: z.string().optional(), description: z.string().optional() }).parse(input);
                return new ProjectRepository(ctx.db, ctx.userId).updateMetadata(v.projectId, v);
            } }),
        command({ id: 'pm.work_item.create', effect: 'database', delegatable: true, inputSchema: workItemCreateInput, resolve: projectResources,
            execute(ctx, input) {
                const v = workItemCreateInput.parse(input);
                return new ProjectManagerRepository(ctx.db, ctx.userId).createWorkItem(v.projectId, v);
            } }),
        command({ id: 'pm.work_item.create_with_evidence', effect: 'database', delegatable: false, inputSchema: workItemWithEvidence, resolve: projectResources, execute(ctx, input) {
                const v = workItemWithEvidence.parse(input);
                return new ProjectManagerRepository(ctx.db, ctx.userId).createWorkItem(v.projectId, v);
            } }),
        command({ id: 'pm.work_item.update', effect: 'database', delegatable: false, inputSchema: workItemUpdateInput, resolve: itemResources,
            execute(ctx, input) {
                const v = workItemUpdateInput.parse(input);
                return new ProjectManagerRepository(ctx.db, ctx.userId).updateWorkItem(v.projectId, v.workItemId, v);
            } }),
        command({ id: 'pm.work_item.metadata', effect: 'database', delegatable: true, inputSchema: workItemUpdateInput.omit({ acceptanceCriteria: true, stageId: true }), resolve: itemResources,
            execute(ctx, input) {
                const v = workItemUpdateInput.omit({ acceptanceCriteria: true, stageId: true }).parse(input);
                return new ProjectManagerRepository(ctx.db, ctx.userId).updateWorkItem(v.projectId, v.workItemId, v);
            } }),
        command({ id: 'pm.task.prepare', effect: 'database', delegatable: true, inputSchema: taskPrepareInput, resolve: itemResources,
            async prepare(ctx, input) {
                const v = taskPrepareInput.parse(input);
                const adapter = z.enum(['claude', 'opencode', 'codex', 'kimi']).parse(v.aiTool ?? project(ctx, v.projectId).aiTool);
                const status = await getAdapterLaunchStatus(adapter, ctx.adapterCommandRunner);
                if (!status.launchEnabled)
                    throw new Error(`${status.label} is not available for launch`);
            },
            execute(ctx, input) {
                const v = taskPrepareInput.parse(input);
                const p = project(ctx, v.projectId);
                const repo = new ProjectManagerRepository(ctx.db, ctx.userId);
                let item = repo.getWorkItem(v.projectId, v.workItemId)!;
                let session = resolveTaskPacketSession(ctx.db, ctx.userId, p.id, item);
                const existed = !!session;
                if (!session) {
                    const adapter = z.enum(['claude', 'opencode', 'codex', 'kimi']).parse(v.aiTool ?? p.aiTool);
                    session = new SessionRepository(ctx.db, ctx.userId).create({ projectId: p.id, name: createTaskPacketSessionName(item.title), aiTool: adapter, workingDir: p.path, credentialMode: 'host_environment' });
                    item = repo.updateWorkItem(p.id, item.id, { details: withTaskPacketSessionLink(item.details, session, p, createTaskPacketContext(item, p)) });
                }
                return { taskPacket: buildTaskPacket({ project: p, workItem: item, session }), session: toTaskPacketSessionDto(session), existed };
            } }),
        command({ id: 'pm.task.execute', effect: 'external', delegatable: false, inputSchema: taskPrepareInput, resolve(ctx, input) {
                itemResources(ctx, input);
                assertAdapterAutonomy(taskPrepareInput.parse(input).aiTool ?? 'claude');
            }, execute() {
                throw new Error('CLI_AUTONOMY_MANUAL_ONLY');
            } }),
        command({ id: 'session.dispatch', effect: 'external', delegatable: false, inputSchema: z.object({ sessionId: id, message: z.string().min(1).max(4000) }).strict(), resolve(ctx, input) {
                sessionResources(ctx, input);
                assertAdapterAutonomy('claude');
            }, execute() {
                throw new Error('CLI_AUTONOMY_MANUAL_ONLY');
            } }),
        command({ id: 'memory.write', effect: 'database', delegatable: true, inputSchema: memoryWriteInput,
            resolve(ctx, input) {
                const v = memoryWriteInput.parse(input);
                if (v.scope === 'project') {
                    if (!v.projectId)
                        throw new Error('Project memory requires project');
                    return projectResources(ctx, v);
                }
                if (v.scope === 'session') {
                    if (!v.conversationId || !ctx.db.prepare('SELECT id FROM copilot_conversations WHERE user_id=? AND id=?').get(ctx.userId, v.conversationId))
                        throw new Error('Conversation not found');
                    return { projectIds: [], revision: v.conversationId };
                }
                return { projectIds: [], revision: 'global' };
            },
            execute(ctx, input) {
                const v = memoryWriteInput.parse(input);
                return new AgentMemoryRepository(ctx.db, ctx.userId).create({ kind: v.kind, scope: v.scope, text: v.text, ...(v.projectId ? { projectId: v.projectId } : {}), ...(v.conversationId ? { conversationId: v.conversationId } : {}), ...(v.metadata ? { metadata: v.metadata } : {}) });
            } })
    ];
    commands.push(...createSessionCommands(), ...createManagementCommands());
    return new Map(commands.map(c => [c.id, c]));
}
