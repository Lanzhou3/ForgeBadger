import { CopilotToolPreferenceRepository } from "../src/db/repositories/copilot-tool-preference-repository.js";
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
import { fileURLToPath } from 'node:url';
it('composes preview execution receipt and owner autonomy scope over real HTTP', async () => {
    const db = new Database(':memory:');
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    const masterKey = 'a'.repeat(32), jwtSecret = 'b'.repeat(32);
    const user = new UserRepository(db).create('actions-http@test.dev', 'hash');
    const project = new ProjectRepository(db, user.id).create({ name: 'platform', path: '/tmp/platform-http', aiTool: '' });
    const app = createGatewayApp({ db, masterKey, jwtSecret, sessionServerIpcPath: "/tmp/forgebadger-test-session-server.sock", sessionManager: new InMemorySessionManager({ async listSessions() {
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
    const count = (table: string) => (db.prepare(`SELECT count(*) n FROM ${table}`).get() as {
        n: number;
    }).n;
    try {
        const prefs = new CopilotToolPreferenceRepository(db, user.id);
        prefs.setEnabled('write_memory', false);
        assert.equal((await post('/copilot/memory/entries', { kind: 'fact', scope: 'global', text: 'blocked' })).status, 400);
        assert.equal(count('platform_action_receipts'), 0);
        prefs.setEnabled('write_memory', true);
        assert.equal((await post('/copilot/memory/entries', { kind: 'fact', scope: 'global', text: 'persisted' })).status, 201);
        assert.equal(count('platform_action_receipts'), 1);
        assert.equal(count('copilot_memory'), 1);
        // Grant management is gone: the removed CRUD routes no longer exist.
        assert.equal((await fetch(base + '/copilot/grants', { headers })).status, 404);
        // Preview takes no grantId; owner-API intents are approved at creation.
        const pv = await post('/platform-actions/preview', { commandId: 'pm.work_item.create', input: { projectId: project.id, title: 'Ship' }, idempotencyKey: 'http-1' });
        assert.equal(pv.status, 200);
        const intent = pv.body.data.intent as ActionIntent;
        assert.equal(intent.status, 'approved');
        assert.equal(intent.authority, 'owner_action');
        assert.equal(intent.origin_kind, 'owner_api');
        assert.equal('grant_id' in intent, false);
        const first = await post(`/platform-actions/${intent.id}/execute`);
        assert.equal(first.status, 200);
        assert.equal((first.body.data.receipt as {
            outcome: string;
        }).outcome, 'confirmed');
        const second = await post(`/platform-actions/${intent.id}/execute`);
        assert.deepEqual(second.body, first.body);
        assert.equal(count('project_manager_work_items'), 1);
        // The decide endpoint no longer exists; intents never wait for approval.
        assert.equal((await fetch(base + `/platform-actions/${intent.id}/decide`, { method: 'POST', headers, body: JSON.stringify({ approved: true }) })).status, 404);
        // Owner scope isolation: the per-project Copilot autonomy switch (default
        // off) gates copilot-origin actions only, never the owner API path.
        assert.equal(new ProjectRepository(db, user.id).getCopilotAutonomy(project.id), false);
        const owner = await post('/platform-actions/preview', { commandId: 'project.metadata.update', input: { projectId: project.id, name: 'Renamed' }, idempotencyKey: 'owner-1' });
        assert.equal(owner.status, 200);
        const oi = owner.body.data.intent as ActionIntent;
        assert.equal(oi.status, 'approved');
        assert.equal((await post(`/platform-actions/${oi.id}/execute`)).status, 200);
        assert.equal(new ProjectRepository(db, user.id).getById(project.id)?.name, 'Renamed');
    }
    finally {
        await app.close();
    }
});
