import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import type { PlatformCommand } from '../src/services/platform-commands/types.js';
function fixture() {
    const db = new Database(':memory:');
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    const user = new UserRepository(db).create('actions@test.dev', 'hash');
    db.exec('CREATE TABLE action_test(value INTEGER NOT NULL)');
    const command: PlatformCommand = { id: 'test.write', capability: 'test.write', effect: 'database', delegatable: true,
        inputSchema: z.object({ value: z.number() }).strict(), resolve: () => ({ projectIds: [], revision: '1' }),
        execute(ctx, input) {
            ctx.db.prepare('INSERT INTO action_test(value) VALUES (?)').run((input as {
                value: number;
            }).value);
            return { written: true };
        } };
    const actions = new PlatformActions({ db, userId: user.id }, new Map([[command.id, command]]));
    return { db, user, actions, command };
}
it('binds canonical inputs and returns the same receipt without repeating a DB mutation', async () => {
    const { db, actions } = fixture();
    try {
        const intent = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'one', authority: 'owner_action' });
        actions.decide(intent.id, intent.digest, true);
        const first = await actions.execute(intent.id);
        const second = await actions.execute(intent.id);
        assert.deepEqual(second, first);
        assert.equal(db.prepare('SELECT count(*) n FROM action_test').get().n, 1);
        assert.throws(() => actions.preview({ commandId: 'test.write', input: { value: 2 }, idempotencyKey: 'one', authority: 'owner_action' }), /idempotency/i);
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
        const intent = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'rollback', authority: 'owner_action' });
        actions.decide(intent.id, intent.digest, true);
        await assert.rejects(actions.execute(intent.id), /failure/);
        assert.equal(db.prepare('SELECT count(*) n FROM action_test').get().n, 0);
    }
    finally {
        db.close();
    }
});
it('enforces revocation and atomic budgets without implicit owner fallback', async () => {
    const { db, actions } = fixture();
    try {
        const g = actions.createGrant({ name: 'limited', projectIds: [], capabilities: ['test.write'], expiresAt: Date.now() + 100000, maxActions: 1 });
        const i = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'grant-one', authority: 'delegated_grant', grantId: g.id });
        const second = actions.preview({ commandId: 'test.write', input: { value: 2 }, idempotencyKey: 'grant-two', authority: 'delegated_grant', grantId: g.id });
        await actions.execute(i.id);
        await assert.rejects(actions.execute(second.id), /budget/);
        assert.equal(actions.grants.get(g.id)?.usedActions, 1);
        assert.equal(actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'grant-one', authority: 'delegated_grant', grantId: g.id }).id, i.id);
        const revoked = actions.createGrant({ name: 'revoked', projectIds: [], capabilities: ['test.write'], expiresAt: Date.now() + 100000, maxActions: 1 });
        const r = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'revoked', authority: 'delegated_grant', grantId: revoked.id });
        actions.grants.revoke(revoked.id);
        await assert.rejects(actions.execute(r.id), /revoked/);
        assert.throws(() => actions.decide(r.id, r.digest, true), /owner authority/);
    }
    finally {
        db.close();
    }
});
it('rejects stale resource approval and actor deactivation', async () => {
    const { db, user, actions, command } = fixture();
    try {
        let revision = '1';
        command.resolve = () => ({ projectIds: [], revision });
        const i = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'stale', authority: 'owner_action' });
        revision = '2';
        assert.throws(() => actions.decide(i.id, i.digest, true), /Stale resource/);
        revision = '1';
        actions.decide(i.id, i.digest, true);
        db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(user.id);
        await assert.rejects(actions.execute(i.id), /not active/);
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
        const i = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'external', authority: 'owner_action' });
        actions.decide(i.id, i.digest, true);
        await assert.rejects(actions.execute(i.id), /connection lost/);
        const receipt = await actions.execute(i.id);
        assert.equal(receipt.outcome, 'unknown');
        assert.equal(attempts, 1);
    }
    finally {
        db.close();
    }
});
it('rechecks current tool switches for an owner intent before approval and execution', async () => {
    const { CopilotToolPreferenceRepository } = await import('../src/db/repositories/copilot-tool-preference-repository.js');
    const { createPlatformCommands } = await import('../src/services/platform-commands/catalog.js');
    const { db, user } = fixture();
    try {
        const actions = new PlatformActions({ db, userId: user.id }, createPlatformCommands());
        const i = actions.preview({ commandId: 'memory.write', input: { scope: 'global', kind: 'fact', text: 'Exact approval' }, idempotencyKey: 'memory', authority: 'owner_action' });
        const prefs = new CopilotToolPreferenceRepository(db, user.id);
        prefs.setEnabled('write_memory', false);
        assert.throws(() => actions.decide(i.id, i.digest, true), /disabled/);
        prefs.setEnabled('write_memory', true);
        actions.decide(i.id, i.digest, true);
        prefs.setEnabled('write_memory', false);
        await assert.rejects(actions.execute(i.id), /disabled/);
        assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory').get() as {
            n: number;
        }).n, 0);
    }
    finally {
        db.close();
    }
});
it('records typed external no-effect failures and releases the grant reservation', async () => {
    const { PlatformNoEffectError } = await import('../src/services/platform-commands/errors.js');
    const { db, actions, command } = fixture();
    try {
        command.effect = 'external';
        command.execute = async () => {
            throw new PlatformNoEffectError('Precondition changed before any effect');
        };
        const grant = actions.createGrant({ name: 'one', projectIds: [], capabilities: ['test.write'], expiresAt: Date.now() + 100000, maxActions: 1 });
        const i = actions.preview({ commandId: 'test.write', input: { value: 1 }, idempotencyKey: 'no-effect', authority: 'delegated_grant', grantId: grant.id });
        await assert.rejects(actions.execute(i.id), /Precondition/);
        assert.equal(actions.intents.receipt(i.id)?.outcome, 'no_effect');
        assert.equal(actions.grants.get(grant.id)?.usedActions, 0);
        assert.equal(actions.intents.activeForGrant(grant.id), 0);
    }
    finally {
        db.close();
    }
});
it('commits receipt and terminal intent state atomically, including CAS failures',()=>{
 const {db,actions}=fixture();try{
 const i=actions.preview({commandId:'test.write',input:{value:1},idempotencyKey:'atomic-receipt',authority:'owner_action'});
 actions.decide(i.id,i.digest,true);actions.intents.transition(i.id,'approved','executing');
 db.exec("CREATE TRIGGER block_receipt_state BEFORE UPDATE OF status ON platform_action_intents WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'injected transition failure'); END");
 assert.throws(()=>actions.intents.finish(i.id,'confirmed',{done:true}),/injected transition failure/);
 assert.equal(actions.intents.receipt(i.id),undefined);assert.equal(actions.intents.get(i.id)?.status,'executing');
 db.exec('DROP TRIGGER block_receipt_state');actions.intents.finish(i.id,'confirmed',{done:true});assert.equal(actions.intents.get(i.id)?.status,'completed');
 const second=actions.preview({commandId:'test.write',input:{value:2},idempotencyKey:'cas-receipt',authority:'owner_action'});
 assert.throws(()=>actions.intents.finish(second.id,'confirmed',{}),/state conflict/);assert.equal(actions.intents.receipt(second.id),undefined);assert.equal(actions.intents.get(second.id)?.status,'pending');
 }finally{db.close();}
});
it('recovers only expired execution leases and accepts a late factual receipt without replay',async()=>{
 const {db,actions,command}=fixture();try{
 command.effect='external';const i=actions.preview({commandId:'test.write',input:{value:1},idempotencyKey:'crash-lease',authority:'owner_action'});actions.decide(i.id,i.digest,true);
 assert.equal(actions.intents.start(i.id,'live-owner',Date.now()+30000),true);
 const observer=new PlatformActions(actions.context,actions.commands);assert.equal(observer.intents.get(i.id)?.status,'executing');
 assert.equal(observer.intents.renewExecution(i.id,'wrong-owner',Date.now()+30000),false);
 db.prepare('UPDATE platform_action_intents SET execution_lease_expires_at=? WHERE id=?').run(Date.now()-1,i.id);
 const restarted=new PlatformActions(actions.context,actions.commands);assert.equal(restarted.intents.get(i.id)?.status,'indeterminate');await assert.rejects(restarted.execute(i.id),/replay prohibited/);
 restarted.intents.finish(i.id,'confirmed',{late:true});assert.equal(restarted.intents.get(i.id)?.status,'completed');assert.equal((await restarted.execute(i.id)).outcome,'confirmed');
 }finally{db.close();}
});
