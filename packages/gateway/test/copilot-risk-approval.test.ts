import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';

function fixture(toolName: string, source: 'user' | 'reactive' | 'scheduled' = 'user') {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('risk-test@example.com', 'test-hash');
  const project = new ProjectRepository(db, user.id).create({ name: 'test', path: '/tmp/copilot-risk-test', aiTool: 'codex' });
  const log = new CopilotConversationLog(db, user.id);
  const conversation = log.createConversation();
  let calls = 0;
  const llm: AgentLlmClient = {
    async stream(request) {
      if (calls++ === 0) request.onEvent({ type: 'tool_call', toolCall: { id: 'tool-1', name: toolName,
        arguments: JSON.stringify(toolName === 'write_memory' ? { kind: 'fact', scope: 'global', text: 'global preference' } : { projectId: project.id, title: 'Implement add', acceptanceCriteria: ['Tests pass'] }) } });
      else request.onEvent({ type: 'text_delta', text: 'Task recorded.' });
      return { message: '' };
    },
    async summarize() { return ''; }, async generateTitle() { return ''; }, async proposeMemory() { return []; },
  };
  const orchestrator = createCopilotOrchestrator({ db, masterKey: randomBytes(32).toString('hex'),
    toolRegistry: createAgentToolRegistry(createPlatformTools()), llm, eventBus: new ForgeBadgerEventBus() });
  return { db, log, user, project, run: () => orchestrator.runTurn({ userId: user.id, conversationId: conversation.id, userText: 'Create a task', source }) };
}

describe('Copilot risk-based owner approval', () => {
  it('executes routine task creation without a pending approval and persists its receipt', async () => {
    const f = fixture('pm_create_work_item');
    try {
      const runId = await f.run();
      assert.equal(f.log.getRun(runId)?.status, 'completed');
      assert.equal(f.log.listPendingActions(runId).length, 0);
      assert.equal(new ProjectManagerRepository(f.db, f.user.id).listWorkItems(f.project.id).length, 1);
      assert.equal((f.db.prepare('SELECT outcome FROM platform_action_receipts').get() as { outcome: string }).outcome, 'confirmed');
    } finally { f.db.close(); }
  });

  it('keeps global memory changes behind explicit confirmation', async () => {
    const f = fixture('write_memory');
    try { const runId = await f.run(); assert.equal(f.log.getRun(runId)?.status, 'awaiting_approval'); }
    finally { f.db.close(); }
  });

  for (const source of ['reactive', 'scheduled'] as const) {
    it(`does not give ${source} runs new automatic write authority`, async () => {
      const f = fixture('pm_create_work_item', source);
      try {
        await f.run();
        assert.equal(new ProjectManagerRepository(f.db, f.user.id).listWorkItems(f.project.id).length, 0);
      } finally { f.db.close(); }
    });
  }

  it('rejects automatic approval from a different run or tool step', async () => {
    const f = fixture('write_memory');
    try {
      const runId = await f.run();
      const intent = f.db.prepare('SELECT id,origin_step_id FROM platform_action_intents').get() as { id: string; origin_step_id: string };
      const otherConversation = f.log.createConversation();
      const otherRun = new CopilotRunLedger(f.db, f.user.id).admit({ userId: f.user.id,
        conversationId: otherConversation.id, userText: 'Different request' }, 10);
      for (const origin of [{ runId: otherRun, stepId: intent.origin_step_id }, { runId, stepId: 'different-step' }]) {
        const actions = new PlatformActions({ db: f.db, userId: f.user.id, actionOrigin: { kind: 'copilot', ...origin } }, new Map());
        assert.throws(() => actions.approveRoutine(intent.id), /origin mismatch/);
        assert.equal(actions.intents.get(intent.id)?.status, 'pending');
      }
    } finally { f.db.close(); }
  });
});
