import { z } from 'zod';
import type { Database } from '../types.js';
import { decryptSecret, encryptSecret } from '../../crypto/secret-box.js';
import type { AssistantMessage } from '../../services/agent/llm-replay.js';
import type { LlmResult } from '../../services/agent/llm-response.js';
import { AgentError } from '../../services/agent/types.js';
import { redactAgentText } from '../../services/agent/redaction.js';

const assistantSchema = z.object({
  role: z.literal('assistant'), content: z.string(),
  toolCalls: z.array(z.object({ id: z.string(), name: z.string(), arguments: z.string() })).optional(),
  providerReplay: z.object({ format: z.enum(['openai', 'anthropic']), identity: z.string().optional(),
    reasoningContent: z.string().optional(), reasoningDetails: z.array(z.record(z.unknown())).optional(),
    blocks: z.array(z.record(z.unknown())).optional() }).strict().optional(),
}).strict();
const payloadSchema = z.object({ version: z.literal(1), userId: z.string(), conversationId: z.string(),
  runId: z.string(), stepId: z.string(), assistant: assistantSchema }).strict();
const envelopeSchema = z.object({ type: z.literal('model_response'), version: z.literal(1),
  finishReason: z.string().nullable(), toolCallCount: z.number().int().nonnegative(),
  replay: z.object({ algorithm: z.literal('aes-256-gcm'), iv: z.string(), ciphertext: z.string(), authTag: z.string() }).strict(),
}).strict();
interface StepRow { id: string; run_id: string; ordinal: number; kind: string; result_json: string | null }
interface MessageRow { id: string; step_id: string | null; run_id: string | null; kind: string; content: string;
  tool_call_id: string | null; tool_name: string | null; tool_input_json: string | null }

/** Private model replay lives in the existing model-step receipt, not the public transcript. */
export class CopilotModelResponseRepository {
  constructor(private readonly db: Database, private readonly userId: string, private readonly masterKey: string) {}

  encode(conversationId: string, runId: string, stepId: string, response: LlmResult): string {
    if (!response.assistant) return response.message; // Legacy/custom clients have no native replay state.
    const assistant = assistantSchema.parse(response.assistant);
    return JSON.stringify({ type: 'model_response', version: 1, finishReason: response.finishReason ?? null,
      toolCallCount: assistant.toolCalls?.length ?? 0,
      replay: encryptSecret(JSON.stringify({ version: 1, userId: this.userId, conversationId, runId, stepId, assistant }), { key: this.masterKey }) });
  }

  complete(conversationId: string, runId: string, stepId: string, response: LlmResult): void {
    // Called inside the lease-fenced model/tool-plan transaction. Do not run a
    // text redactor over authenticated ciphertext or signed provider blocks.
    const result = this.encode(conversationId, runId, stepId, response);
    this.db.prepare(`UPDATE copilot_run_steps SET status='completed',result_json=?,completed_at=?
      WHERE user_id=? AND run_id=? AND id=? AND kind='model' AND status='running'
      AND EXISTS (SELECT 1 FROM copilot_runs WHERE user_id=? AND id=? AND conversation_id=?)`)
      .run(result, Date.now(), this.userId, runId, stepId, this.userId, runId, conversationId);
  }

  recordInvalidResponse(runId: string, message: string): void {
    // Parser failures contain fixed diagnostics, never response bodies or reasoning.
    this.db.prepare(`UPDATE copilot_run_steps SET result_json=? WHERE user_id=? AND run_id=?
      AND kind='model' AND status='running'`).run(JSON.stringify({ type: 'model_response_error', version: 1,
      code: 'AGENT_LLM_INVALID_RESPONSE', reason: redactAgentText(message) }), this.userId, runId);
  }

  list(conversationId: string): Map<string, AssistantMessage> {
    const steps = this.db.prepare(`SELECT s.id,s.run_id,s.ordinal,s.kind,s.result_json FROM copilot_run_steps s
      JOIN copilot_runs r ON r.id=s.run_id AND r.user_id=s.user_id
      WHERE s.user_id=? AND r.conversation_id=? ORDER BY s.run_id,s.ordinal`).all(this.userId, conversationId) as StepRow[];
    const rows = this.db.prepare(`SELECT id,step_id,run_id,kind,content,tool_call_id,tool_name,tool_input_json
      FROM copilot_messages WHERE user_id=? AND conversation_id=? ORDER BY sequence`).all(this.userId, conversationId) as MessageRow[];
    const result = new Map<string, AssistantMessage>();
    const parent = new Map<string, StepRow>();
    let model: StepRow | undefined;
    for (const step of steps) {
      if (model?.run_id !== step.run_id) model = undefined;
      if (step.kind === 'model') model = step;
      if (model) parent.set(step.id, model);
    }
    for (const step of steps.filter(s => s.kind === 'model')) {
      const messages = rows.filter(row => row.step_id && parent.get(row.step_id)?.id === step.id
        && row.run_id === step.run_id && ['text', 'tool_call'].includes(row.kind));
      if (!messages.length) continue; // Edited/truncated history must not resurrect old execution evidence.
      const assistant = this.decode(conversationId, step);
      if (!assistant) continue;
      if (!matchesTranscript(assistant, messages)) throw replayError();
      for (const row of messages) result.set(row.id, assistant);
    }
    return result;
  }

  private decode(conversationId: string, step: StepRow): AssistantMessage | undefined {
    let value: unknown;
    try { value = JSON.parse(step.result_json ?? 'null'); } catch { return undefined; }
    if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'model_response') return undefined;
    try {
      const envelope = envelopeSchema.parse(value);
      const payload = payloadSchema.parse(JSON.parse(decryptSecret(envelope.replay, { key: this.masterKey })));
      if (payload.userId !== this.userId || payload.conversationId !== conversationId
        || payload.runId !== step.run_id || payload.stepId !== step.id
        || envelope.toolCallCount !== (payload.assistant.toolCalls?.length ?? 0)) throw replayError();
      return payload.assistant as AssistantMessage; // Parsed JSON cannot contain undefined optional fields.
    } catch { throw replayError(); }
  }
}

function matchesTranscript(assistant: AssistantMessage, rows: MessageRow[]): boolean {
  const text = rows.filter(row => row.kind === 'text');
  const calls = rows.filter(row => row.kind === 'tool_call');
  const expected = assistant.toolCalls ?? [];
  if (text.length > 1 || (text[0]?.content ?? '') !== redactAgentText(assistant.content) || calls.length !== expected.length) return false;
  return calls.every((row, index) => {
    const call = expected[index]!;
    try { return row.tool_call_id === call.id && row.tool_name === call.name
      && row.tool_input_json === JSON.stringify(JSON.parse(call.arguments)); } catch { return false; }
  });
}

function replayError(): AgentError {
  return new AgentError('COPILOT_REPLAY_INVALID', 'Stored model response failed identity or transcript validation');
}

/** The run inspector gets termination diagnostics, never the encrypted replay blob. */
export function publicModelResponse(result: string | null): string | null {
  let value: unknown;
  try { value = JSON.parse(result ?? 'null'); } catch { return result; }
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'model_response') return result;
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) return null;
  const { replay: _private, ...diagnostic } = parsed.data;
  return JSON.stringify(diagnostic);
}
