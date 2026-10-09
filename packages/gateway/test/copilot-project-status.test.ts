import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from "node:url";
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { readProjectGitStatus, summarizeGitStatus } from '../src/services/development/project-git-status.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { executeAgentTool, createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { selectDiscoveredTools } from '../src/services/agent/tool-discovery.js';

function repo(t: TestContext, commit = true) {
  const root = mkdtempSync(join(tmpdir(), 'fb-status-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  git('init', '-q'); git('config', 'user.email', 'fixture@test.dev'); git('config', 'user.name', 'Fixture');
  if (commit) { writeFileSync(join(root, 'main.ts'), 'initial\n'); git('add', '.'); git('commit', '-qm', 'initial'); }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, git };
}

it('counts the whole workspace, including hidden, large and untracked files, without returning contents or paths', async t => {
  const f = repo(t);
  for (let i = 0; i < 70; i++) writeFileSync(join(f.root, `file-${i}.ts`), 'same\n');
  f.git('add', '.'); f.git('commit', '-qm', 'many files');
  for (let i = 0; i < 70; i++) writeFileSync(join(f.root, `file-${i}.ts`), 'changed\n');
  writeFileSync(join(f.root, '.env'), 'PRIVATE_SECRET_CONTENT');
  writeFileSync(join(f.root, 'huge.ts'), 'x'.repeat(100000));
  mkdirSync(join(f.root, 'new-dir')); writeFileSync(join(f.root, 'new-dir', 'a.ts'), 'a'); writeFileSync(join(f.root, 'new-dir', 'b.ts'), 'b');
  symlinkSync('/etc/hosts', join(f.root, 'link'));
  const before = readFileSync(join(f.root, '.git', 'index'));
  const result = await readProjectGitStatus(f.root);
  assert.equal(result.counts.total, 75); assert.equal(result.counts.unstaged, 70); assert.equal(result.counts.untracked, 5);
  assert.equal(result.complete, true); assert.equal(result.clean, false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET_CONTENT|huge.ts|file-0|new-dir|localhost/);
  assert.deepEqual(readFileSync(join(f.root, '.git', 'index')), before, 'original index must not be refreshed');
});

it('deduplicates staged and unstaged changes and counts renames as one entry', async t => {
  const f = repo(t);
  writeFileSync(join(f.root, 'main.ts'), 'staged\n'); f.git('add', 'main.ts'); writeFileSync(join(f.root, 'main.ts'), 'unstaged\n');
  writeFileSync(join(f.root, 'rename.ts'), 'rename\n'); f.git('add', 'rename.ts'); f.git('commit', '-qm', 'base');
  f.git('mv', 'rename.ts', 'new\nname.ts');
  // main.ts still has an unstaged edit; stage another version to make MM.
  writeFileSync(join(f.root, 'main.ts'), 'staged-again\n'); f.git('add', 'main.ts'); writeFileSync(join(f.root, 'main.ts'), 'worktree\n');
  const result = await readProjectGitStatus(f.root);
  assert.deepEqual(result.counts, { total: 2, staged: 2, unstaged: 1, untracked: 0, conflicted: 0, stagedAndUnstaged: 1 });
  assert.equal(result.byStatus.R, undefined); assert.equal(result.byStatus['R '], 1); assert.equal(result.byStatus.MM, 1);
});

it('handles all conflict codes and rejects incomplete or invalid output instead of claiming zero', () => {
  const result = summarizeGitStatus(Buffer.from(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].map(code => `${code} file-${code}\0`).join('')));
  assert.equal(result.counts.conflicted, 7); assert.equal(result.counts.total, 7);
  assert.equal(result.counts.staged, 0); assert.equal(result.counts.unstaged, 0);
  for (const data of ['R  renamed\0', ' M partial', 'ZZ file\0', '\0', '?? \0']) assert.throws(() => summarizeGitStatus(Buffer.from(data)), /GIT_STATUS_INVALID/);
  assert.throws(() => summarizeGitStatus(Buffer.alloc(8 * 1024 * 1024 + 1)), /GIT_STATUS_LIMIT/);
});

it('supports unborn repositories, ignores ignored files, and reports a genuinely clean repository', async t => {
  const f = repo(t, false);
  assert.equal((await readProjectGitStatus(f.root)).clean, true);
  writeFileSync(join(f.root, '.gitignore'), 'ignored\n'); writeFileSync(join(f.root, 'ignored'), 'secret');
  f.git('add', '.gitignore');
  const result = await readProjectGitStatus(f.root);
  assert.equal(result.counts.total, 1); assert.equal(result.counts.staged, 1);
});

it('rejects active filters rather than running commands or changing Git normalization semantics', async t => {
  const f = repo(t), marker = join(f.root, 'filter-executed');
  writeFileSync(join(f.root, '.gitattributes'), '*.ts filter=custom\n');
  f.git('config', 'filter.custom.clean', `touch '${marker}'; cat`);
  await assert.rejects(readProjectGitStatus(f.root), /GIT_STATUS_FILTER_UNSUPPORTED/);
  assert.equal(existsSync(marker), false);
});

it('does not execute fsmonitor, external diff or hooks', async t => {
  const f = repo(t), marker = join(f.root, 'executed');
  f.git('config', 'core.fsmonitor', `touch '${marker}'`); f.git('config', 'diff.external', `touch '${marker}'`);
  writeFileSync(join(f.root, 'main.ts'), 'changed\n');
  assert.equal((await readProjectGitStatus(f.root)).counts.total, 1);
  assert.equal(existsSync(marker), false);
});

it('rejects parent Git discovery, linked gitdirs and cancellation', async t => {
  const f = repo(t); mkdirSync(join(f.root, 'nested'));
  await assert.rejects(readProjectGitStatus(join(f.root, 'nested')), /GIT_ROOT/);
  await assert.rejects(readProjectGitStatus(f.root, AbortSignal.abort()), /abort/i);
});

it('registers a core read tool and enforces tenant and research project scope', async t => {
  const f = repo(t), db = new Database(':memory:'); t.after(() => db.close());
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const owner = new UserRepository(db).create('status-owner@test.dev', 'hash');
  const other = new UserRepository(db).create('status-other@test.dev', 'hash');
  const project = new ProjectRepository(db, owner.id).create({ name: 'Status', path: f.root, aiTool: 'codex' });
  const registry = createAgentToolRegistry(createPlatformTools());
  const tool = registry.tools.get('get_project_git_status')!; assert.ok(tool); assert.equal(tool.requiresApproval, false);
  const schemas = selectDiscoveredTools({ allVisible: registry.toModelSchemas(), steps: [], userId: owner.id, runId: 'run', masterKey: 'key', enabled: true });
  assert.ok(schemas.some(s => s.name === tool.name));
  const context = { db, userId: owner.id, masterKey: 'key', executionMode: 'research', projectId: project.id };
  assert.equal((await executeAgentTool(tool, { projectId: project.id }, context)).ok, true);
  assert.equal((await executeAgentTool(tool, { projectId: project.id }, { ...context, userId: other.id })).ok, false);
  assert.equal((await executeAgentTool(tool, { projectId: project.id }, { ...context, projectId: 'other' })).ok, false);
});

it('deduplicates a path that is both staged for removal and untracked', async t => {
  const f = repo(t); f.git('rm', '--cached', 'main.ts');
  const result = await readProjectGitStatus(f.root);
  assert.equal(result.counts.total, 1);
  assert.equal(result.counts.staged, 1); assert.equal(result.counts.untracked, 1);
});

it('counts staged gitlink changes without entering a submodule worktree', async t => {
  const f = repo(t);
  f.git('update-index', '--add', '--cacheinfo', '160000', f.git('rev-parse', 'HEAD').trim(), 'submodule');
  mkdirSync(join(f.root, 'submodule')); writeFileSync(join(f.root, 'submodule', '.git'), 'gitdir: /private/do-not-enter\n');
  const result = await readProjectGitStatus(f.root);
  assert.equal(result.counts.total, 1); assert.equal(result.counts.staged, 1);
});

it('handles byte filenames and more than 2000 paths without the diff candidate limit', async t => {
  const summary = summarizeGitStatus(Buffer.from([63, 63, 32, 255, 0]));
  assert.equal(summary.counts.untracked, 1);
  const f = repo(t);
  for (let i = 0; i < 2001; i++) writeFileSync(join(f.root, `entry-${i}`), '');
  assert.equal((await readProjectGitStatus(f.root)).counts.untracked, 2001);
});

it('honors Git boolean semantics for required filters and sparse checkout', async t => {
  for (const key of ['filter.custom.required', 'core.sparseCheckout']) {
    const f = repo(t); f.git('config', key, '2');
    await assert.rejects(readProjectGitStatus(f.root), key.includes('filter') ? /FILTER_UNSUPPORTED/ : /SPARSE_UNSUPPORTED/);
  }
});

it('honors global normalization and exclusion settings, but refuses global executable filters', async t => {
  const f = repo(t), configDir = mkdtempSync(join(tmpdir(), 'fb-status-config-'));
  t.after(() => rmSync(configDir, { recursive: true, force: true }));
  const globalConfig = join(configDir, 'gitconfig'), ignoreFile = join(configDir, 'ignore');
  const invoke = () => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `import {readProjectGitStatus} from ${JSON.stringify(new URL('../src/services/development/project-git-status.ts', import.meta.url).href)}; try { console.log(JSON.stringify(await readProjectGitStatus(process.argv[1]))); } catch(e) { console.log(e.message); }`, f.root],
    { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' } });
  writeFileSync(ignoreFile, 'ignored-global\n');
  writeFileSync(globalConfig, `[core]\n autocrlf = true\n excludesFile = ${ignoreFile}\n`);
  writeFileSync(join(f.root, 'crlf.txt'), 'line\r\n'); f.git('-c', 'core.autocrlf=true', 'add', '.'); f.git('commit', '-qm', 'crlf');
  writeFileSync(join(f.root, 'crlf.txt'), 'line\r\n'); writeFileSync(join(f.root, 'ignored-global'), 'excluded');
  assert.equal(JSON.parse(invoke()).counts.total, 0);
  const marker = join(configDir, 'executed');
  writeFileSync(globalConfig, `[filter "evil"]\n process = touch ${marker}\n`);
  assert.match(invoke(), /FILTER_UNSUPPORTED/); assert.equal(existsSync(marker), false);
});

it('does not double-count a staged gitlink-to-file change with a further worktree edit', async t => {
  const f = repo(t), oid = f.git('rev-parse', 'HEAD').trim();
  f.git('update-index', '--add', '--cacheinfo', '160000', oid, 'target'); f.git('commit', '-qm', 'gitlink');
  writeFileSync(join(f.root, 'target'), 'staged text\n'); f.git('add', 'target'); writeFileSync(join(f.root, 'target'), 'edited text\n');
  const result = await readProjectGitStatus(f.root);
  assert.deepEqual(result.counts, { total: 1, staged: 1, unstaged: 1, untracked: 0, conflicted: 0, stagedAndUnstaged: 1 });
  assert.deepEqual(result.byStatus, { TM: 1 });
});

it('reports conflicted gitlinks without entering submodule worktrees', async t => {
  const f = repo(t), oid = f.git('rev-parse', 'HEAD').trim();
  f.git('update-index', '--add', '--cacheinfo', '160000', oid, 'conflict'); f.git('commit', '-qm', 'gitlink');
  execFileSync('git', ['-C', f.root, 'update-index', '--index-info'], {
    input: `0 ${'0'.repeat(40)}\tconflict\n` + [1, 2, 3].map(stage => `160000 ${oid} ${stage}\tconflict\n`).join(''),
  });
  const result = await readProjectGitStatus(f.root);
  assert.equal(result.counts.total, 1); assert.equal(result.counts.conflicted, 1);
  assert.equal(result.counts.staged, 0); assert.equal(result.counts.unstaged, 0);
});
