import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { createPlatformCommands } from '../src/services/platform-commands/catalog.js';
import { readTaskPacketDetails, withTaskPacketSessionLink } from '../src/services/project-manager/task-packets.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';

// Programmatic CLI dispatch is not gated by any per-project or per-adapter
// switch: there is deliberately no allowlist, every code CLI (Claude Code,
// OpenCode, Codex, Kimi Code, PI, MiniMax Code) is equal. Copilot-origin
// dispatch is scoped to the session's project and tenant; owner-origin
// dispatch is the owner acting directly. Projectless copilot commands still
// require the Web console.

function fixture() {
    const db = new Database(':memory:');
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    const user = new UserRepository(db).create('dispatch@test.dev', 'hash');
    const project = new ProjectRepository(db, user.id).create({ name: 'p', path: '/tmp', aiTool: 'codex' });
    const sessions = new SessionRepository(db, user.id);
    return { db, user, project, sessions };
}

function codexManager(options: { stage?: boolean } = {}) {
    const stage = options.stage ?? true;
    let pane = '› Ask Codex to do anything\n\nmodel · cwd';
    const state = { enters: 0, staged: [] as string[] };
    const manager = new InMemorySessionManager({
        async createSession() {}, async killSession() {}, async listSessions() { return []; }, async hasSession() { return true; },
        async capturePane() { return pane; },
        async inspectPane() { return { content: pane, dead: false }; },
        async stageProgrammaticInput(_name: string, data: string) { state.staged.push(data); if (stage) pane = `› ${data}\n\nmodel · cwd`; },
        async pressEnter() { state.enters++; pane = '› Ask Codex to do anything\n\nmodel · cwd'; }
    }, undefined, undefined, { sleep: async () => {}, programmaticStagedVerifyTimeoutMs: 50 });
    return { manager, state };
}

async function liveSession(manager: InMemorySessionManager, sessions: SessionRepository, userId: string, sessionId: string) {
    const live = await manager.createSession({ userId, sessionId, launchPlan: { command: 'codex', args: [], cwd: '/tmp', env: {}, secretEnvNames: [], credentialMode: 'host_environment' } });
    sessions.update(sessionId, { status: 'running', runtimeSessionName: live.runtimeSessionName });
}

/** Seed a minimal active Copilot conversation + run + step so a copilot action origin passes origin checks. */
function copilotOrigin(db: Database, userId: string, stepId: string): { runId: string } {
    const now = Date.now();
    const conversationId = randomUUID();
    const runId = randomUUID();
    db.prepare('INSERT INTO copilot_conversations (id, user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(conversationId, userId, 'active', now, now);
    db.prepare('INSERT INTO copilot_runs (id, conversation_id, user_id, status, runtime_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(runId, conversationId, userId, 'running', 1, now, now);
    db.prepare('INSERT INTO copilot_run_steps (id, user_id, run_id, ordinal, kind) VALUES (?, ?, ?, 0, ?)').run(stepId, userId, runId, 'tool_call');
    return { runId };
}

describe('session.dispatch', () => {
    it('owner-origin dispatch works without any adapter allowlist: no switch, no env, no per-CLI opt-in', async () => {
        const { db, user, project, sessions } = fixture();
        try {
            const session = sessions.create({ projectId: project.id, name: 's', aiTool: 'codex', workingDir: '/tmp' });
            const { manager, state } = codexManager();
            await liveSession(manager, sessions, user.id, session.id);
            const actions = new PlatformActions({ db, userId: user.id, sessionManager: manager, eventBus: new ForgeBadgerEventBus() }, createPlatformCommands());
            const result = await actions.executeOwner('session.dispatch', { sessionId: session.id, message: 'Implement the thing' }, 'dispatch-1') as { dispatched: boolean; delivery: string };
            assert.equal(result.dispatched, true);
            assert.equal(result.delivery, 'consumed');
            assert.equal(state.enters, 1);
            assert.deepEqual(state.staged, ['Implement the thing']);
        } finally { db.close(); }
    });

    it('surfaces indeterminate delivery as COPILOT_DELIVERY_UNCONFIRMED and never retries', async () => {
        const { db, user, project, sessions } = fixture();
        try {
            const session = sessions.create({ projectId: project.id, name: 's', aiTool: 'codex', workingDir: '/tmp' });
            // Staging never reaches the pane: the post-stage verification fails
            // with PROGRAMMATIC_SUBMIT_INDETERMINATE before any Enter is sent.
            const { manager, state } = codexManager({ stage: false });
            await liveSession(manager, sessions, user.id, session.id);
            const actions = new PlatformActions({ db, userId: user.id, sessionManager: manager, eventBus: new ForgeBadgerEventBus() }, createPlatformCommands());
            await assert.rejects(actions.executeOwner('session.dispatch', { sessionId: session.id, message: 'maybe delivered' }, 'dispatch-2'), /COPILOT_DELIVERY_UNCONFIRMED/);
            assert.equal(state.enters, 0);
        } finally { db.close(); }
    });
});

describe('pm.task.execute', () => {
    it('prepares, dispatches the packet prompt and marks the work item in progress without an adapter allowlist', async () => {
        const { db, user, project, sessions } = fixture();
        try {
            const pm = new ProjectManagerRepository(db, user.id);
            const item = pm.createWorkItem(project.id, { title: 'Build feature', acceptanceCriteria: ['works'] });
            const session = sessions.create({ projectId: project.id, name: 's', aiTool: 'codex', workingDir: '/tmp' });
            pm.updateWorkItem(project.id, item.id, { details: withTaskPacketSessionLink(item.details, session, project) });
            const { manager, state } = codexManager();
            await liveSession(manager, sessions, user.id, session.id);
            const actions = new PlatformActions({ db, userId: user.id, sessionManager: manager, eventBus: new ForgeBadgerEventBus(), adapterCommandRunner: async (command: string) => ({ exitCode: 0, stdout: `${command} 1.0.0`, stderr: '' }) }, createPlatformCommands());
            const result = await actions.executeOwner('pm.task.execute', { projectId: project.id, workItemId: item.id }, 'exec-1') as { dispatch: { dispatched: boolean }; session: { id: string } };
            assert.equal(result.dispatch.dispatched, true);
            assert.equal(result.session.id, session.id);
            assert.match(state.staged[0] ?? '', /Task: Build feature/);
            const updated = pm.getWorkItem(project.id, item.id)!;
            assert.equal(updated.status, 'in_progress');
            assert.equal(typeof readTaskPacketDetails(updated.details).dispatchedAt, 'string');
        } finally { db.close(); }
    });
});

describe('copilot-origin dispatch', () => {
    it('dispatches a copilot-origin action end-to-end with no per-project switch', async () => {
        const { db, user, project, sessions } = fixture();
        try {
            const { manager, state } = codexManager();
            const session = sessions.create({ projectId: project.id, name: 's', aiTool: 'codex', workingDir: '/tmp' });
            await liveSession(manager, sessions, user.id, session.id);
            const { runId } = copilotOrigin(db, user.id, 'dispatch-copilot-1');
            const copilot = new PlatformActions({ db, userId: user.id, sessionManager: manager, eventBus: new ForgeBadgerEventBus(), actionOrigin: { kind: 'copilot', runId, stepId: 'dispatch-copilot-1' } }, createPlatformCommands());
            const intent = copilot.preview({ commandId: 'session.dispatch', input: { sessionId: session.id, message: 'do it' }, idempotencyKey: 'dispatch-copilot-1' });
            assert.equal(intent.status, 'approved');
            assert.equal(intent.origin_kind, 'copilot');
            const receipt = await copilot.execute(intent.id);
            assert.equal(receipt.outcome, 'confirmed');
            assert.equal((receipt.result as { dispatched: boolean }).dispatched, true);
            assert.deepEqual(state.staged, ['do it']);
        } finally { db.close(); }
    });

    it('rejects a copilot-origin command that resolves no project', async () => {
        const { db, user } = fixture();
        try {
            const { runId } = copilotOrigin(db, user.id, 'dispatch-global-1');
            const copilot = new PlatformActions({ db, userId: user.id, actionOrigin: { kind: 'copilot', runId, stepId: 'dispatch-global-1' } }, createPlatformCommands());
            assert.throws(() => copilot.preview({ commandId: 'memory.write', input: { kind: 'fact', scope: 'global', text: 'global note' }, idempotencyKey: 'dispatch-global-1' }), (error: unknown) => {
                assert.match((error as Error).message, /COPILOT_GLOBAL_ACTION_REQUIRES_WEB/);
                assert.match((error as Error).message, /请在 Web 控制台手动执行/);
                return true;
            });
            assert.equal((db.prepare('SELECT count(*) n FROM platform_action_intents').get() as { n: number }).n, 0);
        } finally { db.close(); }
    });
});
