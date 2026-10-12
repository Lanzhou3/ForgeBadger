import { createHash } from 'node:crypto';
import type { RunStep } from './run-ledger.js';

// Only stable local observations. Polling, external tools, writes and discovery
// remain barriers; new safe readers must be reviewed before joining this set.
// Search/diff projections may omit source content without a full-content digest.
const STABLE_READS = new Set(['read_project_file','list_project_files','get_project']);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}
function incomplete(value:unknown):boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(incomplete);
  return Object.entries(value).some(([key,item]) =>
    (['truncated','contextTruncated','redacted'].includes(key) && item === true)
    || (key === 'nextOffset' && item !== null && item !== undefined)
    || (key === 'nextLineOffset' && item !== null && item !== undefined && item !== 0)
    || key === 'preview' || incomplete(item));
}
function fingerprint(step:RunStep):string|undefined {
  if (step.status!=='completed' || step.effect!=='read' || !STABLE_READS.has(step.tool_name!)) return;
  try {
    const result:unknown=JSON.parse(step.result_json!);
    // The ledger stores successful built-in output as JSON; failures are text.
    if (!result || typeof result!=='object' || ('ok' in result && result.ok===false) || incomplete(result)) return;
    return createHash('sha256').update(canonical([step.tool_name,JSON.parse(step.input_json!),result])).digest('hex');
  } catch { return; }
}

/** Three identical rounds (AAA or ABABAB), reconstructed from durable ordinal
 * order. Never infer progress from model prose or unconfirmed tool output. */
export function hasNoProgress(steps:RunStep[]):boolean {
  // One model batch is one observation round, even with repeated parallel reads.
  const rounds:Array<Array<string|undefined>>=[];
  for (const step of steps) {
    if (step.kind==='model') rounds.push([]);
    else if (rounds.length) rounds[rounds.length-1]!.push(fingerprint(step));
  }
  const recent=rounds.slice(-6).map(round=>round.length && round.every(hash=>hash!==undefined) ? JSON.stringify(round) : undefined);
  for (const period of [1,2]) {
    const tail=recent.slice(-period*3);
    if (tail.length===period*3 && tail.every((hash,i)=>hash!==undefined && hash===tail[i%period])) return true;
  }
  return false;
}
