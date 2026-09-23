import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readOpenAiCompletion } from '../src/services/agent/llm-openai.js';
import type { AgentLlmStreamEvent } from '../src/services/agent/llm-client.js';

function frame(toolCalls: unknown[], finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: finishReason }] })}\n\n`;
}
const delta = (name: string, args: string, options: { index?: number; id?: string } = {}) => ({ index: options.index ?? 0, ...(options.id ? { id: options.id } : {}), function: { name, arguments: args } });
const done = 'data: [DONE]\n\n';
function stream(body: string | ReadableStream<Uint8Array>) { return new Response(body, { headers: { 'content-type': 'text/event-stream' } }); }
function run(body: string | ReadableStream<Uint8Array>, options: { allowFinishReasonEof?: boolean; toolNames?: readonly string[]; reasoningDetailsMode?: 'snapshot' } = {}) {
  const events: AgentLlmStreamEvent[] = [];
  const promise = readOpenAiCompletion(stream(body), event => events.push(event), new AbortController().signal, { toolNames: ['pm_get_task_progress', 'get_session_output', 'get_session', 'echo', 'good', 'bad', 'tool_tool_part'], ...options });
  return { events, promise };
}
function emittedTools(events: AgentLlmStreamEvent[]) { return events.filter(event => event.type === 'tool_call').map(event => event.toolCall); }
function assertNoTools(events: AgentLlmStreamEvent[]) { assert.equal(events.some(event => event.type === 'tool_call' || event.type === 'done'), false); }

const repeated = () => frame([delta('pm_get_task_progress', '{"projectId":', { id: 'call_one' })])
  + frame([delta('pm_get_task_progress', '"p",', { id: 'call_one' })])
  + frame([delta('pm_get_task_progress', '"workItemId":"w"}')], 'tool_calls');

describe('OpenAI streaming tool-name deltas', () => {
  it('keeps a repeatedly supplied complete function name once while assembling every argument fragment', async () => {
    const { events, promise } = run(repeated() + done);
    await promise;
    assert.deepEqual(emittedTools(events), [{ id: 'call_one', name: 'pm_get_task_progress', arguments: '{"projectId":"p","workItemId":"w"}' }]);
  });

  it('preserves ordinary fragmented names instead of replacing previous fragments', async () => {
    const { events, promise } = run(frame([delta('get_', '', { id: 'call_fragments' })])
      + frame([delta('session', '')]) + frame([delta('_output', '{"sessionId":"s"}')], 'tool_calls') + done);
    await promise;
    assert.deepEqual(emittedTools(events), [{ id: 'call_fragments', name: 'get_session_output', arguments: '{"sessionId":"s"}' }]);
  });

  it('recognizes an exact complete-name repeat after earlier name fragments assembled it', async () => {
    const { events, promise } = run(frame([delta('pm_get_', '', { id: 'call_fragment_then_repeat' })])
      + frame([delta('task_progress', '{')]) + frame([delta('pm_get_task_progress', '}')], 'tool_calls') + done);
    await promise;
    assert.deepEqual(emittedTools(events), [{ id: 'call_fragment_then_repeat', name: 'pm_get_task_progress', arguments: '{}' }]);
  });

  it('keeps distinct same-name calls at separate indexes and does not deduplicate argument bytes', async () => {
    const { events, promise } = run(frame([delta('echo', '{"text":"', { id: 'a' }), delta('echo', '{"text":"', { index: 1, id: 'b' })])
      + frame([delta('echo', 'a'), delta('echo', 'b', { index: 1 })])
      + frame([delta('echo', 'a'), delta('echo', 'b', { index: 1 })])
      + frame([delta('echo', '"}'), delta('echo', '"}', { index: 1 })], 'tool_calls') + done);
    await promise;
    assert.deepEqual(emittedTools(events), [
      { id: 'a', name: 'echo', arguments: '{"text":"aa"}' },
      { id: 'b', name: 'echo', arguments: '{"text":"bb"}' }
    ]);
  });

  it('does not infer prefix/suffix overlap between unequal name fragments', async () => {
    const { events, promise } = run(frame([delta('tool_', '', { id: 'overlap' })])
      + frame([delta('tool_part', '{}')], 'tool_calls') + done);
    await promise;
    assert.equal(emittedTools(events)[0]?.name, 'tool_tool_part');
  });

  it('still rejects a conflicting id at one index without publishing any call', async () => {
    const { events, promise } = run(frame([delta('get_session', '{', { id: 'original' })])
      + frame([delta('get_session', '}', { id: 'conflict' })], 'tool_calls') + done);
    await assert.rejects(promise, /conflicting tool identity/);
    assertNoTools(events);
  });

  it('validates the entire batch before publishing repeated-name calls', async () => {
    const { events, promise } = run(frame([delta('good', '{', { id: 'good' }), delta('bad', '{', { index: 1, id: 'bad' })])
      + frame([delta('good', '}'), delta('bad', 'malformed', { index: 1 })], 'tool_calls') + done);
    await assert.rejects(promise, /malformed JSON/);
    assertNoTools(events);
  });

  it('does not repair duplicated complete argument objects', async () => {
    const { events, promise } = run(frame([delta('get_session', '{}', { id: 'bad_arguments' })])
      + frame([delta('get_session', '{}')], 'tool_calls') + done);
    await assert.rejects(promise, /malformed JSON/);
    assertNoTools(events);
  });

  it('waits for transport EOF before publishing a repeated-name call even after DONE', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const { events, promise } = run(new ReadableStream({ start(controller) { source = controller; } }));
    source.enqueue(new TextEncoder().encode(repeated() + done));
    await new Promise(resolve => setImmediate(resolve));
    assertNoTools(events);
    source.close();
    await promise;
    assert.equal(emittedTools(events).length, 1);
    assert.equal(emittedTools(events)[0]?.name, 'pm_get_task_progress');
  });

  it('does not weaken the mandatory terminal marker for ordinary OpenAI-compatible streams', async () => {
    const { events, promise } = run(repeated());
    await assert.rejects(promise, /missing terminal marker/);
    assertNoTools(events);
  });

  it('supports exact repeated names when the caller explicitly permits successful finish-reason EOF', async () => {
    const { events, promise } = run(repeated(), { allowFinishReasonEof: true });
    await promise;
    assert.equal(emittedTools(events)[0]?.name, 'pm_get_task_progress');
  });

  it('publishes no repeated-name call after a transport disconnect', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const { events, promise } = run(new ReadableStream({ start(controller) { source = controller; } }), { allowFinishReasonEof: true });
    source.enqueue(new TextEncoder().encode(repeated()));
    await new Promise(resolve => setImmediate(resolve));
    assertNoTools(events);
    source.error(new Error('disconnected'));
    await assert.rejects(promise, /interrupted/);
    assertNoTools(events);
  });
  it('preserves equal fragments when only their ordinary concatenation names a declared tool', async () => {
    const { events, promise } = run(frame([delta('foo', '{', { id: 'equal_fragments' })])
      + frame([delta('foo', '}')], 'tool_calls') + done, { toolNames: ['foofoo'] });
    await promise;
    assert.equal(emittedTools(events)[0]?.name, 'foofoo');
  });

  it('rejects an ambiguous name when normal and deduplicated names are both declared tools', async () => {
    const { events, promise } = run(frame([delta('foo', '{', { id: 'ambiguous' })])
      + frame([delta('foo', '}')], 'tool_calls') + done, { toolNames: ['foo', 'foofoo'] });
    await assert.rejects(promise, /ambiguous tool name/);
    assertNoTools(events);
  });

  it('keeps the ordinary unknown name when neither candidate is declared', async () => {
    const { events, promise } = run(frame([delta('foo', '{', { id: 'unknown' })])
      + frame([delta('foo', '}')], 'tool_calls') + done, { toolNames: [] });
    await promise;
    assert.equal(emittedTools(events)[0]?.name, 'foofoo');
  });

});

const reasoningFrame = (value: Record<string, unknown>, finishReason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: value, finish_reason: finishReason }] })}\n\n`;
const reasoningDetails = [
  { type: 'reasoning.encrypted', id: 'opaque_b', data: 'fixture-encrypted-b', signature: 'fixture-signature-b' },
  { type: 'reasoning.summary', id: 'summary_a', summary: 'fixture summary' }
];
function assertPrivateDone(events: AgentLlmStreamEvent[]) {
  const event = events.find(item => item.type === 'done');
  assert.ok(event);
  assert.equal('assistant' in event, false);
  assert.equal('replay' in event, false);
  assert.equal('providerReplay' in event, false);
  assert.ok(!JSON.stringify(events).includes('fixture-encrypted-b'));
}

describe('OpenAI private reasoning replay', () => {
  it('preserves complete JSON reasoning content and detail-array order only in the returned assistant', async () => {
    const events: AgentLlmStreamEvent[] = [];
    const result = await readOpenAiCompletion(Response.json({ choices: [{ message: { role: 'assistant', content: 'Answer', reasoning_content: 'First thought\nSecond thought', reasoning_details: reasoningDetails }, finish_reason: 'stop' }] }), event => events.push(event), new AbortController().signal);
    assert.deepEqual(result.assistant?.providerReplay, { format: 'openai', reasoningContent: 'First thought\nSecond thought', reasoningDetails });
    assert.equal(result.assistant?.content, 'Answer');
    assertPrivateDone(events);
  });

  it('accumulates streamed reasoning text and preserves one complete final detail array without emitting replay', async () => {
    const { events, promise } = run(reasoningFrame({ reasoning_content: 'First ' })
      + reasoningFrame({ reasoning_content: 'second', reasoning_details: [] })
      + reasoningFrame({ reasoning_details: reasoningDetails, tool_calls: [delta('get_session', '{}', { id: 'reasoning_call' })] }, 'tool_calls') + done);
    const result = await promise;
    assert.deepEqual(result.assistant?.providerReplay, { format: 'openai', reasoningContent: 'First second', reasoningDetails });
    assert.deepEqual(result.assistant?.toolCalls, [{ id: 'reasoning_call', name: 'get_session', arguments: '{}' }]);
    assertPrivateDone(events);
  });

  it('preserves identical complete detail-array repeats and ignores later generic empty placeholders', async () => {
    const { events, promise } = run(reasoningFrame({ reasoning_details: reasoningDetails })
      + reasoningFrame({ reasoning_details: reasoningDetails })
      + reasoningFrame({ reasoning_details: [], content: 'Answer' }, 'stop') + done);
    const result = await promise;
    assert.deepEqual(result.assistant?.providerReplay, { format: 'openai', reasoningDetails });
    assertPrivateDone(events);
  });

  it('rejects non-object detail-array entries in JSON without publishing a tool call', async () => {
    const events: AgentLlmStreamEvent[] = [];
    const response = Response.json({ choices: [{ message: { reasoning_details: [null], tool_calls: [{ id: 'json_details', type: 'function', function: { name: 'get_session', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
    await assert.rejects(readOpenAiCompletion(response, event => events.push(event), new AbortController().signal), /reasoning details/);
    assertNoTools(events);
  });

  it('rejects a malformed reasoning-detail shape before publishing a valid tool batch', async () => {
    const { events, promise } = run(reasoningFrame({ reasoning_details: 'not-an-array', tool_calls: [delta('get_session', '{}', { id: 'malformed_details' })] }, 'tool_calls') + done);
    await assert.rejects(promise, /reasoning details/);
    assertNoTools(events);
  });

  it('does not invent a merge for conflicting nonempty streamed reasoning-detail arrays', async () => {
    const { events, promise } = run(reasoningFrame({ reasoning_details: reasoningDetails })
      + reasoningFrame({ reasoning_details: [{ type: 'reasoning.encrypted', data: 'different-final-block' }], tool_calls: [delta('get_session', '{}', { id: 'conflicting_details' })] }, 'tool_calls') + done);
    await assert.rejects(promise, /reasoning details/);
    assertNoTools(events);
  });
  it('uses the final complete detail-array snapshot only when the endpoint mode explicitly declares snapshots', async () => {
    const { events, promise } = run(reasoningFrame({ reasoning_content: 'One ', reasoning_details: [{ type: 'reasoning.text', text: 'Partial', index: 0 }] })
      + reasoningFrame({ reasoning_content: 'two', reasoning_details: reasoningDetails, content: 'Answer' }, 'stop') + done, { reasoningDetailsMode: 'snapshot' });
    const result = await promise;
    assert.deepEqual(result.assistant?.providerReplay, { format: 'openai', reasoningContent: 'One two', reasoningDetails });
    assertPrivateDone(events);
  });

});
