import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { PlatformNoEffectError } from '../src/services/platform-commands/errors.js';
import type { PlatformCommand } from '../src/services/platform-commands/types.js';
function fixture() {
    const db = new Database(':memory:');
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    const user = new UserRepository(db).create('actions@test.dev', 'hash');
    db.exec('CREATE TABLE action_test(value INTEGER NOT NULL)');
    const command: PlatformCommand = { id: 'test.write', capability: 'test.write', effect: 'database',
        inputSchema: z.object({ value: z.number() }).strict(), resolve: () => ({ projectIds: [], revision: '1' }),
        execute(ctx, input) {
            ctx.db.prepare('INSERT INTO action_test(value) VALUES (?)').run((input as {
                value: number;
            }).value);
            return { written: true };
        } };
    const commands = new Map([[command.id, command]]);
    const actions = new PlatformActions({ db, userId: user.id }, commands);
    return { db, user, actions, command, commands };
}
/** Live copilot run whose tool steps back copilot-origin action intents (step id is the idempotency key). */
function copilotSession(db: Database, user: { id: string }) {
    const log = new CopilotConversationLog(db, user.id);
    const conversation = log.createConversation();
    const ledger = new CopilotRunLedger(db, user.id);
    const runId = ledger.admit({ userId: user.id, conversationId: conversation.id, userText: 'perform action' }, 10);
    const next = (commands: Map<string, PlatformCommand>) => {
        const step = ledger.addStep(runId, { kind: 'tool', effect: 'write' });
        return { actions: new PlatformActions({ db, userId: user.id, actionOrigin: { kind: 'copilot', runId, stepId: step.id } }, commands), key: step.id };
    };
    return { runId, next };
}
it('binds canonical inputs and returns the same receipt without repeating a DB mutation', async () => {
    const { db, actions } = fixture();
    try {
        const intent = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'one' });
        assert.equal(intent.status, 'approved');
        const first = await actions.execute(intent.id);
        const second = await actions.execute(intent.id);
        assert.deepEqual(second, first);
        assert.equal((db.prepare('SELECT count(*) n FROM action_test').get() as { n: number }).n, 1);
        assert.throws(() => actions.preview({ commandId: 'test.write', input: { value: 2 }, idempotencyKey: 'one' }), /idempotency/i);
    }
    finally {
        db.close();
    }
});
it('rolls back database effects when execution throws', async () => {
    const { db, actions, command } = fixture();
    try {
        command.execute = (ctx) => {
            ctx.db.prepare('INSERT INTO action_test(value) VALUES (?)').run(1);
            throw new Error('failure');
        };
        const intent = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'rollback' });
        await assert.rejects(actions.execute(intent.id), /failure/);
        assert.equal((db.prepare('SELECT count(*) n FROM action_test').get() as { n: number }).n, 0);
        assert.equal(actions.intents.receipt(intent.id)?.outcome, 'no_effect');
    }
    finally {
        db.close();
    }
});
it('rejects copilot-origin actions while the project autonomy switch is off', async () => {
    const { db, user, command, commands } = fixture();
    try {
        const projects = new ProjectRepository(db, user.id);
        const project = projects.create({ name: 'Locked', path: '/tmp/platform-actions-locked', aiTool: 'claude' });
        assert.equal(projects.getCopilotAutonomy(project.id), false);
        command.resolve = () => ({ projectIds: [project.id], revision: '1' });
        const { actions, key } = copilotSession(db, user).next(commands);
        assert.throws(() => actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: key }),
            error => error instanceof PlatformNoEffectError && /COPILOT_PROJECT_AUTONOMY_OFF/.test(error.message) && /Web 控制台/.test(error.message));
        assert.equal((db.prepare('SELECT count(*) n FROM platform_action_intents').get() as { n: number }).n, 0);
        assert.equal((db.prepare('SELECT count(*) n FROM action_test').get() as { n: number }).n, 0);
    }
    finally {
        db.close();
    }
});
it('executes copilot-origin actions straight through when autonomy is on and records a confirmed receipt', async () => {
    const { db, user, command, commands } = fixture();
    try {
        const projects = new ProjectRepository(db, user.id);
        const project = projects.create({ name: 'Open', path: '/tmp/platform-actions-open', aiTool: 'claude' });
        projects.setCopilotAutonomy(project.id, true);
        command.resolve = () => ({ projectIds: [project.id], revision: '1' });
        const session = copilotSession(db, user);
        const { actions, key } = session.next(commands);
        const intent = actions.preview({ commandId: 'test.write', input: { value: 7 }, idempotencyKey: key });
        assert.equal(intent.status, 'approved');
        assert.ok(intent.expires_at <= Date.now() + 15 * 60000);
        assert.equal(intent.origin_kind, 'copilot');
        assert.equal(intent.origin_run_id, session.runId);
        assert.equal(intent.origin_step_id, key);
        const receipt = await actions.execute(intent.id);
        assert.equal(receipt.outcome, 'confirmed');
        assert.deepEqual(receipt.result, { written: true });
        assert.equal((db.prepare('SELECT count(*) n FROM action_test').get() as { n: number }).n, 1);
        assert.equal((await actions.execute(intent.id)).outcome, 'confirmed');
    }
    finally {
        db.close();
    }
});
it('applies an autonomy switch flip to the next copilot intent immediately', async () => {
    const { db, user, command, commands } = fixture();
    try {
        const projects = new ProjectRepository(db, user.id);
        const project = projects.create({ name: 'Flapping', path: '/tmp/platform-actions-flapping', aiTool: 'claude' });
        projects.setCopilotAutonomy(project.id, true);
        command.resolve = () => ({ projectIds: [project.id], revision: '1' });
        const session = copilotSession(db, user);
        const first = session.next(commands);
        const intent = first.actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: first.key });
        assert.equal(intent.status, 'approved');
        await first.actions.execute(intent.id);
        projects.setCopilotAutonomy(project.id, false);
        const second = session.next(commands);
        assert.throws(() => second.actions.preview({ commandId: 'test.write', input: { value: 2 }, idempotencyKey: second.key }),
            error => error instanceof PlatformNoEffectError && /COPILOT_PROJECT_AUTONOMY_OFF/.test(error.message));
        assert.equal((db.prepare('SELECT count(*) n FROM action_test').get() as { n: number }).n, 1);
    }
    finally {
        db.close();
    }
});
it('requires the Web console for copilot-origin actions without a project while the owner path stays ungated', async () => {
    const { db, user, commands } = fixture();
    try {
        const { actions, key } = copilotSession(db, user).next(commands);
        assert.throws(() => actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: key }),
            error => error instanceof PlatformNoEffectError && /COPILOT_GLOBAL_ACTION_REQUIRES_WEB/.test(error.message));
        assert.equal((db.prepare('SELECT count(*) n FROM platform_action_intents').get() as { n: number }).n, 0);
        const owner = new PlatformActions({ db, userId: user.id }, commands);
        const intent = owner.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'owner-global' });
        assert.equal(intent.status, 'approved');
        assert.equal(intent.origin_kind, 'legacy');
    }
    finally {
        db.close();
    }
});
it('scopes the project autonomy switch to the owning user', async () => {
    const { db, user } = fixture();
    try {
        const projects = new ProjectRepository(db, user.id);
        const project = projects.create({ name: 'Scoped', path: '/tmp/platform-actions-scoped', aiTool: 'claude' });
        projects.setCopilotAutonomy(project.id, true);
        const other = new UserRepository(db).create('other-actions@test.dev', 'hash');
        const foreign = new ProjectRepository(db, other.id);
        assert.equal(foreign.getCopilotAutonomy(project.id), undefined);
        assert.equal(foreign.setCopilotAutonomy(project.id, false), undefined);
        assert.equal(projects.getCopilotAutonomy(project.id), true);
    }
    finally {
        db.close();
    }
});
it('rejects stale resource revisions and actor deactivation at execution', async () => {
    const { db, user, actions, command } = fixture();
    try {
        let revision = '1';
        command.resolve = () => ({ projectIds: [], revision });
        const intent = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'stale' });
        revision = '2';
        await assert.rejects(actions.execute(intent.id), /Stale resource/);
        revision = '1';
        db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(user.id);
        await assert.rejects(actions.execute(intent.id), /not active/);
        assert.equal(actions.intents.get(intent.id)?.status, 'approved');
        assert.equal(actions.intents.receipt(intent.id), undefined);
    }
    finally {
        db.close();
    }
});
it('never retries uncertain external effects and preserves a durable unknown receipt', async () => {
    const { db, actions, command } = fixture();
    try {
        command.effect = 'external';
        let attempts = 0;
        command.execute = async () => {
            attempts++;
            throw new Error('connection lost');
        };
        const intent = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'external' });
        await assert.rejects(actions.execute(intent.id), /connection lost/);
        const receipt = await actions.execute(intent.id);
        assert.equal(receipt.outcome, 'unknown');
        assert.equal(attempts, 1);
    }
    finally {
        db.close();
    }
});
it('rechecks current tool switches for an owner intent before preview and execution', async () => {
    const { CopilotToolPreferenceRepository } = await import('../src/db/repositories/copilot-tool-preference-repository.js');
    const { createPlatformCommands } = await import('../src/services/platform-commands/catalog.js');
    const { db, user } = fixture();
    try {
        const actions = new PlatformActions({ db, userId: user.id }, createPlatformCommands());
        const prefs = new CopilotToolPreferenceRepository(db, user.id);
        prefs.setEnabled('write_memory', false);
        assert.throws(() => actions.preview({ commandId: 'memory.write', input: { scope: 'global', kind: 'fact', text: 'Exact approval' }, idempotencyKey: 'memory' }), /disabled/);
        prefs.setEnabled('write_memory', true);
        const intent = actions.preview({ commandId: 'memory.write', input: { scope: 'global', kind: 'fact', text: 'Exact approval' }, idempotencyKey: 'memory' });
        assert.equal(intent.status, 'approved');
        prefs.setEnabled('write_memory', false);
        await assert.rejects(actions.execute(intent.id), /disabled/);
        assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory').get() as { n: number }).n, 0);
    }
    finally {
        db.close();
    }
});
it('records typed external no-effect failures and never retries them', async () => {
    const { db, actions, command } = fixture();
    try {
        command.effect = 'external';
        let attempts = 0;
        command.execute = async () => {
            attempts++;
            throw new PlatformNoEffectError('Precondition changed before any effect');
        };
        const intent = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'no-effect' });
        await assert.rejects(actions.execute(intent.id), /Precondition/);
        assert.equal(actions.intents.receipt(intent.id)?.outcome, 'no_effect');
        assert.equal(actions.intents.get(intent.id)?.status, 'completed');
        assert.equal(attempts, 1);
        const again = await actions.execute(intent.id);
        assert.equal(again.outcome, 'no_effect');
        assert.equal(attempts, 1);
    }
    finally {
        db.close();
    }
});
it('commits receipt and terminal intent state atomically, including CAS failures', () => {
    const { db, actions } = fixture();
    try {
        const intent = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'atomic-receipt' });
        actions.intents.transition(intent.id, 'approved', 'executing');
        db.exec("CREATE TRIGGER block_receipt_state BEFORE UPDATE OF status ON platform_action_intents WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'injected transition failure'); END");
        assert.throws(() => actions.intents.finish(intent.id, 'confirmed', { done: true }), /injected transition failure/);
        assert.equal(actions.intents.receipt(intent.id), undefined);
        assert.equal(actions.intents.get(intent.id)?.status, 'executing');
        db.exec('DROP TRIGGER block_receipt_state');
        actions.intents.finish(intent.id, 'confirmed', { done: true });
        assert.equal(actions.intents.get(intent.id)?.status, 'completed');
        const second = actions.preview({ commandId: 'test.write', input: { value: 2 }, idempotencyKey: 'cas-receipt' });
        assert.equal(second.status, 'approved');
        assert.throws(() => actions.intents.finish(second.id, 'confirmed', {}), /state conflict/);
        assert.equal(actions.intents.receipt(second.id), undefined);
        assert.equal(actions.intents.get(second.id)?.status, 'approved');
    }
    finally {
        db.close();
    }
});
it('recovers only expired execution leases and accepts a late factual receipt without replay', async () => {
    const { db, actions, command } = fixture();
    try {
        command.effect = 'external';
        const intent = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'crash-lease' });
        assert.equal(actions.intents.start(intent.id, 'live-owner', Date.now() + 30000), true);
        const observer = new PlatformActions(actions.context, actions.commands);
        assert.equal(observer.intents.get(intent.id)?.status, 'executing');
        assert.equal(observer.intents.renewExecution(intent.id, 'wrong-owner', Date.now() + 30000), false);
        db.prepare('UPDATE platform_action_intents SET execution_lease_expires_at=? WHERE id=?').run(Date.now() - 1, intent.id);
        const restarted = new PlatformActions(actions.context, actions.commands);
        assert.equal(restarted.intents.get(intent.id)?.status, 'indeterminate');
        await assert.rejects(restarted.execute(intent.id), /replay prohibited/);
        restarted.intents.finish(intent.id, 'confirmed', { late: true });
        assert.equal(restarted.intents.get(intent.id)?.status, 'completed');
        assert.equal((await restarted.execute(intent.id)).outcome, 'confirmed');
    }
    finally {
        db.close();
    }
});
it('rechecks actor state after an await before finalizing an external effect', async () => {
    const { db, user, actions, command } = fixture();
    let release!: () => void;
    let began!: () => void;
    const waiting = new Promise<void>(r => { release = r; });
    const started = new Promise<void>(r => { began = r; });
    command.effect = 'external';
    command.execute = async ctx => {
        began();
        await waiting;
        ctx.authorize!();
        return { done: true };
    };
    try {
        const intent = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'await-recheck' });
        const running = actions.execute(intent.id);
        await started;
        db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(user.id);
        release();
        await assert.rejects(running, /not active/);
        assert.equal(actions.intents.get(intent.id)?.status, 'indeterminate');
        assert.equal(actions.intents.receipt(intent.id)?.outcome, 'unknown');
    }
    finally {
        release();
        db.close();
    }
});
