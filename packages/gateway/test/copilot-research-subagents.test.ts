import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { CopilotPreferencesRepository } from '../src/db/repositories/copilot-preferences-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotGoalStore } from '../src/services/agent/goal-store.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';
import { nextReadBatch } from '../src/services/agent/read-batch.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createAgentToolRegistry, executeAgentTool } from '../src/services/agent/tool-registry.js';
import { computeToolSurface } from '../src/services/agent/tool-surface.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';

const masterKey = 'abcdef0123456789abcdef0123456789';
const report = {
  summary: 'The entry point loads the configuration.',
  findings: [{ claim: 'Startup loads config', evidence: [{ path: 'src/index.ts', line: 12, note: 'Startup call' }], confidence: 'high' }],
  openQuestions: ['Which config is deployed?'],
};
type ModelRequest = Parameters<AgentLlmClient['stream']>[0];

function call(request: ModelRequest, id: string, name: string, args: unknown) {
  request.onEvent({ type: 'tool_call', toolCall: { id, name, arguments: JSON.stringify(args) } });
}

function fixture(t: TestContext) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  const root = mkdtempSync(join(tmpdir(), 'fb-research-subagents-'));
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const userId = new UserRepository(db).create('subagents@example.test', 'hash').id;
  const ledger = new CopilotRunLedger(db, userId);
  const projectId = new ProjectRepository(db, userId).create({ name: 'Research', path: root, aiTool: 'codex' }).id;
  const conversationId = ledger.log.createConversation('Parent').id;
  const input = { userId, conversationId, projectId, modelId: 'parent-model', userText: 'Investigate' };
  const registry = createAgentToolRegistry(createPlatformTools());
  const orchestrate = (stream: AgentLlmClient['stream'], leaseMs?: number) => createCopilotOrchestrator({
    db, masterKey, toolRegistry: registry, eventBus: new ForgeBadgerEventBus(), leaseMs,
    llm: { stream, async summarize() { return ''; }, async generateTitle() { return ''; } },
  });
  const children = (runId: string) => {
    const jobs = db.prepare('SELECT child_run_id FROM copilot_research_jobs WHERE user_id=? AND origin_run_id=?')
      .all(userId, runId) as Array<{ child_run_id: string }>;
    return jobs.map(job => ledger.get(job.child_run_id)!);
  };
  return { db, userId, projectId, input, ledger, registry, orchestrate, children };
}

it('batches consecutive research calls four-wide and keeps ordinary reads separate and three-wide', t => {
  const f = fixture(t);
  const runId = f.ledger.admit(f.input, 16);
  const names = ['get_project', ...Array<string>(5).fill('research_project'),
    ...Array<string>(4).fill('get_project'), 'research_project'];
  for (const toolName of names) f.ledger.addStep(runId, { kind: 'tool', toolName, effect: 'read' });
  const batches = [];
  for (;;) {
    const batch = nextReadBatch(f.ledger.steps(runId), f.registry);
    if (!batch?.steps?.length) break;
    batches.push([batch.kind, batch.steps.map(step => step.tool_name)]);
    for (const step of batch.steps) f.ledger.completeStep(step.id, '{}');
  }
  assert.deepEqual(batches, [
    ['read', ['get_project']],
    ['research', names.slice(1, 5)],
    ['research', ['research_project']],
    ['read', names.slice(6, 9)],
    ['read', ['get_project']],
    ['research', ['research_project']],
  ]);
});

it('keeps research batches within the same model step', t => {
  const f = fixture(t);
  const runId = f.ledger.admit(f.input, 16);
  const first = f.ledger.addStep(runId, { kind: 'tool', toolName: 'research_project' });
  const modelStep = f.ledger.addStep(runId, { kind: 'model' });
  f.ledger.completeStep(modelStep.id, '');
  f.ledger.addStep(runId, { kind: 'tool', toolName: 'research_project' });

  const batch = nextReadBatch(f.ledger.steps(runId), f.registry);
  assert.deepEqual(batch?.steps.map(step => step.id), [first.id]);
});

it('runs at most four investigations together and returns durable reports and fallback text', { timeout: 5000 }, async t => {
  const f = fixture(t);
  let startFirstWave!: () => void;
  const firstWave = new Promise<void>(resolve => { startFirstWave = resolve; });
  let running = 0;
  let peak = 0;
  let started = 0;
  let parentRequests = 0;
  const orchestrator = f.orchestrate(async request => {
    if (request.tools.some(tool => tool.name === 'research_project')) {
      if (parentRequests++ === 0) for (let i = 0; i < 5; i++) {
        call(request, `research-${i}`, 'research_project', {
          projectId: f.projectId, goal: `Topic ${i}`, questions: ['Where is config loaded?'], boundaries: 'Inspect startup only',
        });
      }
      return { message: 'Parent analysis' };
    }
    const transcript = request.messages.map(message => message.content).join('\n');
    assert.match(transcript, /Where is config loaded\?/);
    assert.match(transcript, /Inspect startup only/);
    assert.match(transcript, /submit_research_report/);
    if (transcript.includes('research_report_submitted')) return { message: 'Report submitted' };
    running++;
    peak = Math.max(peak, running);
    const position = ++started;
    if (position === 4) startFirstWave();
    // The timeout also lets the test finish and report a failed assertion if a regression serializes the batch.
    const timer = setTimeout(startFirstWave, 1000);
    await firstWave;
    clearTimeout(timer);
    running--;
    if (transcript.includes('Topic 0')) call(request, 'nested', 'research_project', { projectId: f.projectId, goal: 'Nested' });
    if (position <= 4) call(request, 'report', 'submit_research_report', report);
    return { message: position === 5 ? 'Text only' : 'Investigated' };
  });

  const parent = await orchestrator.runTurn(f.input);
  assert.equal(peak, 4);
  const children = f.children(parent);
  assert.equal(children.length, 5);
  assert.equal(new Set(children.map(child => child.conversation_id)).size, 5);
  assert.ok(children.every(child => child.max_steps === 14 && child.status === 'completed'));
  const results = f.ledger.steps(parent).filter(step => step.tool_name === 'research_project')
    .map(step => JSON.parse(step.result_json!) as unknown);
  const evidence = 'Read-only analysis; not owner acceptance or independent test execution.';
  const childIds = f.ledger.steps(parent).filter(step => step.tool_name === 'research_project').map(step => {
    const job = f.db.prepare('SELECT child_run_id FROM copilot_research_jobs WHERE user_id=? AND source_key=?')
      .get(f.userId, `research:${parent}:${step.id}`) as { child_run_id: string };
    return job.child_run_id;
  });
  assert.deepEqual(results, childIds.map((runId, index) => ({
    runId, status: 'completed', report: index === 4 ? null : report,
    text: index === 4 ? 'Text only' : 'Report submitted', evidence,
  })));
  assert.match(f.ledger.steps(childIds[0]!).find(step => step.tool_name === 'research_project')?.result_json ?? '', /cannot execute/);
  assert.deepEqual(f.children(childIds[0]!), []);
  const submission = f.ledger.steps(childIds[0]!).find(step => step.tool_name === 'submit_research_report');
  assert.equal(submission?.status, 'completed');
  assert.deepEqual(JSON.parse(submission!.input_json!), report);
});

it('cancels each active investigation when the parent loses its lease', { timeout: 5000 }, async t => {
  const f = fixture(t);
  let signalAllStarted!: () => void;
  const allStarted = new Promise<void>(resolve => { signalAllStarted = resolve; });
  let started = 0;
  let aborted = 0;
  const orchestrator = f.orchestrate(async request => {
    if (request.tools.some(tool => tool.name === 'research_project')) {
      for (let i = 0; i < 4; i++) {
        call(request, `research-${i}`, 'research_project', { projectId: f.projectId, goal: `Topic ${i}` });
      }
      return { message: 'Investigating' };
    }
    if (++started === 4) signalAllStarted();
    try {
      await delay(2000, undefined, { signal: request.signal });
      return { message: 'Child finished' };
    } finally {
      if (request.signal?.aborted) aborted++;
    }
  }, 600);
  const parent = f.ledger.admit(f.input, 16);
  const execution = orchestrator.executeRun(f.userId, parent);
  await allStarted;
  f.db.prepare('UPDATE copilot_runs SET lease_expires_at=0 WHERE user_id=? AND id=?').run(f.userId, parent);
  await execution;

  assert.equal(aborted, 4);
  assert.deepEqual(f.children(parent).map(child => child.status), Array(4).fill('cancelled'));
});

it('exposes and executes report submission only in research runs', async t => {
  const f = fixture(t);
  const tool = f.registry.tools.get('submit_research_report');
  assert.ok(tool);
  for (const input of [{}, { mode: 'plan' }, { executionMode: 'coding' }, { executionMode: 'research' }] as const) {
    const surface = computeToolSurface(input, { registry: f.registry, hasSessionManager: false });
    const expected = 'executionMode' in input && input.executionMode === 'research';
    assert.equal(surface.visible.some(entry => entry.name === tool.name), expected);
    const result = await executeAgentTool(tool, report, { ...input, db: f.db, masterKey, userId: f.userId, projectId: f.projectId });
    assert.equal(result.ok, expected);
  }
  for (const invalid of [
    { ...report, summary: 's'.repeat(4001) },
    { ...report, findings: Array(21).fill(report.findings[0]) },
    { ...report, findings: [{ ...report.findings[0], evidence: [{ path: 'src/index.ts', line: 1.5 }] }] },
  ]) assert.equal(tool.inputSchema.safeParse(invalid).success, false);

  const research = f.registry.tools.get('research_project')!.inputSchema;
  const input = { projectId: f.projectId, goal: 'Inspect the project' };
  assert.equal(research.safeParse({ ...input, questions: Array(8).fill('q'.repeat(500)), boundaries: 'b'.repeat(1000) }).success, true);
  for (const invalid of [
    { questions: Array(9).fill('question') },
    { questions: ['q'.repeat(501)] },
    { boundaries: 'b'.repeat(1001) },
  ]) assert.equal(research.safeParse({ ...input, ...invalid }).success, false);
});

it('rejects reports too large to deliver intact and preserves a retried report alongside a bounded text fallback', async t => {
  const f = fixture(t);
  const oversized = { ...report, openQuestions: ['Oversized finding. '.repeat(2_700)] };
  const revised = { ...report, openQuestions: ['How is the project configured? '.repeat(1_250)] };
  let parentCalls = 0;
  let childCalls = 0;
  const orchestrator = f.orchestrate(async request => {
    if (request.tools.some(tool => tool.name === 'research_project')) {
      if (parentCalls++ === 0) call(request, 'research', 'research_project', { projectId: f.projectId, goal: 'Inspect the project' });
      return { message: 'Finished' };
    }
    if (childCalls++ === 0) call(request, 'large', 'submit_research_report', oversized);
    else if (childCalls === 2) call(request, 'retry', 'submit_research_report', revised);
    return { message: childCalls > 2 ? 'Summary. '.repeat(2000) : '' };
  });
  const parent = await orchestrator.runTurn(f.input);
  const [child] = f.children(parent);
  assert.ok(child);
  const steps = f.ledger.steps(child.id);
  assert.match(steps.find(step => step.tool_call_id === 'large')?.result_json ?? '', /research report.*limit/i);
  assert.match(steps.find(step => step.tool_call_id === 'retry')?.result_json ?? '', /research_report_submitted/);
  const result = JSON.parse(f.ledger.steps(parent).find(step => step.tool_name === 'research_project')!.result_json!);
  assert.equal(result.status, 'completed', child.stop_reason ?? undefined);
  assert.deepEqual(result.report, revised);
  assert.match(result.text, /^Summary\./);
  assert.ok(result.text.length < 'Summary. '.repeat(2000).length);
});

for (const role of ['active', 'unset', 'inactive'] as const) {
  it(`uses the correct model for research and coding when the subagent preference is ${role}`, async t => {
    const f = fixture(t);
    const models = new ModelProviderRepository(f.db, f.userId, masterKey);
    const provider = models.createProviderProfile({
      name: 'Subagent provider', providerKey: 'stub', baseUrl: 'https://stub.example',
      authType: 'api_key', apiFormat: 'openai-compatible', supportedAdapters: ['opencode'],
    });
    const profile = models.createModelProfile({
      providerProfileId: provider.id, name: 'Subagent model', modelId: 'stub-model', capabilities: ['chat'],
    });
    if (role !== 'unset') new CopilotPreferencesRepository(f.db, f.userId, masterKey).set({ subagentModelId: profile.id });
    if (role === 'inactive') f.db.prepare("UPDATE model_profiles SET status='inactive' WHERE id=?").run(profile.id);
    const goals = new CopilotGoalStore(f.db, f.userId);
    const goal = goals.createGoal({ conversationId: f.input.conversationId, projectId: f.projectId, title: 'Verify models', spec: 'Check child models' });
    const [task, other] = goals.addTasks(goal.id, ['Delegate task', 'Follow-up']);
    const observed: Array<[string, string | undefined]> = [];
    let parentCalls = 0;
    let codingCalls = 0;
    const orchestrator = f.orchestrate(async request => {
      if (request.tools.some(tool => tool.name === 'research_project')) {
        if (parentCalls++ === 0) {
          call(request, 'research', 'research_project', { projectId: f.projectId, goal: 'Inspect project' });
          call(request, 'code', 'goal_delegate', { taskId: task.id, instructions: 'Review the task' });
        }
        return { message: 'Parent finished' };
      }
      const coding = request.tools.some(tool => tool.name === 'goal_delegate');
      observed.push([coding ? 'coding' : 'research', request.modelId]);
      if (coding && codingCalls++ === 0) call(request, 'nested', 'goal_delegate', { taskId: other.id, instructions: 'Try nested delegation' });
      return { message: 'Child finished' };
    });

    const parent = await orchestrator.runTurn({ ...f.input, goalId: goal.id });
    const expectedModel = role === 'active' ? profile.id : f.input.modelId;
    assert.deepEqual(observed, [['research', expectedModel], ['coding', expectedModel], ['coding', expectedModel]]);
    const children = f.children(parent);
    assert.equal(children.length, 2);
    const coding = children.find(child => child.max_steps === 24);
    assert.ok(coding);
    assert.deepEqual(f.children(coding.id), []);
    assert.match(f.ledger.steps(coding.id).find(step => step.tool_name === 'goal_delegate')?.result_json ?? '', /Nested or cross-project research is not allowed/);
  });
}
