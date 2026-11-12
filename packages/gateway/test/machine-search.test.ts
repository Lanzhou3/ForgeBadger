import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotMachineRootRepository } from '../src/db/repositories/copilot-machine-root-repository.js';
import { createMachineSearchTools } from '../src/services/agent/tools/machine-search.js';
import { createMachineRootListTools } from '../src/services/agent/tools/machine-roots.js';
import { checkAgentScope } from '../src/services/platform-commands/agent-scope.js';

// Run potentially blocking regressions in a disposable process, so a broken
// matcher fails the test without hanging the entire Gateway test runner.
async function isolatedPatternSearch(input: object, dir: string): Promise<{ error: string; heartbeats: number; recovered: boolean }> {
  const moduleUrl = new URL('../src/services/agent/tools/machine-search.ts', import.meta.url).href;
  const code = `
    import Database from 'better-sqlite3';
    import { createMachineSearchTools } from ${JSON.stringify(moduleUrl)};
    const db = new Database(':memory:');
    db.exec('CREATE TABLE copilot_machine_roots(id TEXT,user_id TEXT,label TEXT,path TEXT,created_at INTEGER)');
    db.prepare('INSERT INTO copilot_machine_roots VALUES(?,?,?,?,?)').run('root','user','test',${JSON.stringify(dir)},0);
    let heartbeats = 0;
    const timer = setInterval(() => heartbeats++, 25);
    let error = '';
    let recovered = false;
    try { await createMachineSearchTools()[0].execute(${JSON.stringify(input)}, {db,userId:'user'}); }
    catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    try {
      const next = await createMachineSearchTools()[0].execute({root:'root',query:'a'}, {db,userId:'user'});
      recovered = next.matches.length === 1;
    } finally { clearInterval(timer); db.close(); }
    console.log(JSON.stringify({error,heartbeats,recovered}));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', code], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Pattern search did not finish: ${signal ?? code}; ${stderr}`));
      try { resolve(JSON.parse(stdout) as { error: string; heartbeats: number; recovered: boolean }); }
      catch (error) { reject(error); }
    });
  });
}

for (const pattern of [
  { query: '(a+)+$', mode: 'regex' },
  { query: '(a|aa)+$', mode: 'regex' },
  { query: 'a', pathGlob: '*a'.repeat(24) + 'z' },
]) {
  it(`bounds expensive patterns and keeps the event loop responsive: ${JSON.stringify(pattern)}`, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fb-pattern-timeout-'));
    try {
      writeFileSync(path.join(dir, 'a'.repeat(100) + '.txt'), 'a'.repeat(100) + '!');
      const result = await isolatedPatternSearch({ root: 'root', ...pattern }, dir);
      assert.match(result.error, /MACHINE_SEARCH_TIMEOUT/);
      assert.ok(result.heartbeats > 0, 'the Gateway event loop must continue while matching');
      assert.equal(result.recovered, true, 'a normal search must succeed after the timed-out worker is terminated');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const userId = new UserRepository(db).create('machine@test.dev', 'hash').id;
  const dir = mkdtempSync(path.join(tmpdir(), 'fb-machine-search-'));
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'alpha.ts'), 'const answer = 42;\nexport {};\n');
  writeFileSync(path.join(dir, 'src', 'beta.js'), 'console.log("needle");\n');
  writeFileSync(path.join(dir, 'notes.md'), '# readme\nthe quick brown fox\n');
  return { db, userId, dir };
}

async function runSearch(context: { db: Database; userId: string }, input: unknown): Promise<any> {
  return createMachineSearchTools()[0]!.execute(input, context);
}

it('searches an owner-registered local root and returns redacted, line-numbered matches', async () => {
  const f = fixture();
  try {
    const root = new CopilotMachineRootRepository(f.db, f.userId).register('home', f.dir)!;
    assert.ok(root);
    const out = await runSearch(f, { root: root.id, query: 'needle' });
    assert.deepEqual(out.matches.map((m: any) => m.path), ['src/beta.js']);
    assert.equal(out.matches[0].line, 1);
    assert.ok(String(out.matches[0].text).includes('needle'));
    const alpha = await runSearch(f, { root: root.id, query: 'answer' });
    assert.deepEqual(alpha.matches.map((m: any) => m.path), ['src/alpha.ts']);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

it('preserves regex pagination, glob escaping, line numbers and redaction', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.dir, 'a[1].txt'), 'needle one\nneedle two\nneedle sk-test-abcdefghijklmnopqrstuvwxyz1234567890\n');
    writeFileSync(path.join(f.dir, 'a1.txt'), 'needle excluded\n');
    const root = new CopilotMachineRootRepository(f.db, f.userId).register('home', f.dir)!;
    const input = { root: root.id, query: 'needle.*', mode: 'regex', pathGlob: 'a[1].txt', limit: 1 };
    const first = await runSearch(f, input);
    assert.deepEqual(first.matches.map((match: { path: string; line: number }) => [match.path, match.line]), [['a[1].txt', 1]]);
    const second = await runSearch(f, { ...input, offset: first.nextOffset, lineOffset: first.nextLineOffset });
    assert.equal(second.matches[0].line, 2);
    const third = await runSearch(f, { ...input, offset: second.nextOffset, lineOffset: second.nextLineOffset });
    assert.equal(third.matches[0].line, 3);
    assert.ok(!third.matches[0].text.includes('abcdefghijklmnopqrstuvwxyz1234567890'));
    const exhausted = await runSearch(f, { ...input, offset: third.nextOffset, lineOffset: third.nextLineOffset });
    assert.deepEqual(exhausted.matches, []);
    assert.equal(exhausted.nextOffset, null);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

it('rejects an unregistered or another-tenant root at the scope seam', () => {
  const f = fixture();
  try {
    assert.throws(() => checkAgentScope({ ...f, db: f.db } as any, 'machine_search', { root: 'nope' }), /MACHINE_ROOT_NOT_FOUND/);
    const root = new CopilotMachineRootRepository(f.db, f.userId).register('home', f.dir)!;
    const other = new UserRepository(f.db).create('other@test.dev', 'hash').id;
    assert.equal(new CopilotMachineRootRepository(f.db, other).getById(root.id), undefined);
    assert.throws(() => checkAgentScope({ ...f, userId: other, db: f.db } as any, 'machine_search', { root: root.id }), /MACHINE_ROOT_NOT_FOUND/);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

it('narrows with pathGlob, extFilter and regex mode', async () => {
  const f = fixture();
  try {
    const root = new CopilotMachineRootRepository(f.db, f.userId).register('home', f.dir)!;
    const jsOnly = await runSearch(f, { root: root.id, query: 'needle', extFilter: ['js'] });
    assert.deepEqual(jsOnly.matches.map((m: any) => m.path), ['src/beta.js']);
    const glob = await runSearch(f, { root: root.id, query: 'needle', pathGlob: 'src/*.js' });
    assert.deepEqual(glob.matches.map((m: any) => m.path), ['src/beta.js']);
    const noGlob = await runSearch(f, { root: root.id, query: 'needle', pathGlob: 'src/*.ts' });
    assert.equal(noGlob.matches.length, 0);
    // regex mode matches a pattern a literal search would not (the alternation `|`)
    const regex = await runSearch(f, { root: root.id, query: 'quick|swift', mode: 'regex' });
    assert.deepEqual(regex.matches.map((m: any) => m.path), ['notes.md']);
    const literalSame = await runSearch(f, { root: root.id, query: 'quick|swift' });
    assert.equal(literalSame.matches.length, 0);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

it('reads a full file from a machine root and refuses an unregistered one', async () => {
  const f = fixture();
  try {
    const tools = Object.fromEntries(createMachineSearchTools().map(t => [t.name, t]));
    const read = tools.read_machine_file!;
    const root = new CopilotMachineRootRepository(f.db, f.userId).register('home', f.dir)!;
    const out = await read.execute({ root: root.id, path: 'src/alpha.ts' }, f);
    assert.ok(String(out.content).includes('const answer = 42'));
    assert.ok(out.sha256 && out.bytes > 0);
    await assert.rejects(read.execute({ root: 'nope', path: 'src/alpha.ts' }, f), /MACHINE_ROOT_NOT_FOUND/);
    // path escapes are refused by the guarded reader (a directory, not a file)
    await assert.rejects(read.execute({ root: root.id, path: 'src' }, f), /DEVELOPMENT_SOURCE_NOT_REGULAR/);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

it('lists the owner\'s machine roots and hides them from other tenants', async () => {
  const f = fixture();
  try {
    const tools = Object.fromEntries(createMachineRootListTools().map(t => [t.name, t]));
    const list = tools.list_machine_roots!;
    assert.deepEqual((await list.execute({}, f)).roots, []);
    const repo = new CopilotMachineRootRepository(f.db, f.userId);
    const a = repo.register('home', f.dir)!;
    const out = await list.execute({}, f);
    assert.deepEqual(out.roots.map(r => r.id), [a.id]);
    assert.deepEqual(out.roots[0], { id: a.id, label: 'home', path: f.dir });
    // tenant isolation
    const other = new UserRepository(f.db).create('iso@test.dev', 'hash').id;
    assert.deepEqual((await list.execute({}, { ...f, userId: other })).roots, []);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

it('builds a bounded directory map with per-directory counts and a truncation flag', async () => {
  const f = fixture();
  try {
    const tools = Object.fromEntries(createMachineSearchTools().map(t => [t.name, t]));
    const tree = tools.machine_tree!;
    const root = new CopilotMachineRootRepository(f.db, f.userId).register('home', f.dir)!;
    const out = await tree.execute({ root: root.id }, f);
    assert.deepEqual([...out.files].sort(), ['notes.md', 'src/alpha.ts', 'src/beta.js']);
    assert.deepEqual(out.directories, [{ directory: 'src', files: 2 }, { directory: '.', files: 1 }]);
    assert.equal(out.count, 3);
    assert.equal(out.truncated, false);
    const capped = await tree.execute({ root: root.id, limit: 1 }, f);
    assert.equal(capped.files.length, 1);
    assert.equal(capped.truncated, true);
    await assert.rejects(tree.execute({ root: 'nope' }, f), /MACHINE_ROOT_NOT_FOUND/);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

it('registers idempotently per canonical path and revokes on unregister', async () => {
  const f = fixture();
  try {
    const repo = new CopilotMachineRootRepository(f.db, f.userId);
    const first = repo.register('home', f.dir);
    assert.ok(first);
    assert.equal(repo.register('alias', f.dir), null);
    assert.equal(repo.list().length, 1);
    assert.ok(repo.unregister(first!.id));
    assert.equal(repo.list().length, 0);
    await assert.rejects(runSearch(f, { root: first!.id, query: 'x' }), /MACHINE_ROOT_NOT_FOUND/);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
