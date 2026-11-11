import { memoryTokens } from './recall-query.js';
import type { AgentLlmToolSchema } from './orchestrator-types.js';

const normalize = (value: string) => value.normalize('NFKC').toLowerCase();
const terms = (value: string) => memoryTokens(value.replace(/[_-]/gu, ' '));

/** BM25 over the effective name/description catalog, never schema or hidden tools.
 * k1=1.2 and b=.75 are retrieval parameters, not language/intent rules. */
export function rankCatalog(catalog: AgentLlmToolSchema[], query: string): AgentLlmToolSchema[] {
  const needle = normalize(query);
  // An identifier request names one capability, including when it is unavailable.
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/u.test(needle)) return catalog.filter(tool => normalize(tool.name) === needle);
  const queryTerms = [...new Set(terms(needle))];
  const documents = catalog.map(tool => ({tool, nameWords: terms(tool.name), words: terms(`${tool.name} ${tool.description}`)}));
  const average = documents.reduce((sum, doc) => sum + doc.words.length, 0) / (documents.length || 1) || 1;
  const frequencies = new Map(queryTerms.map(term => [term, documents.filter(doc => doc.words.includes(term)).length]));
  return documents.map(({tool, nameWords, words}) => {
    const score = queryTerms.reduce((sum, term) => {
      const frequency = words.filter(word => word === term).length;
      if (!frequency) return sum;
      const documentFrequency = frequencies.get(term)!;
      const idf = Math.log(1 + (documents.length - documentFrequency + .5) / (documentFrequency + .5));
      // A term matching the tool's own name is the strongest relevance signal
      // available; lexical BM25 alone underweights short identifier terms buried
      // in long descriptions ("session" would not surface create_session).
      const nameBoost = nameWords.includes(term) ? 2 : 1;
      return sum + nameBoost * idf * frequency * 2.2 / (frequency + 1.2 * (.25 + .75 * words.length / average));
    }, 0);
    return {tool, score, exact: normalize(tool.name) === needle};
  }).filter(hit => hit.exact || hit.score > 0)
    .sort((a,b) => Number(b.exact)-Number(a.exact) || b.score-a.score || a.tool.name.localeCompare(b.tool.name))
    .map(hit => hit.tool);
}
