import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
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
import { assertAdapterAutonomy, cliAutonomyAdapters, configureCliAutonomyAdapters, getAdapterAutonomy } from '../src/services/adapter-autonomy.js';
import { readTaskPacketDetails, withTaskPacketSessionLink } from '../src/services/project-manager/task-packets.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { loadEnv } from '../src/config/env.js';

afterEach(() => configureCliAutonomyAdapters([]));

describe('CLI autonomy configuration', () => {
    it('parses FORGEBADGER_CLI_AUTONOMY_ADAPTERS and round-trips a validated env', () => {
        const base = { FORGEBADGER_JWT_SECRET: 'j'.repeat(32), FORGEBADGER_MASTER_KEY: 'k'.repeat(32) };
        const env = loadEnv({ ...base, FORGEBADGER_CLI_AUTONOMY_ADAPTERS: 'claude, codex' });
        assert.deepEqual(env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS, ['claude', 'codex']);
        assert.deepEqual(loadEnv(env).FORGEBADGER_CLI_AUTONOMY_ADAPTERS, ['claude', 'codex']);
        assert.deepEqual(loadEnv(base).FORGEBADGER_CLI_AUTONOMY_ADAPTERS, []);
        assert.throws(() => loadEnv({ ...base, FORGEBADGER_CLI_AUTONOMY_ADAPTERS: 'claude,unknown' }));
    });

    it('gates programmatic dispatch behind the operator opt-in', () => {
        assert.equal(getAdapterAutonomy('claude').mode, 'manual_only');
        assert.throws(() => assertAdapterAutonomy('claude'), /ADAPTER_AUTONOMY_UNVERIFIED/);
        configureCliAutonomyAdapters(['claude']);
        assert.deepEqual(cliAutonomyAdapters(), ['claude']);
        assert.equal(getAdapterAutonomy('claude').mode, 'supervised');
        assertAdapterAutonomy('claude');
        assert.equal(getAdapterAutonomy('codex').mode, 'manual_only');
        assert.throws(() => assertAdapterAutonomy('codex'), /ADAPTER_AUTONOMY_UNVERIFIED/);
    });
});

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
    }, undefined, undefined, { sleep: async () => {} });
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
    it('denies preview without recording an intent when the adapter is not autonomy-enabled', async () => {
        const { db, user, project, sessions } = fixture();
        try {
            const session = sessions.create({ projectId: project.id, name: 's', aiTool: 'codex', workingDir: '/tmp' });
            const actions = new PlatformActions({ db, userId: user.id }, createPlatformCommands());
            assert.throws(() => actions.preview({ commandId: 'session.dispatch', input: { sessionId: session.id, message: 'hi' }, idempotencyKey: 'denied' }), /ADAPTER_AUTONOMY_UNVERIFIED/);
            assert.equal((db.prepare('SELECT count(*) n FROM platform_action_intents').get() as { n: number }).n, 0);
        } finally { db.close(); }
    });

    it('dispatches into a live session once the adapter is autonomy-enabled', async () => {
        configureCliAutonomyAdapters(['codex']);
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
        configureCliAutonomyAdapters(['codex']);
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
    it('denies preview when the adapter is not autonomy-enabled', async () => {
        const { db, user, project } = fixture();
        try {
            const item = new ProjectManagerRepository(db, user.id).createWorkItem(project.id, { title: 'Build feature' });
            const actions = new PlatformActions({ db, userId: user.id }, createPlatformCommands());
            assert.throws(() => actions.preview({ commandId: 'pm.task.execute', input: { projectId: project.id, workItemId: item.id }, idempotencyKey: 'pm-denied' }), /ADAPTER_AUTONOMY_UNVERIFIED/);
        } finally { db.close(); }
    });

    it('prepares, dispatches the packet prompt and marks the work item in progress', async () => {
        configureCliAutonomyAdapters(['codex']);
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

describe('copilot project autonomy gate', () => {
    it('denies a copilot-origin dispatch while the project switch is off and leaves the owner path unaffected', async () => {
        configureCliAutonomyAdapters(['codex']);
        const { db, user, project, sessions } = fixture();
        try {
            const { manager, state } = codexManager();
            const session = sessions.create({ projectId: project.id, name: 's', aiTool: 'codex', workingDir: '/tmp' });
            await liveSession(manager, sessions, user.id, session.id);
            const projects = new ProjectRepository(db, user.id);
            assert.equal(projects.getCopilotAutonomy(project.id), false);
            const { runId } = copilotOrigin(db, user.id, 'autonomy-off-1');
            const copilot = new PlatformActions({ db, userId: user.id, sessionManager: manager, eventBus: new ForgeBadgerEventBus(), actionOrigin: { kind: 'copilot', runId, stepId: 'autonomy-off-1' } }, createPlatformCommands());
            assert.throws(() => copilot.preview({ commandId: 'session.dispatch', input: { sessionId: session.id, message: 'do it' }, idempotencyKey: 'autonomy-off-1' }), (error: unknown) => {
                assert.match((error as Error).message, /COPILOT_PROJECT_AUTONOMY_OFF/);
                assert.match((error as Error).message, /项目「p」/);
                assert.match((error as Error).message, /请在 Web 控制台项目设置中开启后重试/);
                return true;
            });
            assert.equal((db.prepare('SELECT count(*) n FROM platform_action_intents').get() as { n: number }).n, 0);
            // The owner path (non-copilot origin) is not gated by the project switch.
            const owner = new PlatformActions({ db, userId: user.id, sessionManager: manager, eventBus: new ForgeBadgerEventBus() }, createPlatformCommands());
            const result = await owner.executeOwner('session.dispatch', { sessionId: session.id, message: 'owner says hi' }, 'owner-1') as { dispatched: boolean };
            assert.equal(result.dispatched, true);
            assert.deepEqual(state.staged, ['owner says hi']);
        } finally { db.close(); }
    });

    it('dispatches a copilot-origin action when the switch is on and rejects again once it is turned off', async () => {
        configureCliAutonomyAdapters(['codex']);
        const { db, user, project, sessions } = fixture();
        try {
            const { manager, state } = codexManager();
            const session = sessions.create({ projectId: project.id, name: 's', aiTool: 'codex', workingDir: '/tmp' });
            await liveSession(manager, sessions, user.id, session.id);
            const projects = new ProjectRepository(db, user.id);
            projects.setCopilotAutonomy(project.id, true);
            assert.equal(projects.getCopilotAutonomy(project.id), true);
            const { runId } = copilotOrigin(db, user.id, 'autonomy-on-1');
            const copilot = new PlatformActions({ db, userId: user.id, sessionManager: manager, eventBus: new ForgeBadgerEventBus(), actionOrigin: { kind: 'copilot', runId, stepId: 'autonomy-on-1' } }, createPlatformCommands());
            const intent = copilot.preview({ commandId: 'session.dispatch', input: { sessionId: session.id, message: 'do it' }, idempotencyKey: 'autonomy-on-1' });
            assert.equal(intent.status, 'approved');
            assert.equal(intent.origin_kind, 'copilot');
            const receipt = await copilot.execute(intent.id);
            assert.equal(receipt.outcome, 'confirmed');
            assert.equal((receipt.result as { dispatched: boolean }).dispatched, true);
            assert.deepEqual(state.staged, ['do it']);
            // The switch is read live at preview time: turning it off rejects the next copilot intent.
            projects.setCopilotAutonomy(project.id, false);
            const { runId: runId2 } = copilotOrigin(db, user.id, 'autonomy-off-2');
            const copilotAfter = new PlatformActions({ db, userId: user.id, sessionManager: manager, eventBus: new ForgeBadgerEventBus(), actionOrigin: { kind: 'copilot', runId: runId2, stepId: 'autonomy-off-2' } }, createPlatformCommands());
            assert.throws(() => copilotAfter.preview({ commandId: 'session.dispatch', input: { sessionId: session.id, message: 'again' }, idempotencyKey: 'autonomy-off-2' }), (error: unknown) => {
                assert.match((error as Error).message, /COPILOT_PROJECT_AUTONOMY_OFF/);
                return true;
            });
        } finally { db.close(); }
    });

    it('rejects a copilot-origin dispatch into a session of a project that keeps the switch off', async () => {
        configureCliAutonomyAdapters(['codex']);
        const { db, user, project, sessions } = fixture();
        try {
            const { manager } = codexManager();
            const session = sessions.create({ projectId: project.id, name: 's', aiTool: 'codex', workingDir: '/tmp' });
            await liveSession(manager, sessions, user.id, session.id);
            const projects = new ProjectRepository(db, user.id);
            projects.setCopilotAutonomy(project.id, true);
            const outside = projects.create({ name: 'outside', path: '/tmp/outside-dispatch', aiTool: 'codex' });
            const outsideSession = sessions.create({ projectId: outside.id, name: 'o', aiTool: 'codex', workingDir: '/tmp' });
            assert.equal(projects.getCopilotAutonomy(outside.id), false);
            const { runId } = copilotOrigin(db, user.id, 'autonomy-scope-1');
            const copilot = new PlatformActions({ db, userId: user.id, sessionManager: manager, eventBus: new ForgeBadgerEventBus(), actionOrigin: { kind: 'copilot', runId, stepId: 'autonomy-scope-1' } }, createPlatformCommands());
            assert.throws(() => copilot.preview({ commandId: 'session.dispatch', input: { sessionId: outsideSession.id, message: 'x' }, idempotencyKey: 'autonomy-scope-1' }), (error: unknown) => {
                assert.match((error as Error).message, /COPILOT_PROJECT_AUTONOMY_OFF/);
                assert.match((error as Error).message, /项目「outside」/);
                return true;
            });
            assert.equal((db.prepare('SELECT count(*) n FROM platform_action_intents').get() as { n: number }).n, 0);
        } finally { db.close(); }
    });

    it('rejects a copilot-origin command that resolves no project', async () => {
        const { db, user } = fixture();
        try {
            const { runId } = copilotOrigin(db, user.id, 'autonomy-global-1');
            const copilot = new PlatformActions({ db, userId: user.id, actionOrigin: { kind: 'copilot', runId, stepId: 'autonomy-global-1' } }, createPlatformCommands());
            assert.throws(() => copilot.preview({ commandId: 'memory.write', input: { kind: 'fact', scope: 'global', text: 'global note' }, idempotencyKey: 'autonomy-global-1' }), (error: unknown) => {
                assert.match((error as Error).message, /COPILOT_GLOBAL_ACTION_REQUIRES_WEB/);
                assert.match((error as Error).message, /请在 Web 控制台手动执行/);
                return true;
            });
            assert.equal((db.prepare('SELECT count(*) n FROM platform_action_intents').get() as { n: number }).n, 0);
        } finally { db.close(); }
    });
});
