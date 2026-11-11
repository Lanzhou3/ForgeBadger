/**
 * Phase-3 grounding + falsification for agentic retrieval.
 *
 * Two frontier ideas, made deterministic:
 *  - OA-RAG (2610.36335): label each cited piece of evidence with a grounding
 *    level so a claim's faithfulness is inspectable, not asserted.
 *  - FALCA (2610.28361): the deep-search failure mode is a claim resting on
 *    evidence that is never checked. Here we make the falsification step
 *    *sound*: before a grounding level is accepted, the cited path/line/snippet
 *    must actually exist in the root, or the item is downgraded to "unrelated".
 *
 * The grounding *level* (entailed vs supported vs related) is still the model's
 * semantic judgment — this module only guarantees the evidence is real and
 * anchored, and that an unlocated citation can never carry a strong label.
 */

/** OA-RAG grounding ladder, strongest to weakest. */
export const GROUNDING_LEVELS = ['entailed', 'supported', 'related', 'unrelated'] as const;
export type GroundingLevel = (typeof GROUNDING_LEVELS)[number];

export interface VerifiedEvidence {
  verified: boolean;
  grounded: GroundingLevel;
  /** Present in the cited line, whitespace-normalized. */
  present: boolean;
  reason?: string;
}

/** Collapse runs of whitespace so a citation survives reflow/indent. */
function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Deterministic falsification: does the cited line actually contain the cited
 * snippet? `verified` is true only when the snippet is a normalized substring of
 * the line at the given (1-based) line number. A strong grounding label is
 * meaningful only when the evidence is real, so an unlocated citation returns
 * grounded:"unrelated" regardless of what was proposed.
 */
export function verifyEvidence(lineText: string | undefined, snippet: string, proposed: GroundingLevel, line: number): VerifiedEvidence {
  if (lineText === undefined) {
    return { verified: false, grounded: 'unrelated', present: false, reason: 'LINE_OUT_OF_RANGE' };
  }
  const hay = normalizeSpace(lineText);
  const needle = normalizeSpace(snippet);
  if (!needle || !hay.includes(needle)) {
    return { verified: false, grounded: 'unrelated', present: false, reason: 'SNIPPET_NOT_FOUND' };
  }
  // The citation is real and anchored; the proposed (weaker-or-equal) level stands.
  return { verified: true, grounded: proposed, present: true };
}

/** The strongest grounding level a real-but-unjudged citation can default to. */
export function defaultGrounding(): GroundingLevel {
  return 'related';
}
