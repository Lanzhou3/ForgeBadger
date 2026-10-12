import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from "node:url";
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { RunGovernance } from '../src/services/agent/run-governance.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry, executeAgentTool } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { discoverToolSchemas } from '../src/services/agent/tool-discovery.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'fb-research-'));
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const userId = new UserRepository(db).create('research@test.dev', 'hash').id;
  const ledger = new CopilotRunLedger(db, userId);
  const project = new ProjectRepository(db, userId).create({ name: 'Research', path: root, aiTool: 'codex' });
  const registry = createAgentToolRegistry(createPlatformTools());
  const context = { db, userId, projectId: project.id, masterKey: 'test', executionMode: 'research' };
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, db, userId, ledger, project, registry, context };
}

it('execution boundary rejects writes, cross-project reads, nested delegation and misleading read tool names', async t => {
  const f = fixture(t);
  const get = f.registry.tools.get('get_project')!;
  assert.equal((await executeAgentTool(get, { projectId: f.project.id }, f.context)).ok, true);
  assert.equal((await executeAgentTool(get, { projectId: 'other' }, f.context)).ok, false);
  assert.equal((await executeAgentTool(f.registry.tools.get('research_project')!, { projectId: f.project.id, goal: 'recurse' }, f.context)).ok, false);
  let executed = false;
  const result = await executeAgentTool({ ...get, risk: 'operate', async execute() { executed = true; } }, { projectId: f.project.id }, f.context);
  assert.equal(result.ok, false); assert.equal(executed, false);
});

it('runs isolated research with inherited model, blocks forged writes, meters parent, and rejects a revoked origin', async t => {
  const f = fixture(t); let mainCalls = 0, childCalls = 0;
  const conversationId = f.ledger.log.createConversation().id;
  const orchestrator = createCopilotOrchestrator({ db: f.db, masterKey: 'test', eventBus: new ForgeBadgerEventBus(), toolRegistry: f.registry, llm: {
    async stream(request) {
      assert.equal(request.modelId, 'owner-model');
      const restricted = !request.tools.some(tool => tool.name === 'research_project');
      if (restricted) {
        childCalls++;
        assert.equal(request.tools.some(tool => tool.name === 'submit_development_task'), false);
        if (childCalls === 1) request.onEvent({ type: 'tool_call', toolCall: { id: 'forged', name: 'submit_development_task', arguments: JSON.stringify({ projectId: f.project.id, path: 'evil.ts', content: 'bad' }) } });
        return { message: 'Read-only findings', usage: { inputTokens: 10, outputTokens: 5 } };
      }
      if (++mainCalls === 1) request.onEvent({ type: 'tool_call', toolCall: { id: 'research', name: 'research_project', arguments: JSON.stringify({ projectId: f.project.id, goal: 'Inspect project' }) } });
      return { message: 'Parent report', usage: { inputTokens: 10, outputTokens: 5 } };
    }, async summarize() { return 'Summary'; }, async generateTitle() { return ''; }, async proposeMemory() { return []; }
  } });
  const parent = await orchestrator.runTurn({ userId: f.userId, conversationId, projectId: f.project.id, modelId: 'owner-model', userText: 'Inspect' });
  const jobs = f.db.prepare('SELECT child_run_id FROM copilot_research_jobs WHERE origin_run_id=?').all(parent) as Array<{ child_run_id: string }>;
  assert.equal(jobs.length, 1); assert.equal(childCalls, 2); assert.equal(mainCalls, 2);
  const child = jobs[0]!.child_run_id;
  assert.notEqual(f.ledger.get(child)!.conversation_id, conversationId);
  assert.match(f.ledger.steps(child).find(step => step.tool_name === 'submit_development_task')!.result_json!, /cannot execute/);
  const meter = new RunGovernance(f.db, f.userId, parent);
  assert.equal(meter.usage().reportedTokens, 60);
  f.db.prepare('UPDATE copilot_runs SET token_budget=1 WHERE id=?').run(parent);
  assert.throws(() => new RunGovernance(f.db, f.userId, child).check(), /token budget/);
  f.db.prepare("UPDATE copilot_runs SET status='cancelled' WHERE id=?").run(parent);
  assert.throws(() => f.ledger.validateScope(JSON.parse(f.ledger.get(child)!.input_json)), /origin is no longer valid/);
});

it('source search continues within a file and Chinese discovery finds project tools', async t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'sample.ts'), Array.from({ length: 5 }, (_, i) => `const hit${i} = 'needle';`).join('\n'));
  const tool = f.registry.tools.get('search_project_files')!;
  const first = await tool.execute({ projectId: f.project.id, query: 'needle', limit: 2 }, f.context) as { matches: Array<{ line: number }>; nextOffset: number; nextLineOffset: number };
  const second = await tool.execute({ projectId: f.project.id, query: 'needle', limit: 2, offset: first.nextOffset, lineOffset: first.nextLineOffset }, f.context) as typeof first;
  assert.deepEqual(first.matches.map(m => m.line), [1, 2]); assert.deepEqual(second.matches.map(m => m.line), [3, 4]);
  assert.ok(discoverToolSchemas(f.registry.toModelSchemas(), '查找项目代码', 10).length > 0);
});

for (const reason of ['cancel', 'deadline'] as const) it(`propagates parent ${reason} to an in-flight research model`, async t => {
  const f = fixture(t);
  let childStarted!: () => void;
  const started = new Promise<void>(resolve => { childStarted = resolve; });
  let aborted = false;
  const orchestrator = createCopilotOrchestrator({ db: f.db, masterKey: 'test', eventBus: new ForgeBadgerEventBus(), toolRegistry: f.registry, llm: {
    async stream(request) {
      if (request.tools.some(tool => tool.name === 'research_project')) {
        request.onEvent({ type: 'tool_call', toolCall: { id: 'research', name: 'research_project', arguments: JSON.stringify({ projectId: f.project.id, goal: 'Inspect project' }) } });
        return { message: 'Researching', usage: { totalTokens: 10 } };
      }
      childStarted();
      await new Promise<void>((_resolve, reject) => {
        const abort = () => { aborted = true; reject(request.signal?.reason); };
        if (request.signal?.aborted) abort(); else request.signal?.addEventListener('abort', abort, { once: true });
      });
      return { message: 'unreachable' };
    }, async summarize() { return ''; }, async generateTitle() { return ''; }, async proposeMemory() { return []; }
  } });
  const parent = f.ledger.admit({ userId: f.userId, conversationId: f.ledger.log.createConversation().id, projectId: f.project.id, userText: 'Research' }, 4);
  if (reason === 'deadline') f.db.prepare('UPDATE copilot_runs SET max_duration_ms=150 WHERE id=?').run(parent);
  const execution = orchestrator.executeRun(f.userId, parent);
  // Keep node:test alive while the runtime's deadline timer is deliberately unref'ed.
  const watchdog = setTimeout(() => {}, 2000);
  try {
    await started;
    if (reason === 'cancel') await orchestrator.cancelRun({ userId: f.userId, runId: parent });
    await execution;
    assert.equal(aborted, true);
    assert.equal(f.ledger.get(parent)?.status, reason === 'cancel' ? 'cancelled' : 'stopped');
    if (reason === 'deadline') assert.equal(f.ledger.get(parent)?.stop_reason, 'COPILOT_TIME_BUDGET');
    const child = f.db.prepare('SELECT child_run_id FROM copilot_research_jobs WHERE origin_run_id=?').get(parent) as { child_run_id: string };
    assert.ok(['cancelled', 'stopped'].includes(f.ledger.get(child.child_run_id)!.status));
  } finally { clearTimeout(watchdog); }
});
