import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository, type Project } from '../src/db/repositories/project-repository.js';
import { ProjectManagerRepository, type ProjectManagerWorkItem } from '../src/db/repositories/project-manager-repository.js';
import { SessionRepository, type Session } from '../src/db/repositories/session-repository.js';
import { attachDispatchSupervisor } from '../src/services/agent/dispatch-supervisor.js';
import { withTaskPacketDispatchedAt, withTaskPacketSessionLink } from '../src/services/project-manager/task-packets.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';

function fixture() {
    const db = new Database(':memory:');
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    const user = new UserRepository(db).create('supervisor@test.dev', 'hash');
    const project = new ProjectRepository(db, user.id).create({ name: 'p', path: '/tmp', aiTool: 'codex' });
    const pm = new ProjectManagerRepository(db, user.id);
    const sessions = new SessionRepository(db, user.id);
    const eventBus = new ForgeBadgerEventBus();
    const supervisor = attachDispatchSupervisor({ db, eventBus });
    return { db, user, project, pm, sessions, eventBus, supervisor };
}

function linkedDispatchedItem(pm: ProjectManagerRepository, sessions: SessionRepository, project: Project, title: string): { item: ProjectManagerWorkItem; session: Session } {
    const item = pm.createWorkItem(project.id, { title });
    const session = sessions.create({ projectId: project.id, name: 's', aiTool: 'codex', workingDir: '/tmp' });
    const linked = pm.updateWorkItem(project.id, item.id, { details: withTaskPacketSessionLink(item.details, session, project) });
    const dispatched = pm.updateWorkItem(project.id, item.id, { details: withTaskPacketDispatchedAt(linked.details, new Date().toISOString()) });
    pm.updateWorkItemStatus(project.id, item.id, { status: 'in_progress' });
    return { item: pm.getWorkItem(project.id, dispatched.id)!, session };
}

function notify(eventBus: ForgeBadgerEventBus, userId: string, session: Session, notificationType: string) {
    eventBus.emitEvent({
        type: 'claude_notification',
        userId,
        sessionId: session.id,
        projectId: session.projectId,
        hookEventName: notificationType === 'task_failed' ? 'StopFailure' : 'Stop',
        notificationType,
        message: `${notificationType} notification`
    });
}

describe('dispatch supervisor', () => {
    it('does not promote a legacy timestamp-only dispatch without a confirmed attempt receipt', () => {
        const { db, user, project, pm, sessions, eventBus, supervisor } = fixture();
        try {
            const { item, session } = linkedDispatchedItem(pm, sessions, project, 'Ship it');
            notify(eventBus, user.id, session, 'task_completed');
            assert.equal(pm.getWorkItem(project.id, item.id)?.status, 'in_progress');
            // A repeated Stop hook is a no-op: no transition back or duplicate ledger spam.
            notify(eventBus, user.id, session, 'task_completed');
            assert.equal(pm.getWorkItem(project.id, item.id)?.status, 'in_progress');
            const ledger = pm.listLedgerEvents(project.id, { workItemId: item.id });
            assert.equal(ledger.filter((event) => event.status === 'ready_for_review').length, 0);
        } finally { supervisor.stop(); db.close(); }
    });

    it('does not consume legacy failure hooks without a confirmed attempt receipt', () => {
        const { db, user, project, pm, sessions, eventBus, supervisor } = fixture();
        try {
            const { item, session } = linkedDispatchedItem(pm, sessions, project, 'Fail it');
            notify(eventBus, user.id, session, 'task_failed');
            assert.equal(pm.getWorkItem(project.id, item.id)?.status, 'in_progress');
        } finally { supervisor.stop(); db.close(); }
    });

    it('ignores sessions without a dispatched task packet link', () => {
        const { db, user, project, pm, sessions, eventBus, supervisor } = fixture();
        try {
            // Linked but never programmatically dispatched (no dispatchedAt).
            const item = pm.createWorkItem(project.id, { title: 'Manual work' });
            const session = sessions.create({ projectId: project.id, name: 's', aiTool: 'codex', workingDir: '/tmp' });
            pm.updateWorkItem(project.id, item.id, { details: withTaskPacketSessionLink(item.details, session, project) });
            pm.updateWorkItemStatus(project.id, item.id, { status: 'in_progress' });
            notify(eventBus, user.id, session, 'task_completed');
            assert.equal(pm.getWorkItem(project.id, item.id)?.status, 'in_progress');
            // Not linked at all.
            const unlinked = sessions.create({ projectId: project.id, name: 'u', aiTool: 'codex', workingDir: '/tmp' });
            notify(eventBus, user.id, unlinked, 'task_completed');
            assert.equal(pm.getWorkItem(project.id, item.id)?.status, 'in_progress');
        } finally { supervisor.stop(); db.close(); }
    });

    it('does not advance work items that are not in progress, and ignores unrelated notifications', () => {
        const { db, user, project, pm, sessions, eventBus, supervisor } = fixture();
        try {
            const item = pm.createWorkItem(project.id, { title: 'Todo work' });
            const session = sessions.create({ projectId: project.id, name: 's', aiTool: 'codex', workingDir: '/tmp' });
            const linked = pm.updateWorkItem(project.id, item.id, { details: withTaskPacketSessionLink(item.details, session, project) });
            pm.updateWorkItem(project.id, item.id, { details: withTaskPacketDispatchedAt(linked.details, new Date().toISOString()) });
            notify(eventBus, user.id, session, 'task_completed');
            assert.equal(pm.getWorkItem(project.id, item.id)?.status, 'todo');
            notify(eventBus, user.id, session, 'permission_prompt');
            assert.equal(pm.getWorkItem(project.id, item.id)?.status, 'todo');
        } finally { supervisor.stop(); db.close(); }
    });
});
