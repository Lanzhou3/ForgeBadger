import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { PlatformActionRepository } from '../src/db/repositories/platform-action-repository.js';
import { AgentMemoryRepository } from '../src/services/agent/memory.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { publishCompletion } from '../src/services/agent/llm-response.js';

function fixture(memory = false, researchAfterApproval = false) {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const userId = new UserRepository(db).create('approval-lifecycle@test.dev', 'fixture').id;
  const projects = new ProjectRepository(db, userId);
  const project = projects.create({ name: 'Lifecycle', path: '/private/tmp/fb-approval-lifecycle', aiTool: 'codex' });
  const ledger = new CopilotRunLedger(db, userId);
  const conversationId = ledger.log.createConversation().id;
  const masterKey = randomBytes(32).toString('hex');
  let calls = 0;
  let toolDisabled = false;
  const llm: AgentLlmClient = {
    async stream(request) {
      const index = calls++;
      const first = index === 0;
      const research = researchAfterApproval && index === 1;
      return publishCompletion({ message: first ? '' : 'The operation has settled.', thinking: '',
        finishReason: first || research ? 'tool_calls' : 'stop',
        toolCalls: first ? [{ id: 'change-1', name: memory ? 'write_memory' : 'update_project',
          arguments: JSON.stringify(memory ? { scope: 'session', kind: 'decision', text: 'Keep the current task constraints.' }
            : { projectId: project.id, description: 'Confirmed change' }) }]
          : research ? [{ id: 'research-1', name: 'research_project',
            arguments: JSON.stringify({ projectId: project.id, goal: 'Inspect the confirmed metadata' }) }] : [],
        usage: { inputTokens: 10, outputTokens: 5 }
      }, request.onEvent, request.signal ?? new AbortController().signal);
    },
    async summarize() { return 'summary'; },
    async generateTitle() { return 'Lifecycle'; },
    async proposeMemory() { return []; }
  };
  const runtime = () => createCopilotOrchestrator({ db, masterKey, llm,
    toolRegistry: createAgentToolRegistry(createPlatformTools()),
    isToolDisabled: name => name === 'update_project' && toolDisabled,
    eventBus: new ForgeBadgerEventBus() });
  // A reactive operation has no automatic write authority. The owner must
  // explicitly approve the real built-in database action before it executes.
  const run = () => runtime().runTurn({ userId, conversationId, userText: 'Record the confirmed change',
    ...(memory ? {} : { source: 'reactive' as const, projectId: project.id }) });
  return { db, userId, projects, project, ledger, conversationId, runtime, run,
    disableTool() { toolDisabled = true; } };
}

type Fixture = ReturnType<typeof fixture>;
function awaiting(f: Fixture, runId: string) {
  assert.equal(f.ledger.get(runId)?.status, 'awaiting_approval');
  const action = f.ledger.log.listPendingActions(runId).find(row => row.status === 'pending')!;
  assert.ok(action?.stepId);
  const intents = new PlatformActionRepository(f.db, f.userId);
  const intent = intents.byKey(action.stepId)!;
  assert.ok(intent);
  return { action, intent, intents };
}

it('resumes the same built-in action after more than 30 minutes of approval waiting', async t => {
  const f = fixture();
  try {
    const runId = await f.run();
    const { action, intent, intents } = awaiting(f, runId);
    const startedAt = (f.db.prepare('SELECT started_at FROM copilot_runs WHERE id=?').get(runId) as { started_at: number }).started_at;
    const delayedNow = Date.now() + 35 * 60_000;
    t.mock.method(Date, 'now', () => delayedNow);
    const result = await f.runtime().resumeAfterApproval({ userId: f.userId, runId, actionId: action.id,
      approved: true, decisionOrigin: 'web' });
    assert.equal(result.resumed, true);
    assert.equal(f.ledger.get(runId)?.status, 'completed');
    assert.equal(f.projects.getById(f.project.id)?.description, 'Confirmed change');
    const settled = intents.get(intent.id)!;
    assert.equal(settled.id, intent.id);
    assert.equal(settled.digest, intent.digest);
    assert.equal(settled.resources_json, intent.resources_json);
    assert.equal(settled.input_json, intent.input_json);
    assert.equal(settled.status, 'completed');
    assert.equal(intents.receipt(intent.id)?.outcome, 'confirmed');
    assert.equal((f.db.prepare('SELECT started_at FROM copilot_runs WHERE id=?').get(runId) as { started_at: number }).started_at, startedAt);
    const duplicate = await f.runtime().resumeAfterApproval({ userId: f.userId, runId, actionId: action.id,
      approved: true, decisionOrigin: 'web' });
    assert.equal(duplicate.resumed, false);
    assert.equal(intents.get(intent.id)?.expires_at, settled.expires_at);
    assert.equal((f.db.prepare('SELECT count(*) n FROM platform_action_receipts').get() as { n: number }).n, 1);
  } finally { t.mock.restoreAll(); f.db.close(); }
});

it('refreshes an expired Web-approved intent only after rechecking its unchanged resources', async t => {
  const f = fixture();
  try {
    const runId = await f.run();
    const { action, intent, intents } = awaiting(f, runId);
    const delayedNow = Date.now() + 20 * 60_000;
    t.mock.method(Date, 'now', () => delayedNow);
    assert.equal(f.runtime().recordApprovalDecision({ userId: f.userId, runId, actionId: action.id,
      approved: true, decisionOrigin: 'web' }), true);
    assert.ok(intents.get(intent.id)!.expires_at > delayedNow);
    assert.equal(f.ledger.get(runId)?.status, 'pending');
    await f.runtime().executeRun(f.userId, runId);
    assert.equal(f.projects.getById(f.project.id)?.description, 'Confirmed change');
    assert.equal(intents.receipt(intent.id)?.outcome, 'confirmed');
  } finally { t.mock.restoreAll(); f.db.close(); }
});

for (const origin of ['channel', undefined] as const) {
  it(`does not renew an expired intent for ${origin ?? 'unspecified'} decision origin`, async t => {
    const f = fixture();
    try {
      const runId = await f.run();
      const { action, intent, intents } = awaiting(f, runId);
      const delayedNow = Date.now() + 20 * 60_000;
      t.mock.method(Date, 'now', () => delayedNow);
      assert.throws(() => f.runtime().recordApprovalDecision({ userId: f.userId, runId, actionId: action.id,
        approved: true, ...(origin ? { decisionOrigin: origin } : {}) }), /expired|EXPIRED/i);
      assert.equal(intents.get(intent.id)?.expires_at, intent.expires_at);
      assert.equal(f.ledger.log.getPendingAction(action.id)?.status, 'pending');
      assert.equal(f.ledger.get(runId)?.status, 'awaiting_approval');
      assert.equal(f.projects.getById(f.project.id)?.description, f.project.description);
    } finally { t.mock.restoreAll(); f.db.close(); }
  });
}

it('keeps a valid channel decision on the original signed intent deadline', async () => {
  const f = fixture();
  try {
    const runId = await f.run();
    const { action, intent, intents } = awaiting(f, runId);
    assert.equal(f.runtime().recordApprovalDecision({ userId: f.userId, runId, actionId: action.id,
      approved: true, decisionOrigin: 'channel' }), true);
    assert.equal(intents.get(intent.id)?.expires_at, intent.expires_at);
    await f.runtime().executeRun(f.userId, runId);
    assert.equal(intents.receipt(intent.id)?.outcome, 'confirmed');
  } finally { f.db.close(); }
});

const revokedCases: Array<[string, (f: Fixture, actionId: string) => void]> = [
  ['inactive actor', f => { f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.userId); }],
  ['owner disabled tool', f => { f.disableTool(); }],
  ['resource changed', f => { f.projects.updateMetadata(f.project.id, { name: 'Changed while waiting' }); }],
  ['raw pending input changed', (f, id) => { f.db.prepare('UPDATE copilot_pending_actions SET input_json=? WHERE id=?')
    .run(JSON.stringify({ projectId: f.project.id, description: 'Unapproved change' }), id); }]
];
for (const [label, revoke] of revokedCases) {
  it(`rolls back the entire Web decision when ${label}`, async () => {
    const f = fixture();
    try {
      const runId = await f.run();
      const { action, intent, intents } = awaiting(f, runId);
      revoke(f, action.id);
      assert.throws(() => f.runtime().recordApprovalDecision({ userId: f.userId, runId, actionId: action.id,
        approved: true, decisionOrigin: 'web' }));
      assert.equal(f.ledger.log.getPendingAction(action.id)?.status, 'pending');
      assert.equal(f.ledger.get(runId)?.status, 'awaiting_approval');
      assert.equal(intents.get(intent.id)?.expires_at, intent.expires_at);
      assert.equal(intents.receipt(intent.id), undefined);
      assert.equal(f.projects.getById(f.project.id)?.description, f.project.description);
    } finally { f.db.close(); }
  });
}

it('writes current session memory through the real orchestrator without project authority', async () => {
  const f = fixture(true);
  try {
    const runId = await f.run();
    assert.equal(f.ledger.get(runId)?.status, 'completed');
    assert.equal(f.ledger.log.listPendingActions(runId).length, 0);
    const memory = new AgentMemoryRepository(f.db, f.userId).list({ scope: 'session', conversationId: f.conversationId });
    assert.equal(memory.length, 1);
    assert.equal(memory[0]?.text, 'Keep the current task constraints.');
    assert.equal((f.db.prepare('SELECT outcome FROM platform_action_receipts').get() as { outcome: string }).outcome, 'confirmed');
  } finally { f.db.close(); }
});

it('gives research started after approval the parent remaining execution budget', async t => {
  const f = fixture(false, true);
  try {
    const runId = await f.run();
    const { action } = awaiting(f, runId);
    const delayedNow = Date.now() + 35 * 60_000;
    t.mock.method(Date, 'now', () => delayedNow);
    await f.runtime().resumeAfterApproval({ userId: f.userId, runId, actionId: action.id,
      approved: true, decisionOrigin: 'web' });
    const child = f.db.prepare(`SELECT r.status,r.max_duration_ms FROM copilot_research_jobs j
      JOIN copilot_runs r ON r.user_id=j.user_id AND r.id=j.child_run_id
      WHERE j.user_id=? AND j.origin_run_id=?`).get(f.userId, runId) as { status: string; max_duration_ms: number };
    assert.ok(child);
    assert.equal(child.max_duration_ms, 300_000);
    assert.equal(child.status, 'completed');
    assert.equal(f.ledger.get(runId)?.status, 'completed');
  } finally { t.mock.restoreAll(); f.db.close(); }
});
