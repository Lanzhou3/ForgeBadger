import assert from 'node:assert/strict';
import { it } from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import WebSocket from 'ws';
import { signJwt } from '../src/auth/index.js';
import { createGatewayApp } from '../src/server.js';
import { InMemoryApiKeyStore } from '../src/secrets/api-key-store.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { SessionServer } from '../src/services/session-server/session-server.js';
import { IpcServer } from '../src/services/session-server/ipc-server.js';
import { SessionServerClient } from '../src/services/session-server-client.js';
import { TerminalInputBuffer } from '../src/websocket/terminal.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';

const wheel = '\x1b[<65;10;10M';

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for terminal evidence');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

it('real WS and PTY deliver wheel under a writer lease, reject mixed input and close after user revocation', { timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'fb-wheel-ws-'));
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const users = new UserRepository(db);
  const user = users.create('wheel@test.local', 'hash');
  const project = new ProjectRepository(db, user.id).create({ name: 'Wheel', path: root, aiTool: 'codex' });
  const stored = new SessionRepository(db, user.id).create({ projectId: project.id, name: 'Viewer', aiTool: 'codex', workingDir: root, attachToken: 'wheel-attach-fixture' });
  const token = 'wheel-test-fixture-'.repeat(4);
  const jwtSecret = 'wheel-jwt-test-fixture-'.repeat(4);
  const masterKey = 'a'.repeat(64);
  const ipcPath = process.platform === 'win32' ? `\\\\.\\pipe\\fb-wheel-${process.pid}-${Date.now()}` : join(root, 'server.sock');
  const daemon = new SessionServer();
  const ipc = new IpcServer({ ipcPath, sessionServer: daemon, token });
  const backend = new SessionServerClient({ ipcPath, token });
  let ws: WebSocket | undefined;
  let app: ReturnType<typeof createGatewayApp> | undefined;
  try {
    await ipc.start();
    await backend.connect();
    const manager = new InMemorySessionManager(backend, undefined, undefined, { db });
    const session = await manager.createSession({ userId: user.id, sessionId: stored.id, attachToken: stored.attachToken, launchPlan: {
      command: process.execPath,
      args: ['-e', "process.stdin.setRawMode(true); process.stdin.resume(); process.stdout.write('READY\\r\\n'); process.stdin.on('data', data => process.stdout.write('INPUT:' + JSON.stringify(data.toString()) + '\\r\\n'));"],
      cwd: root, env: {}, secretEnvNames: [], credentialMode: 'host_environment',
    } });
    db.prepare("UPDATE sessions SET status='running', runtime_session_name=? WHERE id=?").run(session.runtimeSessionName, stored.id);
    const lease = manager.acquireWriterLease({ userId: user.id, sessionId: stored.id, workspace: root });
    app = createGatewayApp({ db, jwtSecret, masterKey, sessionManager: manager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }), eventBus: new ForgeBadgerEventBus(), sessionServerIpcPath: ipcPath, sessionServerToken: token });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/terminal/${stored.id}`, ['forgebadger-terminal', signJwt({ userId: user.id, email: user.email }, jwtSecret), stored.attachToken]);
    const frames: Array<{ type: string; payload: { data?: string; message?: string; sequence?: number } }> = [];
    const socket = ws;
    socket.on('message', raw => {
      const frame = JSON.parse(raw.toString()) as (typeof frames)[number];
      frames.push(frame);
      if (frame.payload.sequence !== undefined && socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'terminal_ack', payload: { sequence: frame.payload.sequence } }));
    });
    await once(socket, 'open');
    await until(() => daemon.getSession(session.runtimeSessionName)?.clientCount === 1 && frames.some(frame => frame.payload.data?.includes('READY')));
    socket.send(JSON.stringify({ type: 'terminal_input', payload: { data: wheel } }));
    await until(() => frames.some(frame => frame.payload.data?.includes(`INPUT:${JSON.stringify(wheel)}`)));
    socket.send(JSON.stringify({ type: 'terminal_input', payload: { data: wheel + 'x' } }));
    await until(() => frames.some(frame => frame.type === 'terminal_error' && frame.payload.message?.includes('Take over')));
    assert.equal(frames.some(frame => frame.payload.data?.includes(`INPUT:${JSON.stringify(wheel + 'x')}`)), false);
    manager.assertWriterLeaseCurrent(lease);
    const closed = once(socket, 'close');
    users.update(user.id, { status: 'disabled' });
    socket.send(JSON.stringify({ type: 'terminal_input', payload: { data: wheel } }));
    const [code] = await closed;
    assert.equal(code, 4403);
  } finally {
    ws?.terminate();
    if (app) await new Promise<void>(resolve => { app!.server.closeAllConnections?.(); app!.server.close(() => resolve()); });
    await backend.disconnect().catch(() => {});
    await ipc.stop().catch(() => {});
    await daemon.destroy();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('buffered wheel rechecks managed-project protection and does not mark real task evidence as manual intervention', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fb-wheel-auth-'));
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  try {
    const user = new UserRepository(db).create('wheel-auth@test.local', 'hash');
    const project = new ProjectRepository(db, user.id).create({ name: 'Wheel', path: root, aiTool: 'codex' });
    const session = new SessionRepository(db, user.id).create({ projectId: project.id, name: 'Viewer', aiTool: 'codex', workingDir: root });
    const pm = new ProjectManagerRepository(db, user.id);
    const item = pm.createWorkItem(project.id, { title: 'Dispatched task', details: { taskPacket: { attempt: { sessionId: session.id, status: 'dispatched' } } } });
    const manager = new InMemorySessionManager({ async createSession() {}, async killSession() {}, async listSessions() { return []; }, async capturePane() { return ''; } }, undefined, undefined, { db });
    await manager.createSession({ userId: user.id, sessionId: session.id, launchPlan: { command: 'codex', args: [], cwd: root, env: {}, secretEnvNames: [], credentialMode: 'host_environment' } });
    const lease = manager.acquireWriterLease({ userId: user.id, sessionId: session.id, workspace: root });
    const writes: string[] = [];
    const buffer = new TerminalInputBuffer(data => manager.assertTerminalInputAllowed(user.id, session.id, data));
    const evidence = () => db.prepare('SELECT details_json FROM project_manager_work_items WHERE id=? AND user_id=?').get(item.id, user.id);
    const before = evidence();
    buffer.writeOrStore({ write: data => writes.push(data) }, wheel);
    assert.deepEqual(evidence(), before);
    buffer.writeOrStore(undefined, wheel);
    // Protect the registered root for another actor while its wheel is buffered.
    const other = new UserRepository(db).create('other-wheel@test.local', 'hash');
    const protectedProject = new ProjectRepository(db, other.id).create({ name: 'Protected', path: root, aiTool: 'codex' });
    db.prepare('INSERT INTO collaboration_projects (user_id,project_id,protected_root) VALUES (?,?,?)').run(other.id, protectedProject.id, realpathSync(root));
    assert.throws(() => buffer.flush({ write: data => writes.push(data) }), /MANAGED_PROJECT_ACCESS_DENIED/);
    assert.deepEqual(writes, [wheel]);
    assert.deepEqual(evidence(), before);
    db.prepare('DELETE FROM collaboration_projects WHERE user_id=? AND project_id=?').run(other.id, protectedProject.id);
    manager.releaseWriterLease(lease);
    manager.assertTerminalInputAllowed(user.id, session.id, 'x');
    assert.notDeepEqual(evidence(), before, 'ordinary keyboard input must still invalidate task-specific evidence');
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
