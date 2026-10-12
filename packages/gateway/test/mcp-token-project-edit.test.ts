import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { signJwt } from '../src/auth/jwt.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { McpTokenRepository } from '../src/db/repositories/mcp-token-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { assertMcpTokenAuthority, snapshotMcpProjects } from '../src/services/mcp/token-authority.js';
import { createMcpTokenRoutes } from '../src/routes/mcp-tokens.js';
import { createMcpRoutes } from '../src/routes/mcp.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { createPlatformCommands } from '../src/services/platform-commands/catalog.js';
import { planDigest } from '../src/services/mcp/lifecycle.js';
import type { CommandResources } from '../src/services/platform-commands/types.js';

async function fixture(t: TestContext) {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'fb-token-edit-')));
  const users = new UserRepository(db), owner = users.create('owner@example.test', 'hash'), other = users.create('other@example.test', 'hash');
  const projects = new ProjectRepository(db, owner.id);
  for (const name of ['a', 'b', 'foreign']) mkdirSync(path.join(root, name));
  const a = projects.create({ name: 'A', path: path.join(root, 'a'), aiTool: 'codex' });
  const b = projects.create({ name: 'B', path: path.join(root, 'b'), aiTool: 'codex' });
  const foreign = new ProjectRepository(db, other.id).create({ name: 'Foreign', path: path.join(root, 'foreign'), aiTool: 'codex' });
  const tokens = new McpTokenRepository(db);
  const grant = tokens.create({ userId: owner.id, name: 'Permanent', scopes: ['read', 'operate', 'cli_dispatch', 'lifecycle'],
    allowedProjects: snapshotMcpProjects(db, owner.id, [a.id]) });
  const secret = 'x'.repeat(32), masterKey = 'm'.repeat(32), app = express();
  app.locals.db = db; app.locals.jwtSecret = secret; app.use(express.json());
  app.use('/api/v1/mcp/tokens', createMcpTokenRoutes(db));
  app.use('/mcp', createMcpRoutes({ db, masterKey, appVersion: 'test' }));
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(root, { recursive: true, force: true }); });
  const jwt = signJwt({ userId: owner.id, email: owner.email }, secret);
  const otherJwt = signJwt({ userId: other.id, email: other.email }, secret);
  async function patch(body: Record<string, unknown>, tokenId = grant.record.id, credential = jwt) {
    const response = await fetch(`${base}/api/v1/mcp/tokens/${tokenId}`, { method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: (response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : { code: 1 }) as
      { code: number; data?: { token: { id: string; projectIds: string[] } } } };
  }
  async function visibleProjects() {
    const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json',
      accept: 'application/json, text/event-stream', authorization: `Bearer ${grant.token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects', arguments: { limit: 100 } } }) });
    assert.equal(response.status, 200);
    const data = (await response.text()).split('\n').find(line => line.startsWith('data:'))!;
    const result = JSON.parse(data.slice(5)) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    assert.notEqual(result.result.isError, true);
    const payload = JSON.parse(result.result.content[0]!.text) as { projects: Array<{ id: string }> };
    return payload.projects.map(project => project.id).sort();
  }
  const context = { db, userId: owner.id, masterKey, mcpTokenId: grant.record.id,
    externalAuthorize: (resources?: CommandResources) => assertMcpTokenAuthority(db, owner.id, grant.record.id, resources) };
  return { db, root, owner, other, a, b, foreign, tokens, grant, patch, visibleProjects, otherJwt, context };
}

test('owner edits selected projects on the same permanent credential and removed projects lose pending intent authority', async t => {
  const f = await fixture(t), before = f.tokens.findActiveByToken(f.grant.token)!;
  assert.deepEqual(await f.visibleProjects(), [f.a.id]);
  const added = await f.patch({ projectIds: [f.b.id, f.a.id, f.b.id], expectedProjectIds: [f.a.id] });
  assert.equal(added.status, 200); assert.equal(added.body.data?.token.id, before.id);
  assert.deepEqual(await f.visibleProjects(), [f.a.id, f.b.id].sort());
  assert.equal('plaintext' in added.body.data!, false);
  assert.equal('tokenHash' in added.body.data!.token, false);
  const actions = new PlatformActions(f.context, createPlatformCommands());
  const intent = actions.preview({ commandId: 'mcp.lifecycle.pm_set_goal', idempotencyKey: 'pending-project',
    input: { projectId: f.a.id, expectedPlanDigest: planDigest(f.context, f.a.id), summary: 'Must not write' } });
  assert.equal((await f.patch({ projectIds: [f.b.id], expectedProjectIds: [f.a.id, f.b.id] })).status, 200);
  assert.deepEqual(await f.visibleProjects(), [f.b.id]);
  await assert.rejects(actions.execute(intent.id), /outside MCP token authorization/);
  assert.equal(new ProjectManagerRepository(f.db, f.owner.id).getGoal(f.a.id), undefined);
  const after = f.tokens.findActiveByToken(f.grant.token)!;
  assert.equal(after.tokenHash, before.tokenHash); assert.equal(after.scopes, before.scopes);
  assert.equal(after.expiresAt, null); assert.deepEqual(after.createdAt, before.createdAt);
});

test('project edits reject stale sets, invalid selections, extra fields, cross-tenant owners and MCP credentials', async t => {
  const f = await fixture(t), valid = { projectIds: [f.b.id], expectedProjectIds: [f.a.id] };
  assert.equal((await f.patch(valid, f.grant.record.id, f.grant.token)).status, 401);
  assert.equal((await f.patch(valid, f.grant.record.id, f.otherJwt)).status, 404);
  for (const body of [{ ...valid, projectIds: [] }, { ...valid, projectIds: [f.foreign.id] }, { ...valid, projectIds: ['missing'] },
    { ...valid, scopes: ['read'] }, { ...valid, expiresInHours: null }, { projectIds: [f.b.id] }]) {
    assert.equal((await f.patch(body)).status, 400);
  }
  assert.equal((await f.patch({ ...valid, expectedProjectIds: [f.b.id] })).status, 409);
  assert.deepEqual(await f.visibleProjects(), [f.a.id]);
  assert.equal((await f.patch(valid)).status, 200);
  assert.equal((await f.patch(valid)).status, 409);
});

test('legacy grants explicitly convert to project selections without changing credentials or lifetime', async t => {
  const f = await fixture(t), expiry = new Date(Date.now() + 3600000);
  const legacy = f.tokens.create({ userId: f.owner.id, name: 'Legacy', scopes: ['read', 'operate', 'cli_dispatch'], allowedRoot: f.root, expiresAt: expiry });
  assert.equal((await f.patch({ projectIds: [f.a.id], expectedProjectIds: null }, legacy.record.id)).status, 200);
  const record = f.tokens.findActiveByToken(legacy.token)!;
  assert.equal(record.allowedRoot, null); assert.equal(record.tokenHash, legacy.record.tokenHash);
  assert.deepEqual(record.expiresAt, legacy.record.expiresAt); assert.equal(record.scopes, legacy.record.scopes);
  assert.equal(JSON.parse(record.allowedProjects!)[0].id, f.a.id);
});

test('revoked and expired credentials cannot be edited', async t => {
  const f = await fixture(t), valid = { projectIds: [f.b.id], expectedProjectIds: [f.a.id] };
  f.tokens.revokeByIdAndUser(f.grant.record.id, f.owner.id);
  assert.equal((await f.patch(valid)).status, 404);
  const expired = f.tokens.create({ userId: f.owner.id, name: 'Expired', scopes: ['read'],
    allowedProjects: snapshotMcpProjects(f.db, f.owner.id, [f.a.id]), expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await f.patch(valid, expired.record.id)).status, 404);
});

test('project update CAS refuses a changed root snapshot or an expiry that occurred after reading', async t => {
  const f = await fixture(t), original = f.grant.record.allowedProjects, selected = snapshotMcpProjects(f.db, f.owner.id, [f.b.id]);
  const changed = JSON.stringify([{ id: f.a.id, root: f.b.path }]);
  f.db.prepare('UPDATE mcp_access_tokens SET allowed_projects=? WHERE id=?').run(changed, f.grant.record.id);
  assert.equal(f.tokens.updateProjects(f.grant.record.id, f.owner.id, selected, original), undefined);
  assert.equal(f.tokens.listByUser(f.owner.id)[0]?.allowedProjects, changed);
  f.db.prepare('UPDATE mcp_access_tokens SET allowed_projects=?,expires_at=? WHERE id=?')
    .run(original, Math.floor(Date.now() / 1000) - 60, f.grant.record.id);
  assert.equal(f.tokens.updateProjects(f.grant.record.id, f.owner.id, selected, original), undefined);
  assert.equal(f.tokens.listByUser(f.owner.id)[0]?.allowedProjects, original);
  f.db.prepare('UPDATE mcp_access_tokens SET expires_at=NULL WHERE id=?').run(f.grant.record.id);
  f.tokens.revokeByIdAndUser(f.grant.record.id, f.owner.id);
  assert.equal(f.tokens.updateProjects(f.grant.record.id, f.owner.id, selected, original), undefined);
  assert.equal(f.tokens.listByUser(f.owner.id)[0]?.allowedProjects, original);
});
