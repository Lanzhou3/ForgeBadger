import { realpathSync } from 'node:fs';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { createSessionTools } from '../src/services/agent/tools/sessions.js';
import { executeAgentTool } from '../src/services/agent/tool-registry.js';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
interface Output { found: boolean; live?: boolean; source?: string; output: string; lineCount?: number; truncated?: boolean; }

async function fixture(options: { inspect?: boolean } = {}) {
  const db = new Database(':memory:');
  databases.push(db);
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('screen@test.dev', 'hash');
  const project = new ProjectRepository(db, user.id).create({ name: 'readback', path: '/tmp/forgebadger-output-fixture', aiTool: 'codex' });
  const sessions = new SessionRepository(db, user.id);
  const session = sessions.create({ projectId: project.id, name: 'headless', aiTool: 'codex', workingDir: project.path });
  const state = { screen: 'Do you trust the contents of this directory?\n› Yes, continue\n  No, exit', dead: false, fail: false, inspectReads: 0, historyReads: 0, livenessReads: 0 };
  const manager = new InMemorySessionManager({
    async createSession() {}, async killSession() {}, async listSessions() { return []; },
    async hasSession() { state.livenessReads++; return !state.dead; },
    async capturePane() { state.historyReads++; if (state.fail) throw new Error('daemon unavailable'); return state.screen; },
    ...(options.inspect === false ? {} : {
      async inspectPane() { state.inspectReads++; if (state.fail) throw new Error('daemon unavailable'); return { content: state.screen, dead: state.dead }; }
    })
  }, undefined, undefined, { db });
  const live = await manager.createSession({ userId: user.id, sessionId: session.id, launchPlan: { command: 'codex', args: [], cwd: project.path, env: {}, secretEnvNames: [], credentialMode: 'host_environment' } });
  sessions.update(session.id, { status: 'running', runtimeSessionName: live.runtimeSessionName });
  const tool = createSessionTools().find(item => item.name === 'get_session_output')!;
  const read = async (maxLines?: number, userId = user.id): Promise<Output> => {
    const result = await executeAgentTool(tool, { sessionId: session.id, ...(maxLines === undefined ? {} : { maxLines }) }, { db, userId, masterKey: 'fixture', sessionManager: manager });
    assert.equal(result.ok, true, result.error);
    return result.output as Output;
  };
  return { db, user, project, session, manager, state, read };
}

describe('Copilot headless session output', () => {
  it('reads a native trust prompt from a real manager without any browser output ring and prefers inspectPane', async () => {
    const f = await fixture();
    assert.equal(f.manager.getSessionOutput(f.session.id), undefined);
    const output = await f.read();
    assert.equal(output.found, true);
    assert.equal(output.live, true);
    assert.equal(output.source, 'session_server');
    assert.match(output.output, /Do you trust the contents/);
    assert.match(output.output, /Yes, continue/);
    assert.equal(f.state.inspectReads, 1);
    assert.equal(f.state.historyReads, 0);
    assert.equal(f.manager.getSessionOutput(f.session.id), undefined);
  });

  it('does not read snapshots or cached terminal content across tenants', async () => {
    const f = await fixture();
    const other = new UserRepository(f.db).create('other-screen@test.dev', 'hash');
    f.manager.appendSessionOutput(f.session.id, 'private cached output');
    const output = await f.read(undefined, other.id);
    assert.deepEqual(output, { found: false, output: '' });
    await assert.rejects(f.manager.captureScreen(other.id, f.session.id), /SESSION_NOT_FOUND/);
    assert.equal(f.state.inspectReads, 0);
    assert.equal(f.state.historyReads, 0);
  });

  it('marks cached fallback non-live when the daemon snapshot fails, even while the database says running', async () => {
    const f = await fixture();
    f.manager.appendSessionOutput(f.session.id, 'previous screen\nwaiting for confirmation');
    f.state.fail = true;
    const output = await f.read();
    assert.equal(output.source, 'cached');
    assert.equal(output.live, false);
    assert.equal(output.output, 'previous screen\nwaiting for confirmation');
    assert.equal(f.manager.getSession(f.session.id)?.status, 'running');
    assert.equal(f.state.inspectReads, 1);
  });

  it('returns unavailable rather than asserting completion when both snapshot and cache are absent', async () => {
    const f = await fixture();
    f.state.fail = true;
    const output = await f.read();
    assert.deepEqual(output, { found: true, live: false, source: 'unavailable', output: '', truncated: false, lineCount: 0 });
  });

  it('honors maxLines for snapshot and cache while keeping the full source line count', async () => {
    const f = await fixture();
    f.state.screen = 'line 1\nline 2\nline 3\nline 4\nline 5\n';
    const live = await f.read(2);
    assert.equal(live.output, 'line 4\nline 5');
    assert.equal(live.lineCount, 5);
    f.manager.appendSessionOutput(f.session.id, 'old 1\nold 2\nold 3\nold 4');
    f.state.fail = true;
    const cached = await f.read(2);
    assert.equal(cached.output, 'old 3\nold 4');
    assert.equal(cached.lineCount, 4);
    assert.equal(cached.live, false);
  });

  it('reports a dead inspected terminal as non-live and supports backend capture fallback with a liveness probe', async () => {
    const inspected = await fixture();
    inspected.state.dead = true;
    const dead = await inspected.read();
    assert.equal(dead.live, false);
    assert.equal(dead.source, 'session_server');
    const captured = await fixture({ inspect: false });
    const live = await captured.read();
    assert.equal(live.live, true);
    assert.equal(live.source, 'session_server');
    assert.equal(captured.state.historyReads, 1);
    assert.equal(captured.state.livenessReads, 1);
  });
  it('does not return cached output after managed-project authority denies screen access', async () => {
    const f = await fixture();
    f.manager.appendSessionOutput(f.session.id, 'private cache must remain protected');
    const other = new UserRepository(f.db).create('protected-root@test.dev', 'hash');
    const protectedProject = new ProjectRepository(f.db, other.id).create({ name: 'protected', path: '/tmp', aiTool: 'codex' });
    f.db.prepare('INSERT INTO collaboration_projects(project_id,user_id,protected_root) VALUES(?,?,?)').run(protectedProject.id, other.id, realpathSync('/tmp'));
    await assert.rejects(f.manager.captureScreen(f.user.id, f.session.id), /MANAGED_PROJECT_ACCESS_DENIED/);
    const tool = createSessionTools().find(item => item.name === 'get_session_output')!;
    const result = await executeAgentTool(tool, { sessionId: f.session.id }, { db: f.db, userId: f.user.id, masterKey: 'fixture', sessionManager: f.manager });
    // Tenant/path filtering hides inaccessible rows before snapshot/cache lookup.
    assert.deepEqual(result, { ok: true, output: { found: false, output: '' } });
    assert.ok(!JSON.stringify(result).includes('private cache'));
    assert.equal(f.state.inspectReads, 0);
  });

});
