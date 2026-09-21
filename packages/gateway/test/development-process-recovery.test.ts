import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { it, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { DevelopmentTaskRepository } from '../src/db/repositories/development-task-repository.js';
import { hashText } from '../src/services/development/workspace.js';
import type { DevelopmentTaskRow, DevelopmentEvidence } from '../src/services/development/contracts.js';

const unsupported = process.platform !== 'darwin';
const originalSource = 'module.exports=(a,b)=>a-b;';
const passingCheck = "require('node:test').test('sum',()=>require('node:assert/strict').equal(require('./sum.cjs')(2,3),5));";
const worker = fileURLToPath(new URL('./fixtures/development-process-worker.ts', import.meta.url));

function fixture(t: TestContext, check = passingCheck) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'development-process-recovery-'));
  const projectRoot = path.join(dir, 'project');
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(projectRoot, 'sum.cjs'), originalSource);
  fs.writeFileSync(path.join(projectRoot, 'sum.test.cjs'), check);
  const database = path.join(dir, 'fixture.db');
  const db = new Database(database);
  db.pragma('foreign_keys=ON');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('process-fixture@test.local', 'hash');
  const project = new ProjectRepository(db, user.id).create({ name: 'process-fixture', path: projectRoot, aiTool: 'codex' });
  const plan = { projectId: project.id, goal: 'Fix approved sum', sourceFiles: ['sum.cjs', 'sum.test.cjs'], changes: [{ path: 'sum.cjs', beforeSha256: hashText(originalSource), content: 'module.exports=(a,b)=>a+b;' }], checks: [{ path: 'sum.test.cjs', sha256: hashText(check) }] };
  const config = path.join(dir, 'fixture.json');
  fs.writeFileSync(config, JSON.stringify({ database, userId: user.id, plan }));
  db.close();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, database, config, projectRoot, userId: user.id, projectId: project.id };
}

function start(t: TestContext, config: string, mode: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', worker, config, mode], { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += String(data); });
  child.stderr.on('data', data => { stderr += String(data); });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 25000);
  void done.finally(() => clearTimeout(deadline));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await done; });
  return { child, done, stdout: () => stdout, stderr: () => stderr };
}

interface WorkerResult {
  pid: number;
  taskId?: string;
  rows: DevelopmentTaskRow[];
  events: { eventId: string; status: string }[];
  pending: { id: string }[];
}
async function run(t: TestContext, config: string, mode: string): Promise<WorkerResult> {
  const process = start(t, config, mode);
  const exit = await process.done;
  assert.equal(exit.code, 0, `worker ${mode}: ${process.stderr()}`);
  return JSON.parse(process.stdout().trim());
}
async function until<T>(read: () => T | undefined, timeout = 10000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = read();
    if (result !== undefined) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('fixture observation deadline exceeded');
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
function observe(database: string, userId: string, taskId: string) {
  const db = new Database(database, { readonly: true });
  try { return new DevelopmentTaskRepository(db, userId).get(taskId)!; } finally { db.close(); }
}
function scratchPid(dir: string): number | undefined {
  const base = path.join(dir, 'development-workspaces');
  if (!fs.existsSync(base)) return undefined;
  for (const entry of fs.readdirSync(base)) {
    if (!entry.startsWith('.copilot-sandbox-')) continue;
    try {
      const pid = Number(fs.readFileSync(path.join(base, entry, 'child.pid'), 'utf8'));
      if (Number.isSafeInteger(pid) && pid > 1) return pid;
    } catch { /* Await sandbox startup. */ }
  }
  return undefined;
}

it('a queued task crosses real process exits and executes its approved check exactly once', { skip: unsupported }, async t => {
  const f = fixture(t);
  const admitted = await run(t, f.config, 'submit');
  const queued = observe(f.database, f.userId, admitted.taskId!);
  assert.equal(queued.status, 'queued');
  assert.equal(queued.workspace_path, null);
  const executed = await run(t, f.config, 'execute');
  assert.notEqual(executed.pid, admitted.pid);
  const row = executed.rows[0]!;
  assert.equal(row.status, 'checks_passed', row.error ?? '');
  const evidence = JSON.parse(row.evidence_json!) as DevelopmentEvidence;
  assert.equal(evidence.checks.length, 1);
  assert.equal(evidence.checks[0]!.exitCode, 0);
  assert.match(evidence.checks[0]!.stdout, /sum/);
  assert.equal(executed.events.filter(event => event.status === 'running').length, 1);
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'sum.cjs'), 'utf8'), originalSource);
  const restarted = await run(t, f.config, 'execute');
  assert.equal(restarted.rows[0]!.revision, row.revision);
  assert.equal(restarted.rows[0]!.evidence_json, row.evidence_json);
  assert.equal(restarted.rows[0]!.artifact_digest, row.artifact_digest);
  assert.deepEqual(restarted.events, []);
});

it('SIGKILL of a running Gateway kills its sandbox; expired lease recovery retains the host slot without replay', { skip: unsupported }, async t => {
  const check = "require('node:fs').writeFileSync(process.env.TMPDIR+'/child.pid',String(process.pid));require('node:test').test('wait',async()=>{await new Promise(r=>setTimeout(r,50000))});";
  const f = fixture(t, check);
  const admitted = await run(t, f.config, 'submit');
  const gateway = start(t, f.config, 'hold');
  const childPid = await until(() => scratchPid(f.dir));
  t.after(() => { if (alive(childPid)) process.kill(childPid, 'SIGKILL'); });
  const running = observe(f.database, f.userId, admitted.taskId!);
  assert.equal(running.status, 'running');
  assert.ok(running.workspace_path);
  assert.ok(alive(childPid));
  gateway.child.kill('SIGKILL');
  assert.equal((await gateway.done).signal, 'SIGKILL');
  await until(() => alive(childPid) ? undefined : true);
  const interrupted = observe(f.database, f.userId, admitted.taskId!);
  assert.equal(interrupted.status, 'running');
  assert.equal(interrupted.evidence_json, null);
  // Wait for the actual persisted lease, without changing the database or clock.
  await until(() => Date.now() > interrupted.lease_expires_at! ? true : undefined, 17000);
  const otherRoot = path.join(f.dir, 'other-project');
  fs.cpSync(f.projectRoot, otherRoot, { recursive: true });
  const setupDb = new Database(f.database);
  let otherProjectId: string;
  try { otherProjectId = new ProjectRepository(setupDb, f.userId).create({ name: 'other-project', path: otherRoot, aiTool: 'codex' }).id; }
  finally { setupDb.close(); }
  const otherConfig = path.join(f.dir, 'other-fixture.json');
  const input = JSON.parse(fs.readFileSync(f.config, 'utf8'));
  fs.writeFileSync(otherConfig, JSON.stringify({ ...input, plan: { ...input.plan, projectId: otherProjectId } }));
  const queued = await run(t, otherConfig, 'submit');
  const recovered = await run(t, f.config, 'recover');
  const uncertain = recovered.rows.find(row => row.id === admitted.taskId)!;
  assert.equal(uncertain.status, 'indeterminate');
  assert.equal(uncertain.owner, interrupted.owner);
  assert.equal(uncertain.lease_expires_at, interrupted.lease_expires_at);
  assert.equal(uncertain.workspace_path, interrupted.workspace_path);
  assert.equal(uncertain.evidence_json, null);
  assert.match(uncertain.error!, /automatic replay prohibited/);
  assert.equal(observe(f.database, f.userId, queued.taskId!).status, 'queued');
  const evidenceDb = new Database(f.database, { readonly: true });
  try {
    const runningEvents = evidenceDb.prepare("SELECT COUNT(*) count FROM copilot_development_events WHERE user_id=? AND task_id=? AND status='running'").get(f.userId, admitted.taskId) as { count: number };
    assert.equal(runningEvents.count, 1);
  } finally { evidenceDb.close(); }
  const restarted = await run(t, f.config, 'recover');
  assert.equal(restarted.rows.find(row => row.id === admitted.taskId)!.revision, uncertain.revision);
  assert.equal(observe(f.database, f.userId, queued.taskId!).status, 'queued');
  assert.deepEqual(restarted.events, []);
  assert.equal(alive(childPid), false);
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'sum.cjs'), 'utf8'), originalSource);
});

it('failed outbox delivery retries across process restart with the same event identities', async t => {
  const f = fixture(t);
  await run(t, f.config, 'submit-cancel');
  const failed = await run(t, f.config, 'outbox-fail');
  assert.equal(failed.rows[0]!.status, 'cancelled');
  assert.equal(failed.pending.length, 2);
  const attempted = new Set(failed.events.map(event => event.eventId));
  assert.deepEqual(attempted, new Set(failed.pending.map(event => event.id)));
  const delivered = await run(t, f.config, 'recover');
  assert.notEqual(delivered.pid, failed.pid);
  assert.deepEqual(new Set(delivered.events.map(event => event.eventId)), attempted);
  assert.deepEqual(delivered.pending, []);
  assert.equal(delivered.rows[0]!.revision, failed.rows[0]!.revision);
  const again = await run(t, f.config, 'recover');
  assert.deepEqual(again.events, []);
});
