/**
 * Token-aware context budgeting (OpenClaw-style CJK-weighted estimator).
 *
 * Replaces the old fixed chars-per-token heuristic: characters are weighted by
 * Unicode range (Latin ≈ 1/4 token, common CJK ≈ 1 token, supplementary-plane
 * ≈ 2 tokens), so CJK transcripts stop getting a 4x-overconfident budget. A
 * single 1.2 safety margin is applied at the aggregate boundary, never per
 * character. Estimates are conservative projections; provider usage remains
 * authoritative.
 */
import type { AgentLlmMessage } from './orchestrator-types.js';

export const MESSAGE_OVERHEAD_TOKENS = 12;
export const SAFETY_MARGIN_NUMERATOR = 6;
export const SAFETY_MARGIN_DENOMINATOR = 5;
export const MAX_CONTEXT_TOKENS = 24_000;

/** Weighted char cost per code point: Latin 1, common CJK 4, other BMP 2, supplementary 8. */
export function weightedCharCost(text: string): number {
  let cost = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 0x300) cost += 1;
    else if (isCommonCjk(codePoint)) cost += 4;
    else if (codePoint <= 0xffff) cost += 2;
    else cost += 8;
  }
  return cost;
}

function isCommonCjk(codePoint: number): boolean {
  return (codePoint >= 0x3000 && codePoint <= 0x303f) // CJK punctuation
    || (codePoint >= 0x3040 && codePoint <= 0x30ff) // Hiragana + Katakana
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff) // Unified Ideographs
    || (codePoint >= 0xac00 && codePoint <= 0xd7af) // Hangul syllables
    || (codePoint >= 0xff00 && codePoint <= 0xffef); // fullwidth forms
}

/** Base estimate without the safety margin: ceil(cost / divisor). */
function costTokens(cost: number, divisor: number): number {
  return Math.ceil(cost / divisor);
}

/** Plain text: roughly 1 token per weighted 4 cost (Latin ≈ 4 chars/token, CJK ≈ 1 char/token). */
export function estimateTextTokens(text: string): number {
  return costTokens(weightedCharCost(text), 4);
}

/** Tool-call arguments / replay blocks ride JSON envelopes; be conservative. */
export function jsonCostTokens(value: string): number {
  return costTokens(weightedCharCost(value), 3);
}

/** Serialized per-message cost (no margin): content + envelope as wire-escaped JSON. */
export function messageWireTokens(message: AgentLlmMessage): number {
  return jsonCostTokens(JSON.stringify(message));
}

/** Per-message base cost (no margin): content + tool-call JSON + private replay + overhead. */
export function messageBaseTokens(message: AgentLlmMessage): number {
  let base = estimateTextTokens(message.content) + MESSAGE_OVERHEAD_TOKENS;
  for (const call of message.toolCalls ?? []) base += jsonCostTokens(call.arguments);
  const replay = message.providerReplay;
  if (replay) {
    if (replay.reasoningContent) base += estimateTextTokens(replay.reasoningContent);
    base += jsonCostTokens(JSON.stringify(replay.reasoningDetails ?? []));
    base += jsonCostTokens(JSON.stringify(replay.blocks ?? []));
  }
  return base;
}

/** Aggregate message estimate with the single safety margin applied once. */
export function estimateMessagesTokens(messages: AgentLlmMessage[]): number {
  const base = messages.reduce((sum, message) => sum + messageBaseTokens(message), 0);
  return Math.ceil((base * SAFETY_MARGIN_NUMERATOR) / SAFETY_MARGIN_DENOMINATOR);
}

/** Structured payloads (provider bodies, tool schemas): conservative /3 with the margin. */
export function estimateJsonTokens(value: unknown): number {
  return Math.ceil((costTokens(weightedCharCost(JSON.stringify(value) ?? ''), 3) * SAFETY_MARGIN_NUMERATOR) / SAFETY_MARGIN_DENOMINATOR);
}

/**
 * Projection budget for a provider context window: reserve the output headroom
 * (up to 16k or a quarter of the window), never letting the reserve starve the
 * prompt below half the window (or 8k). Unknown windows fall back to the
 * harness default aligned with the retired 96k-char bound.
 */
export function contextTokenBudget(contextWindow?: number | null): number {
  if (!contextWindow) return MAX_CONTEXT_TOKENS;
  const reserve = Math.min(16_384, contextWindow / 4);
  return Math.max(Math.max(8_000, contextWindow * 0.5), contextWindow - reserve);
}
