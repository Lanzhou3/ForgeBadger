import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  contextTokenBudget, estimateJsonTokens, estimateMessagesTokens, estimateTextTokens,
  MAX_CONTEXT_TOKENS, MESSAGE_OVERHEAD_TOKENS, weightedCharCost,
} from '../src/services/agent/token-estimate.js';

it('weights Latin, CJK and supplementary planes monotonically', () => {
  const latin = 'word boundary '.repeat(100); // 1400 ASCII chars
  const cjk = '汉字边界'.repeat(350); // 1400 CJK chars
  const mixed = '汉字boundary'.repeat(120); // ~1440 chars, mixed scripts
  const emoji = '🚀'.repeat(350); // 350 supplementary chars
  const latinTokens = estimateTextTokens(latin);
  const cjkTokens = estimateTextTokens(cjk);
  const mixedTokens = estimateTextTokens(mixed);
  const emojiTokens = estimateTextTokens(emoji);
  // Same char count: Latin (1/4 tok/char) < mixed < CJK (1 tok/char); emoji ≈ 2 tok/char.
  assert.ok(latinTokens < mixedTokens && mixedTokens < cjkTokens, `latin=${latinTokens} mixed=${mixedTokens} cjk=${cjkTokens}`);
  assert.ok(cjkTokens > emojiTokens / 4, 'supplementary plane is weighted heaviest per char');
  assert.equal(estimateTextTokens('a'.repeat(400)), 100);
  assert.equal(estimateTextTokens('汉'.repeat(400)), 400);
  assert.equal(estimateTextTokens('🚀'.repeat(100)), 200);
});

it('weights Hiragana, Katakana, Hangul, CJK punctuation and fullwidth forms as CJK', () => {
  for (const text of ['あ'.repeat(100), 'ア'.repeat(100), '가'.repeat(100), '。'.repeat(100), '！'.repeat(100)])
    assert.equal(estimateTextTokens(text), 100, `expected CJK weight for ${text[0]}`);
  // Other BMP costs 2 per char; Latin-1 supplement stays Latin weight 1.
  assert.equal(weightedCharCost('Ω'.repeat(100)), 200);
  assert.equal(weightedCharCost('é'.repeat(100)), 100);
});

it('adds a fixed per-message overhead and applies the safety margin once', () => {
  const single = estimateMessagesTokens([{ role: 'user', content: '' }]);
  assert.equal(single, Math.ceil((MESSAGE_OVERHEAD_TOKENS * 6) / 5));
  const two = estimateMessagesTokens([{ role: 'user', content: '' }, { role: 'assistant', content: '' }]);
  assert.equal(two, Math.ceil((MESSAGE_OVERHEAD_TOKENS * 2 * 6) / 5));
  const text = 'a'.repeat(400); // 100 base tokens
  const withContent = estimateMessagesTokens([{ role: 'user', content: text }]);
  assert.equal(withContent, Math.ceil(((100 + MESSAGE_OVERHEAD_TOKENS) * 6) / 5));
  assert.ok(withContent > 100 + MESSAGE_OVERHEAD_TOKENS, 'margin must exceed the un-margined base');
});

it('estimates JSON payloads conservatively relative to plain text', () => {
  const value = { output: 'x'.repeat(300), nested: { list: [1, 2, 3] } };
  const jsonTokens = estimateJsonTokens(value);
  const textTokens = estimateTextTokens(JSON.stringify(value));
  assert.ok(jsonTokens >= textTokens, 'JSON payloads ride /3 envelopes and must not estimate cheaper');
  assert.equal(estimateJsonTokens({}), 2);
});

it('clamps context token budgets and falls back for unknown windows', () => {
  assert.equal(contextTokenBudget(null), MAX_CONTEXT_TOKENS);
  assert.equal(contextTokenBudget(undefined), MAX_CONTEXT_TOKENS);
  assert.equal(contextTokenBudget(32_768), 24_576); // window - window/4 reserve
  assert.equal(contextTokenBudget(200_000), 183_616); // window - 16384 reserve
  // Small window: reserve can never starve the prompt below 8k / half the window.
  assert.equal(contextTokenBudget(10_000), 8_000);
  assert.equal(contextTokenBudget(100_000), Math.max(50_000, 100_000 - 16_384));
  assert.ok(contextTokenBudget(1_000) >= 8_000);
});
