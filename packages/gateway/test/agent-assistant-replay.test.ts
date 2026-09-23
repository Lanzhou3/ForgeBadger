import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { z } from 'zod';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CopilotModelResponseRepository, publicModelResponse } from '../src/db/repositories/copilot-model-response-repository.js';
import { buildCompressedContext, projectTranscript } from '../src/services/agent/context.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';
import { readAnthropicCompletion } from '../src/services/agent/llm-anthropic.js';
import { readOpenAiCompletion } from '../src/services/agent/llm-openai.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentLlmClient } from '../src/services/agent/llm-client.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';

const key = 'a'.repeat(32);
const reasoning = 'synthetic private replay marker';
const content = '<think>synthetic inline state</think>Inspecting the current state.';
const openaiCall = { id: 'call_1', type: 'function', function: { name: 'inspect_state', arguments: '{ "scope": "current" }' } };
const blocks = [
  { type: 'thinking', thinking: reasoning, signature: 'synthetic-signature' },
  { type: 'redacted_thinking', data: 'synthetic-opaque' },
  { type: 'text', text: 'Inspecting the current state.' },
  { type: 'tool_use', id: 'call_1', name: 'inspect_state', input: { scope: 'current' } },
];

function setup(t: TestContext, format: 'openai' | 'anthropic', databasePath = ':memory:') {
  const db = new Database(databasePath);
  t.after(() => { if (db.open) db.close(); });
  migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations', import.meta.url).pathname });
  const user = new UserRepository(db).create('assistant-replay@test.dev', 'hash');
  const repo = new ModelProviderRepository(db, user.id, key);
  const provider = repo.createProviderProfile({ name: 'fixture', providerKey: 'fixture', baseUrl: 'https://api.example.com', apiFormat: format, authType: 'api_key', supportedAdapters: ['opencode'] });
  repo.createCredential({ providerProfileId: provider.id, label: 'fixture', plaintextSecret: 'fixture' });
  repo.createModelProfile({ providerProfileId: provider.id, name: 'fixture', modelId: 'fixture', isDefault: true, capabilities: ['chat'] });
  const ledger = new CopilotRunLedger(db, user.id);
  const conversation = ledger.log.createConversation('Replay test');
  const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
  let executions = 0;
  const llm = createAgentLlmClient({ modelProviderRepository: repo,
    resolveHost: async () => [{ address: '8.8.8.8', family: 4 }],
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const first = requests.length === 1;
      return Response.json(format === 'openai'
        ? { choices: [{ finish_reason: first ? 'tool_calls' : 'stop', message: first
          ? { role: 'assistant', content, reasoning_content: reasoning, reasoning_details: [{ type: 'reasoning.text', text: reasoning }], tool_calls: [openaiCall] }
          : { role: 'assistant', content: 'The current state is available.' } }] }
        : { role: 'assistant', stop_reason: first ? 'tool_use' : 'end_turn', content: first ? blocks : [{ type: 'text', text: 'The current state is available.' }] });
    },
  });
  const toolRegistry = createAgentToolRegistry([{ name: 'inspect_state', description: 'Read current state', risk: 'read', requiresApproval: false,
    inputSchema: z.object({ scope: z.string() }), async execute() { executions++; return { state: 'available' }; } }]);
  const orchestrator = () => createCopilotOrchestrator({ db, masterKey: key, llm, toolRegistry, eventBus: new ForgeBadgerEventBus() });
  return { db, user, ledger, conversation, requests, orchestrator, llm, repo, provider, executions: () => executions };
}

for (const format of ['openai', 'anthropic'] as const) {
  it(`${format} replays one complete assistant with matching tool result across model rounds`, async t => {
    const f = setup(t, format);
    const run = await f.orchestrator().runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Inspect the current state.' });
    assert.equal(f.ledger.get(run)?.status, 'completed');
    assert.equal(f.executions(), 1);
    const assistants = f.requests[1]!.messages.filter(m => m.role === 'assistant');
    assert.equal(assistants.length, 1, 'one provider response must stay one assistant message');
    if (format === 'openai') {
      assert.equal(assistants[0]!.content, content);
      assert.equal(assistants[0]!.reasoning_content, reasoning);
      assert.deepEqual(assistants[0]!.reasoning_details, [{ type: 'reasoning.text', text: reasoning }]);
      assert.deepEqual(assistants[0]!.tool_calls, [openaiCall]);
      assert.equal(f.requests[1]!.messages.at(-1)!.tool_call_id, 'call_1');
    } else assert.deepEqual(assistants[0]!.content, blocks);
    // A new orchestrator must rebuild replay from durable evidence, not an in-memory cache.
    await f.orchestrator().runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Summarize the observed state.' });
    const replay = f.requests.at(-1)!.messages.find(m => m.role === 'assistant');
    assert.deepEqual(replay, assistants[0]);
    assert.equal(f.executions(), 1, 'historical calls are not executed again');
    const persisted = JSON.stringify(f.ledger.steps(run));
    assert.equal(persisted.includes(reasoning), false, 'private provider replay must not be plaintext ledger data');
    const modelStep = f.ledger.steps(run).find(s => s.kind === 'model')!;
    const diagnostic = JSON.parse(modelStep.result_json!);
    assert.equal(diagnostic.finishReason, format === 'openai' ? 'tool_calls' : 'tool_use');
    assert.equal(diagnostic.toolCallCount, 1);
  });
}

for (const format of ['openai', 'anthropic'] as const) {
  it(`${format} strips private replay from summaries and a different model`, async t => {
    const f = setup(t, format);
    await f.orchestrator().runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Inspect state.' });
    const responses = new CopilotModelResponseRepository(f.db, f.user.id, key).list(f.conversation.id);
    const assistant = [...responses.values()][0]!;
    await f.llm.summarize({ messages: [{ role: 'user', content: 'Summarize.' }, assistant] });
    const summaryRequest = JSON.stringify(f.requests.at(-1));
    assert.equal(summaryRequest.includes(reasoning), false);
    assert.equal(summaryRequest.includes('synthetic-signature'), false);
    assert.equal(summaryRequest.includes('synthetic inline state'), false);
    const alternate = f.repo.createModelProfile({ providerProfileId: f.provider.id, name: 'alternate', modelId: 'alternate', capabilities: ['chat'] });
    await f.llm.stream({ modelId: alternate.id, messages: [{ role: 'user', content: 'Continue.' }, assistant,
      { role: 'tool', toolCallId: 'call_1', content: 'available' }], tools: [], onEvent() {} });
    const switched = JSON.stringify(f.requests.at(-1));
    assert.equal(switched.includes(reasoning), false);
    assert.equal(switched.includes('synthetic-signature'), false);
    assert.equal(switched.includes('synthetic inline state'), false);
    assert.ok(switched.includes('call_1'));
  });
}

it('reopens encrypted assistant replay from file SQLite without executing historical tools', async t => {
  const root = mkdtempSync(join(tmpdir(), 'fb-replay-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'test.db');
  const f = setup(t, 'openai', file);
  const run = await f.orchestrator().runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Inspect state.' });
  const expected = new CopilotModelResponseRepository(f.db, f.user.id, key).list(f.conversation.id);
  const result = f.ledger.steps(run).find(s => s.kind === 'model')!.result_json;
  const publicResult = publicModelResponse(result)!;
  assert.equal(publicResult.includes('replay'), false);
  assert.equal(publicResult.includes('ciphertext'), false);
  assert.equal(JSON.parse(publicResult).toolCallCount, 1);
  f.db.close();
  const reopened = new Database(file);
  try {
    const actual = new CopilotModelResponseRepository(reopened, f.user.id, key).list(f.conversation.id);
    assert.deepEqual(actual, expected);
    const history = projectTranscript(new CopilotConversationLog(reopened, f.user.id).listMessages(f.conversation.id), actual);
    assert.equal(history.filter(m => m.toolCalls).length, 1);
    assert.equal(history.find(m => m.toolCalls)?.providerReplay?.reasoningContent, reasoning);
  } finally { reopened.close(); }
});

it('rejects ciphertext moved between model steps, tampered ciphertext and wrong keys', async t => {
  const f = setup(t, 'openai');
  const run = await f.orchestrator().runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Inspect state.' });
  const models = f.ledger.steps(run).filter(s => s.kind === 'model');
  const store = new CopilotModelResponseRepository(f.db, f.user.id, key);
  f.db.prepare('UPDATE copilot_run_steps SET result_json=? WHERE id=?').run(models[0]!.result_json, models[1]!.id);
  assert.throws(() => store.list(f.conversation.id), { code: 'COPILOT_REPLAY_INVALID' });
  f.db.prepare('UPDATE copilot_run_steps SET result_json=? WHERE id=?').run(models[1]!.result_json, models[1]!.id);
  const corrupt = JSON.parse(models[0]!.result_json!);
  corrupt.replay.ciphertext = `!${corrupt.replay.ciphertext.slice(1)}`;
  f.db.prepare('UPDATE copilot_run_steps SET result_json=? WHERE id=?').run(JSON.stringify(corrupt), models[0]!.id);
  assert.throws(() => store.list(f.conversation.id), { code: 'COPILOT_REPLAY_INVALID' });
  f.db.prepare('UPDATE copilot_run_steps SET result_json=? WHERE id=?').run(models[0]!.result_json, models[0]!.id);
  assert.throws(() => new CopilotModelResponseRepository(f.db, f.user.id, 'b'.repeat(32)).list(f.conversation.id), { code: 'COPILOT_REPLAY_INVALID' });
  const outsider = new UserRepository(f.db).create('other-replay@test.dev', 'hash');
  assert.equal(new CopilotModelResponseRepository(f.db, outsider.id, key).list(f.conversation.id).size, 0);
});

it('does not resurrect model replay after editing the originating user message', async t => {
  const f = setup(t, 'openai');
  await f.orchestrator().runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Inspect state.' });
  const userMessage = f.ledger.log.listMessages(f.conversation.id)[0]!;
  f.ledger.log.truncateAfterMessage(userMessage.id, 'A different request.');
  assert.equal(new CopilotModelResponseRepository(f.db, f.user.id, key).list(f.conversation.id).size, 0);
  await f.orchestrator().runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'A different request.', skipUserMessage: true });
  assert.equal(JSON.stringify(f.requests.at(-1)).includes('call_1'), false);
  assert.equal(f.executions(), 1);
});

it('treats incomplete or cross-step results as observations instead of valid tool history', async t => {
  const f = setup(t, 'openai');
  await f.orchestrator().runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Inspect state.' });
  const originals = new CopilotModelResponseRepository(f.db, f.user.id, key).list(f.conversation.id);
  const rows = f.ledger.log.listMessages(f.conversation.id);
  for (const altered of [rows.filter(row => row.kind !== 'tool_result'), rows.map(row => row.kind === 'tool_result' ? { ...row, stepId: 'foreign-step' } : row),
    rows.map(row => row.kind === 'tool_result' ? { ...row, runId: 'foreign-run' } : row)]) {
    const history = projectTranscript(altered, originals);
    assert.equal(history.some(m => m.toolCalls || m.role === 'tool'), false);
    assert.ok(history.some(m => m.content.includes('observation only')));
  }
});

it('counts private replay in compression and summarizes older turns using public messages', async t => {
  const f = setup(t, 'openai');
  await f.orchestrator().runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Inspect state.' });
  const originals = new CopilotModelResponseRepository(f.db, f.user.id, key).list(f.conversation.id);
  const first = [...originals.values()][0]!;
  first.providerReplay!.reasoningContent = 'private-large-reasoning'.repeat(1000);
  await assert.rejects(buildCompressedContext(f.ledger.log, f.conversation.id, f.llm, undefined,
    { maxContextChars: 6000, assistantMessages: originals }), /COPILOT_CONTEXT_TOO_LARGE/);
  f.ledger.log.appendMessage(f.conversation.id, { role: 'user', kind: 'text', content: 'Continue from the observed state.' });
  const count = f.requests.length;
  const context = await buildCompressedContext(f.ledger.log, f.conversation.id, f.llm, undefined,
    { maxContextChars: 6000, assistantMessages: originals });
  assert.equal(f.requests.length, count + 1, 'old turn must be summarized, not silently dropped');
  assert.equal(JSON.stringify(f.requests.at(-1)).includes('private-large-reasoning'), false);
  assert.ok(context.messages.some(m => m.content.includes('[会话摘要]')));
  assert.ok(JSON.stringify(context.messages).length < 6000);
});

it('assembles Anthropic SSE thinking signatures and native blocks without losing their order', async () => {
  const events = [
    { type: 'message_start', message: { role: 'assistant', content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'first ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'second' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'complete' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call_1', name: 'inspect_state', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"scope":' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"current"}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    { type: 'message_stop' },
  ];
  const result = await readAnthropicCompletion(new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } }), () => {}, new AbortController().signal);
  assert.deepEqual(result.assistant?.providerReplay?.blocks, [
    { type: 'thinking', thinking: 'first second', signature: 'sig-complete' },
    { type: 'tool_use', id: 'call_1', name: 'inspect_state', input: { scope: 'current' } },
  ]);
});

it('records parser failure diagnostics without executing tentative calls or saving raw provider content', async t => {
  const f = setup(t, 'openai');
  f.llm.stream = async request => readOpenAiCompletion(Response.json({ choices: [{ finish_reason: 'length',
    message: { content: 'private-partial-provider-output', tool_calls: [openaiCall] } }] }), request.onEvent, new AbortController().signal);
  await assert.rejects(f.orchestrator().runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Inspect state.' }),
    { code: 'AGENT_LLM_INVALID_RESPONSE' });
  const run = f.ledger.log.listRuns(f.conversation.id)[0]!;
  assert.equal(run.status, 'failed');
  assert.equal(f.executions(), 0);
  const receipt = JSON.parse(f.ledger.steps(run.id)[0]!.result_json!);
  assert.equal(receipt.type, 'model_response_error');
  assert.equal(receipt.reason, 'Invalid provider response: token limit termination');
  assert.equal(JSON.stringify(receipt).includes('private-partial-provider-output'), false);
});

it('normal text-only stop ends the conversation turn without choosing a tool or imposing a workflow', async t => {
  const f = setup(t, 'openai');
  f.llm.stream = async request => readOpenAiCompletion(Response.json({ choices: [{ finish_reason: 'stop',
    message: { content: '请选择项目，然后我会开始检查。' } }] }), request.onEvent, new AbortController().signal);
  const run = await f.orchestrator().runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Explain the next step.' });
  assert.equal(f.ledger.get(run)?.status, 'completed');
  assert.equal(f.ledger.get(run)?.steps, 1);
  assert.equal(f.executions(), 0);
});
