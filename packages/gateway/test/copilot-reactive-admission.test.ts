import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { buildAgentStack } from '../src/services/agent/agent-stack.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { attachCopilotReactiveLoop } from '../src/services/agent/reactive-loop.js';
import { publishCompletion } from '../src/services/agent/llm-response.js';
import type { AgentLlmRequest } from '../src/services/agent/llm-client.js';

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), 'expected durable admission before deadline');
}

it('retains the latest event rejected by a busy real conversation, then admits it once', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('reactive@test.invalid', 'fixture');
  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: 'Reactive fixture', path: '/tmp', aiTool: 'pi' });
  const eventBus = new ForgeBadgerEventBus();
  const deps = { db, masterKey: 'a'.repeat(32), eventBus };
  const stack = buildAgentStack(deps, user.id);
  let calls = 0;
  stack.orchestrator = createCopilotOrchestrator({ ...deps, toolRegistry: stack.toolRegistry, llm: {
    async stream(request: AgentLlmRequest) {
      const first = calls++ === 0;
      return publishCompletion({ message: first ? '' : 'Fixture complete.', thinking: '', toolCalls: first
        ? [{ id: 'update', name: 'update_project', arguments: JSON.stringify({ projectId: project.id, name: 'Approved fixture' }) }] : [],
        finishReason: first ? 'tool_calls' : 'stop' }, request.onEvent, request.signal ?? new AbortController().signal, false);
    }, async summarize() { return ''; }, async generateTitle() { return ''; }
  } });
  const ledger = new CopilotRunLedger(db, user.id);
  const loop = attachCopilotReactiveLoop({ deps, buildAgentStack: () => stack, debounceMs: 5, cooldownMs: 1 });
  const fire = (message: string) => eventBus.emitEvent({ type: 'activity_created', userId: user.id, activityId: message,
    activityType: 'session', status: 'done', message, createdAt: new Date() });
  try {
    fire('first event');
    await until(() => ledger.log.listConversations().length === 1);
    const conversation = ledger.log.listConversations()[0]!;
    await until(() => ledger.log.listRuns(conversation.id)[0]?.status === 'awaiting_approval');
    const first = ledger.log.listRuns(conversation.id)[0]!;
    fire('latest event must survive busy admission');
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(ledger.log.listRuns(conversation.id).length, 1);
    const action = ledger.log.listPendingActions(first.id)[0]!;
    await stack.orchestrator.resumeAfterApproval({ userId: user.id, runId: first.id, actionId: action.id, approved: true, decisionOrigin: 'web' });
    await until(() => ledger.log.listRuns(conversation.id).length === 2);
    await until(() => ledger.log.listRuns(conversation.id).every(run => run.status === 'completed'));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(ledger.log.listRuns(conversation.id).length, 2);
    assert.ok(ledger.log.listMessages(conversation.id).some(message => message.content.includes('latest event must survive busy admission')));
  } finally { loop.stop(); db.close(); }
});
