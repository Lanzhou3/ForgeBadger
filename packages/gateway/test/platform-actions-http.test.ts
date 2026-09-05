import { CopilotToolPreferenceRepository } from "../src/db/repositories/copilot-tool-preference-repository.js";
import type { CopilotGrant } from "../src/db/repositories/copilot-grant-repository.js";
import type { ActionIntent } from "../src/db/repositories/platform-action-repository.js";
import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createGatewayApp } from '../src/server.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { InMemoryApiKeyStore } from '../src/secrets/api-key-store.js';
import { signJwt } from '../src/auth/jwt.js';
it('composes grant preview approval execution receipt and revocation over real HTTP', async () => {
    const db = new Database(':memory:');
    migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations', import.meta.url).pathname });
    const masterKey = 'a'.repeat(32), jwtSecret = 'b'.repeat(32);
    const user = new UserRepository(db).create('actions-http@test.dev', 'hash');
    const project = new ProjectRepository(db, user.id).create({ name: 'platform', path: '/tmp/platform-http', aiTool: '' });
    const app = createGatewayApp({ db, masterKey, jwtSecret, sessionManager: new InMemorySessionManager({ async listSessions() {
                return [];
            }, async createSession() {
            }, async killSession() {
            }, async capturePane() {
                return '';
            } } as never), apiKeyStore: new InMemoryApiKeyStore({ masterKey }) });
    await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r));
    const addr = app.server.address();
    assert.ok(addr && typeof addr !== 'string');
    const base = `http://127.0.0.1:${addr.port}/api/v1`;
    const headers = { Authorization: `Bearer ${signJwt({ userId: user.id, email: user.email }, jwtSecret)}`, 'Content-Type': 'application/json' };
    async function post(path: string, body: unknown = {}) {
        const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
        return { status: r.status, body: await r.json() as {
                data: Record<string, unknown>;
            } };
    }
    try {
        const prefs=new CopilotToolPreferenceRepository(db,user.id);
        prefs.setEnabled('write_memory',false);
        assert.equal((await post('/copilot/memory/entries',{kind:'fact',scope:'global',text:'blocked'})).status,400);
        assert.equal((db.prepare('SELECT count(*) n FROM platform_action_receipts').get() as {n:number}).n,0);
        prefs.setEnabled('write_memory',true);
        assert.equal((await post('/copilot/memory/entries',{kind:'fact',scope:'global',text:'persisted'})).status,201);
        assert.equal((db.prepare('SELECT count(*) n FROM platform_action_receipts').get() as {n:number}).n,1);
        assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory').get() as {n:number}).n,1);
        const created = await post('/copilot/grants', { name: 'PM', projectIds: [project.id], capabilities: ['pm.work_item.create'], expiresAt: Date.now() + 100000, maxActions: 2 });
        assert.equal(created.status, 200);
        const grant = created.body.data.grant as CopilotGrant;
        const pv = await post('/platform-actions/preview', { commandId: 'pm.work_item.create', input: { projectId: project.id, title: 'Ship' }, grantId: grant.id, idempotencyKey: 'http-1' });
        assert.equal(pv.status, 200);
        const intent = pv.body.data.intent as ActionIntent;
        const first = await post(`/platform-actions/${intent.id}/execute`);
        assert.equal(first.status, 200);
        const second = await post(`/platform-actions/${intent.id}/execute`);
        assert.deepEqual(second.body, first.body);
        assert.equal((db.prepare('SELECT count(*) n FROM project_manager_work_items').get() as {
            n: number;
        }).n, 1);
        assert.equal((await post(`/copilot/grants/${grant.id}/revoke`)).status, 200);
        assert.equal((await post('/platform-actions/preview', { commandId: 'pm.work_item.create', input: { projectId: project.id, title: 'Forbidden' }, grantId: grant.id, idempotencyKey: 'http-2' })).status, 409);
        const owner = await post('/platform-actions/preview', { commandId: 'project.metadata.update', input: { projectId: project.id, name: 'Renamed' }, idempotencyKey: 'owner-1' });
        const oi = owner.body.data.intent as ActionIntent;
        assert.equal((await post(`/platform-actions/${oi.id}/execute`)).status, 409);
        assert.equal((await post(`/platform-actions/${oi.id}/decide`, { digest: oi.digest, approved: true })).status, 200);
        assert.equal((await post(`/platform-actions/${oi.id}/execute`)).status, 200);
        assert.equal(new ProjectRepository(db, user.id).getById(project.id)?.name, 'Renamed');
    }
    finally {
        await app.close();
    }
});
