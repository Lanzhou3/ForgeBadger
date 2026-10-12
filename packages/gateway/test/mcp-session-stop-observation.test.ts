import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createMcpRoutes } from '../src/routes/mcp.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { McpTokenRepository } from '../src/db/repositories/mcp-token-repository.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';

async function fixture(t: TestContext, isolated = true, persistent = false) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'fb-mcp-stop-')));
  const dbPath = path.join(root, 'fixture.sqlite');
  let db = new Database(persistent ? dbPath : ':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const userId = new UserRepository(db).create('mcp-stop@example.test', 'hash').id;
  const project = new ProjectRepository(db, userId).create({ name: 'fixture', path: root, aiTool: 'codex' });
  const sessions = new SessionRepository(db, userId);
  const tokenRepo = new McpTokenRepository(db);
  const issue = () => tokenRepo.create({ userId, name: 'fixture', scopes: ['read', 'operate', 'cli_dispatch'],
    allowedRoot: root, expiresAt: new Date(Date.now() + 3600000) });
  const grant = issue(), other = issue();
  const panes = new Map<string, string>(), killed: string[] = [];
  const manager = new InMemorySessionManager({
    async createSession() {}, async listSessions() { return [...panes.keys()]; },
    async hasSession(name) { return panes.has(name); },
    async killSession(name) { killed.push(name); panes.delete(name); },
    async capturePane(name) { return panes.get(name) ?? ''; },
    async inspectPane(name) { return { content: panes.get(name) ?? '', dead: !panes.has(name) }; }
  });
  const session = sessions.create({ projectId: project.id, name: 'task-packet', aiTool: 'codex', workingDir: root });
  const live = await manager.createSession({ userId, sessionId: session.id,
    launchPlan: { command: 'codex', args: isolated ? ['--no-daemon'] : [], cwd: root, env: {}, secretEnvNames: [], credentialMode: 'host_environment' } });
  sessions.update(session.id, { status: 'running', runtimeSessionName: live.runtimeSessionName, attachToken: live.attachToken });
  panes.set(live.runtimeSessionName, `PRIVATE_TERMINAL_MARKER\nGPT-6 · ${root} · task-packet`);
  let server: Server;
  async function listen() {
    const app = express(); app.use(express.json());
    app.use('/mcp', createMcpRoutes({ db, masterKey: 'x'.repeat(32), sessionManager: manager, appVersion: 'test' }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  }
  await listen();
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(root, { recursive: true, force: true }); });
  async function rpc(name: string, input: Record<string, unknown>, token = grant.token) {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } })
    });
    assert.equal(response.status, 200);
    const data = (await response.text()).split('\n').find(line => line.startsWith('data:'))!;
    return (JSON.parse(data.slice(5)) as { result: { isError?: boolean; content: Array<{ text: string }> } }).result;
  }
  async function observe() {
    const result = await rpc('get_session_output', { sessionId: session.id });
    assert.notEqual(result.isError, true);
    const value = JSON.parse(result.content[0]!.text) as { live: boolean; target?: { observationId: string; taskTitle: string } };
    assert.equal(value.live, true); assert.ok(value.target, 'MCP live read must issue a durable stop target');
    return { sessionId: session.id, observationId: value.target.observationId, expectedTitle: value.target.taskTitle };
  }
  return { get db() { return db; }, userId, root, session: sessions.getById(session.id)!, manager, sessions, grant, other, panes, killed, rpc, observe,
    async reconnectGateway(reopenDb = false) {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (reopenDb) { assert.equal(persistent, true); db.close(); db = new Database(dbPath); }
      await listen();
    } };
}

test('MCP observation survives stateless Gateway recreation, stops exactly once, stores metadata only', async t => {
  const f = await fixture(t, true, true); const observed = await f.observe();
  assert.equal(observed.expectedTitle, 'task-packet');
  const rows = f.db.prepare("SELECT result_json FROM copilot_operation_log WHERE operation='mcp.session_observation'").all();
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_TERMINAL_MARKER|terminalExcerpt|attachToken/);
  await f.reconnectGateway(true);
  const input = { ...observed, operationId: 'stop-once' };
  const first = await f.rpc('stop_session', input);
  assert.notEqual(first.isError, true, first.content[0]!.text);
  const retry = await f.rpc('stop_session', input);
  assert.deepEqual(retry, first); assert.equal(f.killed.length, 1);
});

test('another tenant cannot use an MCP stop observation', async t => {
  const f = await fixture(t), observed = await f.observe();
  const userId = new UserRepository(f.db).create('other-mcp-owner@example.test', 'hash').id;
  const grant = new McpTokenRepository(f.db).create({ userId, name: 'other', scopes: ['read', 'operate'] });
  const result = await f.rpc('stop_session', observed, grant.token);
  assert.equal(result.isError, true); assert.deepEqual(f.killed, []);
  assert.match(result.content[0]!.text, /Session not found/);
});

test('cached MCP terminal output never creates a stop observation', async t => {
  const f = await fixture(t);
  f.panes.delete(f.session.runtimeSessionName!);
  const result = await f.rpc('get_session_output', { sessionId: f.session.id });
  const output = JSON.parse(result.content[0]!.text) as { live: boolean; target?: unknown };
  assert.equal(output.live, false); assert.equal(output.target, undefined);
});

test('MCP observations cannot be reused by another token or another target', async t => {
  const f = await fixture(t); const observed = await f.observe();
  for (const [input, token] of [
    [{ ...observed, operationId: 'cross-token' }, f.other.token],
    [{ ...observed, expectedTitle: 'another', operationId: 'wrong-title' }, f.grant.token]
  ] as const) {
    assert.equal((await f.rpc('stop_session', input, token)).isError, true);
  }
  assert.deepEqual(f.killed, []);
});

for (const mode of ['expired', 'restarted', 'title-changed'] as const) test(`MCP stop refuses ${mode} observation`, async t => {
  const f = await fixture(t); const observed = await f.observe();
  if (mode === 'expired') f.db.prepare("UPDATE copilot_operation_log SET created_at=? WHERE operation='mcp.session_observation'").run(Date.now() - 16 * 60000);
  if (mode === 'restarted') f.sessions.update(f.session.id, { attachToken: 'replacement' });
  if (mode === 'title-changed') f.panes.set(f.session.runtimeSessionName!, 'GPT-6 · /tmp · other');
  const result = await f.rpc('stop_session', { ...observed, operationId: mode });
  assert.equal(result.isError, true); assert.deepEqual(f.killed, []);
});

test('legacy shared Codex daemon remains unverified even with an MCP observation', async t => {
  const f = await fixture(t, false); const observed = await f.observe();
  const result = await f.rpc('stop_session', { ...observed, operationId: 'legacy' });
  assert.equal(result.isError, true); assert.match(result.content[0]!.text, /EXECUTION_SCOPE_UNVERIFIED/);
  assert.deepEqual(f.killed, []);
});
