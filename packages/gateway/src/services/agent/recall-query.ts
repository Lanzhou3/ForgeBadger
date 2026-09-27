import { AgentError } from './types.js';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const MAX_QUERY_CHARACTERS = 512;
const MAX_QUERY_TERMS = 24;
// ICU changes can change dictionary boundaries; old indexes must then rebuild.
export const MEMORY_TOKENIZER_VERSION = `nfkc-lower-segmenter-zh-v1:icu-${process.versions.icu}:unicode-${process.versions.unicode}`;

/** Full document analysis: preserve order and repetitions for phrase/BM25 scoring. */
export function memoryTokens(text: string): string[] {
  return [...segmenter.segment(text.normalize('NFKC').toLowerCase())]
    .filter(part => part.isWordLike)
    .map(part => part.segment);
}

/** Explicit searches retain every term or fail; only automatic recall is truncated. */
export function recallTerms(query: string, mode: 'all' | 'any' = 'all'): string[] {
  const automatic = mode === 'any';
  if (!automatic && query.length > MAX_QUERY_CHARACTERS) throw queryTooLong();
  const terms = [...new Set(memoryTokens(automatic ? query.slice(0, MAX_QUERY_CHARACTERS) : query))];
  if (!automatic && terms.length > MAX_QUERY_TERMS) throw queryTooLong();
  return automatic ? terms.slice(0, MAX_QUERY_TERMS) : terms;
}

function queryTooLong(): AgentError {
  return new AgentError('AGENT_MEMORY_QUERY_TOO_LONG',
    'AGENT_MEMORY_QUERY_TOO_LONG: search supports at most 512 characters and 24 distinct terms; narrow the query.');
}

export function ftsExpression(terms: string[], mode: 'all' | 'any'): string {
  return terms.map(term => `"${term.replaceAll('"', '""')}"`).join(mode === 'all' ? ' AND ' : ' OR ');
}
