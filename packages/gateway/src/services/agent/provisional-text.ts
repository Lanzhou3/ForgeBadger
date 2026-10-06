import type { Database } from '../../db/types.js';

interface PublicStepText { stepId: string; fence: number; sequence: number; text: string }
const states = new WeakMap<Database, Map<string, { userId: string; steps: PublicStepText[]; chars: number }>>();
const MAX_CHARS = 256 * 1024;
const MAX_RUNS = 32;

/** Only PublicTextStream's already-redacted publications may enter this cache. */
export function appendProvisionalText(db: Database, userId: string, runId: string, stepId: string, fence: number, sequence: number, text: string): void {
  let cache = states.get(db);
  if (!cache) { cache = new Map(); states.set(db, cache); }
  let entry = cache.get(runId);
  const last = entry?.steps.at(-1);
  if (entry && (entry.userId !== userId || fence < last!.fence)) return;
  if (!entry) {
    if (sequence !== 1) return;
    entry = { userId, steps: [], chars: 0 };
    cache.set(runId, entry);
  }
  let step = entry.steps.at(-1);
  if (step?.stepId !== stepId || step.fence !== fence) {
    if (sequence !== 1 || entry.steps.some(item => item.stepId === stepId)) return;
    step = { stepId, fence, sequence: 0, text: '' };
    entry.steps.push(step);
  }
  if (sequence !== step.sequence + 1) return;
  if (entry.chars + text.length > MAX_CHARS) { cache.delete(runId); return; }
  step.text += text; step.sequence = sequence; entry.chars += text.length;
  while (cache.size > MAX_RUNS) cache.delete(cache.keys().next().value!);
}

export function provisionalText(db: Database, userId: string, runId: string) {
  const entry = states.get(db)?.get(runId);
  return entry?.userId === userId ? { steps: entry.steps.map(step => ({ ...step })) } : undefined;
}

export function clearProvisionalText(db: Database, runId: string): void { states.get(db)?.delete(runId); }
export function clearAllProvisionalText(db: Database): void { states.delete(db); }
