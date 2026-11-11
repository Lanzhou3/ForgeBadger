import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { z } from 'zod';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import {
  trailingRepeatTool, repeatStallDecision, toolRepeatStreak,
  DEFAULT_REPEAT_NAME_THRESHOLD, REPEAT_STALL_STOP_REASON
} from '../src/services/agent/repeat-tool-guard.js';
import type { RunStep } from '../src/services/agent/run-ledger.js';

let ordinal = 0;
function modelStep(): RunStep {
  ordinal += 1;
  return { id: `m${ordinal}`, user_id: 'u', run_id: 'run', ordinal, kind: 'model', status: 'completed',
    tool_call_id: null, tool_name: null, input_json: null, input_digest: null, result_json: null, effect: 'read', attempt: 1, fence: 1 };
}
function toolStep(name: string, args: Record<string, unknown> = {}, status: RunStep['status'] = 'completed'): RunStep {
  ordinal += 1;
  return { id: `t${ordinal}`, user_id: 'u', run_id: 'run', ordinal, kind: 'tool', status,
    tool_call_id: `c${ordinal}`, tool_name: name, input_json: JSON.stringify(args), input_digest: null,
    result_json: null, effect: 'read', attempt: 1, fence: 1 };
}

it('counts a trailing streak by tool name across model steps', () => {
  const steps = [modelStep(), toolStep('discover_tools', { query: 'a' }), modelStep(), toolStep('discover_tools', { query: 'b' })];
  assert.equal(toolRepeatStreak(steps, 'discover_tools'), 2);
  assert.equal(toolRepeatStreak(steps, 'list_sessions'), 0);
  assert.deepEqual(trailingRepeatTool(steps), { toolName: 'discover_tools', streak: 2 });
});

it('a different tool name resets the chain', () => {
  const steps = [toolStep('a'), toolStep('a'), toolStep('b'), toolStep('a')];
  assert.equal(toolRepeatStreak(steps, 'a'), 1);
  assert.equal(repeatStallDecision({ steps }).decision, 'none');
});

it('rejected and indeterminate outcomes count; unfinished calls break the chain', () => {
  const rejected = toolStep('load_playbook', {}, 'completed');
  assert.deepEqual(repeatStallDecision({ steps: [toolStep('load_playbook'), toolStep('load_playbook'), rejected] }).decision, 'remind');
  const running = toolStep('load_playbook', {}, 'running');
  assert.equal(repeatStallDecision({ steps: [toolStep('load_playbook'), toolStep('load_playbook'), toolStep('load_playbook'), running] }).decision, 'none');
});

it('reminds at the name threshold and stops at the hard threshold', () => {
  const three = [toolStep('discover_tools', { query: 'one' }), toolStep('discover_tools', { query: 'two' }), toolStep('discover_tools', { query: 'three' })];
  const remind = repeatStallDecision({ steps: three });
  assert.deepEqual(remind, { decision: 'remind', toolName: 'discover_tools', streak: 3 });
  const six = [...three, toolStep('discover_tools', { query: 'four' }), toolStep('discover_tools', { query: 'five' }), toolStep('discover_tools', { query: 'six' })];
  assert.equal(repeatStallDecision({ steps: six }).decision, 'stop');
});

it('replays the 2026-11-11 session-creation run: one reminder, no stop', () => {
  // feffb0cd-553b-423a-960d-0ee3a16d3e35 tool-step order, arguments elided.
  const sequence: Array<[string, string]> = [
    ['discover_tools', 'create new session pi'], ['list_sessions', 'projectId'], ['discover_tools', 'session spawn launch start'],
    ['discover_tools', 'new session create spawn register'], ['discover_tools', 'terminal session pi adapter'], ['load_playbook', 'session-dispatch'],
    ['discover_tools', 'add session spawn adapter pi'], ['get_session', 'd98991d8'], ['discover_tools', 'session'],
    ['discover_tools', 'create spawn open start new pi'], ['pm_list_task_packets', 'projectId'], ['discover_tools', 'register new session add'],
    ['discover_tools', 'session adapter terminal tab'], ['terminal_open', 'projectId'], ['list_sessions', 'projectId'],
    ['search_memory', 'pi session 新建会话'], ['get_project', 'projectId'], ['discover_tools', 'import launch'], ['discover_tools', 'create'],
  ];
  const steps: RunStep[] = [];
  let reminded = false, stopped = false;
  for (const [name, arg] of sequence) {
    steps.push(modelStep(), toolStep(name, { x: arg }));
    const verdict = repeatStallDecision({ steps });
    if (verdict.decision === 'remind') reminded = true;
    if (verdict.decision === 'stop') stopped = true;
  }
  // The model interleaved other tools, so the name streak never reached the
  // hard threshold: the guard's job there is the mid-run reminder, while the
  // budget remains the backstop.
  assert.equal(reminded, true, 'the three-consecutive discover_tools stretch must remind');
  assert.equal(stopped, false);
});

it('orchestrator: six same-tool calls stop the run with the closing projection', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  try {
    const userId = new UserRepository(db).create('repeat-guard@test.local', 'fixture').id;
    const ledger = new CopilotRunLedger(db, userId);
    const conversationId = ledger.log.createConversation().id;
    const runId = ledger.admit({ userId, conversationId, userText: '新建一个pi会话' }, 16);
    let calls = 0;
    const seenRequests: Array<Array<{ role: string; content: string }>> = [];
    const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(64), eventBus: new ForgeBadgerEventBus(),
      toolRegistry: createAgentToolRegistry([{ name: 'discover_tools', description: 'Search tools', risk: 'read', requiresApproval: false,
        inputSchema: z.object({ query: z.string().min(1) }).strict(), async execute(input) { return { found: false, query: (input as { query: string }).query }; } }]),
      llm: { async stream(request) {
        calls += 1;
        seenRequests.push(request.messages.map(message => ({ role: message.role, content: String(message.content) })));
        request.onEvent({ type: 'tool_call', toolCall: { id: `call-${calls}`, name: 'discover_tools', arguments: JSON.stringify({ query: `attempt ${calls}` }) } });
        return { message: '', usage: { totalTokens: 10 } };
      }, async summarize() { return ''; }, async generateTitle() { return ''; } } });
    await orchestrator.executeRun(userId, runId);
    assert.equal(calls, 6, 'the run must stop after the sixth consecutive call, before a seventh model step');
    assert.equal(ledger.get(runId)?.status, 'stopped');
    assert.equal(ledger.get(runId)?.stop_reason, REPEAT_STALL_STOP_REASON);
    // Tier one: the fourth model request carries the gentle reminder.
    assert.ok(seenRequests[3]!.some(message => message.content.includes('repeating the same tool call')),
      'the fourth request must carry the gentle repeat reminder');
    // Tier two: the fifth model request escalates to the detailed reminder.
    assert.ok(seenRequests[4]!.some(message => message.content.includes('has now been called 4 times consecutively')),
      'the fifth request must carry the detailed repeat reminder');
    // WP5: the stall stop ends with a deterministic closing projection.
    const closing = ledger.log.listMessages(conversationId).find(message => message.role === 'assistant'
      && message.content.includes('本次运行以「同一工具连续重复且未推进」结束'));
    assert.ok(closing, 'the stall stop must publish the closing projection');
    assert.ok(closing!.content.includes('discover_tools×6'), 'the closing projection must include the step histogram');
  } finally { db.close(); }
});

it('orchestrator: a different tool between calls keeps the run alive and the reminder goes away', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  try {
    const userId = new UserRepository(db).create('repeat-reset@test.local', 'fixture').id;
    const ledger = new CopilotRunLedger(db, userId);
    const conversationId = ledger.log.createConversation().id;
    const runId = ledger.admit({ userId, conversationId, userText: 'Look twice', }, 16);
    let calls = 0;
    const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(64), eventBus: new ForgeBadgerEventBus(),
      toolRegistry: createAgentToolRegistry([
        { name: 'discover_tools', description: 'Search tools', risk: 'read', requiresApproval: false,
          inputSchema: z.object({ query: z.string().min(1) }).strict(), async execute(input) { return { found: false }; } },
        { name: 'list_sessions', description: 'List sessions', risk: 'read', requiresApproval: false,
          inputSchema: z.object({}).strict(), async execute() { return { sessions: [] }; } }]),
      llm: { async stream(request) {
        calls += 1;
        if (calls === 4) return { message: 'done', usage: { totalTokens: 10 } };
        request.onEvent({ type: 'tool_call', toolCall: { id: `call-${calls}`, name: calls === 3 ? 'list_sessions' : 'discover_tools', arguments: '{}' } });
        return { message: '', usage: { totalTokens: 10 } };
      }, async summarize() { return ''; }, async generateTitle() { return ''; } } });
    await orchestrator.executeRun(userId, runId);
    assert.equal(ledger.get(runId)?.status, 'completed');
  } finally { db.close(); }
});
