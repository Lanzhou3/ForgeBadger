/**
 * Phase-3 query routing (RouteDRAG, 2610.36444): agentic execution only pays
 * off for some queries, and extra steps can *hurt* others, so a router decides
 * whether to run the multi-step search at all and how. This is a *heuristic*
 * stand-in for that learned router (no RL here): it reads the query for
 * signals of cross-source / multi-entity / evidence-collecting intent.
 */

export type RouteMode = 'direct' | 'research';

const RESEARCH_PATTERNS: Array<{ pattern: RegExp; note: string }> = [
  { pattern: /\b(across|throughout|spanning|within each of|in each of)\b/i, note: 'cross-source' },
  { pattern: /\b(compare|contrast|differen[cs]e|which of|how does .* (relate|differ|map))\b/i, note: 'comparison' },
  { pattern: /\b(find|collect|gather|trace|audit)\b.{0,40}\bevidence\b/i, note: 'evidence collection' },
  { pattern: /\b(evidence|proof|support|justif)/i, note: 'evidence requested' },
  { pattern: /\b(investigate|deep-?dive|why (is|are|do))\b/i, note: 'investigation' },
  { pattern: /\b(both|all three|each of|comprehensive|thorough)\b/i, note: 'multi-entity' },
];

/**
 * Classify a query as 'direct' (one-shot answer) or 'research' (multi-step
 * search/retrieve). A research verdict needs either one strong pattern OR two or
 * weaker independent signals, or a long enumerative query — mirroring RouteDRAG's
 * "only spend agent steps when the query warrants it."
 */
export function routeQuery(text: string): { mode: RouteMode; rationale: string; signals: string[] } {
  const signals = RESEARCH_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ note }) => note);
  const clauses = (text.match(/[.!?;]|,\s+/g) ?? []).length;
  const longEnumerative = text.length > 120 && /[,]/.test(text) && clauses >= 2;
  const strong = signals.includes('cross-source') || signals.includes('comparison');
  const mode: RouteMode = strong || signals.length >= 2 || longEnumerative ? 'research' : 'direct';
  return { mode, signals, rationale: mode === 'research' ? `signals: ${signals.join(', ')}` : 'single, bounded question' };
}
