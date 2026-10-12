import { createHash } from 'node:crypto';
import { redactAgentText, redactAgentValue } from './redaction.js';
import type { AgentLlmMessage } from './llm-client.js';

/** Private provider state. Never send this object in UI/API events. */
export interface ProviderReplay {
  format: 'openai' | 'anthropic';
  identity?: string;
  reasoningContent?: string;
  reasoningDetails?: Array<Record<string, unknown>>;
  blocks?: Array<Record<string, unknown>>;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  providerReplay?: ProviderReplay;
}

export function replayIdentity(source: { modelProfileId: string; modelId: string; baseUrl: string; apiFormat: string }): string {
  return createHash('sha256').update(JSON.stringify([source.modelProfileId, source.modelId,
    source.baseUrl, source.apiFormat])).digest('hex');
}

export function matchingReplay(message: { providerReplay?: ProviderReplay }, source: Parameters<typeof replayIdentity>[0]): ProviderReplay | undefined {
  const replay = message.providerReplay;
  const format = source.apiFormat === 'anthropic' ? 'anthropic' : 'openai';
  return replay?.format === format && replay.identity === replayIdentity(source) ? replay : undefined;
}

/** Summaries and different providers receive public conversation content only. */
export function withoutPrivateReplay(message: AgentLlmMessage): AgentLlmMessage {
  const { providerReplay: _private, ...plain } = message;
  if (plain.role !== 'assistant') return plain;
  return { ...plain, content: redactAgentText(plain.content.replace(/<think>[\s\S]*?(?:<\/think>|$)/gu, '')),
    ...(plain.toolCalls ? { toolCalls: plain.toolCalls.map(call => ({ ...call,
      arguments: JSON.stringify(redactAgentValue(JSON.parse(call.arguments))) })) } : {}) };
}
