/**
 * Advisory repeated-tool-call guard for the Copilot ReAct loop.
 *
 * DSH `repeat-tool-reminder` semantics, projected onto the durable ledger:
 * the consecutive-call chain is reconstructed from persisted tool steps, so
 * a run that resumes after approval or lease reclaim sees the same streak a
 * live process would. The chain key is the TOOL NAME alone (arguments may
 * differ — a model rewriting discover_tools queries is exactly the loop this
 * guard exists to break); rejected calls count, because hammering a denied
 * tool is the other loop worth breaking. A different tool name resets the
 * chain; a new user turn is a new run and therefore a new chain.
 *
 * DSH tiering, verbatim: a reminder is injected when the streak lands EXACTLY
 * on a configured threshold (default 3 / 5 / 8) — gentle at the first,
 * detailed after — and between or beyond thresholds nothing is injected. The
 * guard NEVER stops a run: observe-and-enrich, never veto. A run that keeps
 * repeating ends by its step budget or by the owner cancelling it; deciding
 * that for them would be the guard overreaching.
 */
import type { RunStep } from './run-ledger.js';

export const DEFAULT_REPEAT_THRESHOLDS = [3, 5, 8];

/** Preview bound for the canonical arguments quoted in the detailed reminder. */
export const REPEAT_ARGUMENTS_PREVIEW_CHARS = 500;

/** Deep key-sort so argument objects that differ only in property order canonicalize identically. */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = record[key];
    return sorted;
  }
  return value;
}

/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
function canonicalArguments(raw: string | null): string {
  if (!raw) return '';
  try {
    return JSON.stringify(sortJsonValue(JSON.parse(raw)));
  } catch {
    return raw;
  }
}

/** Head-truncated preview of the canonical arguments, marking the omission. */
function previewArguments(canonical: string, cap: number = REPEAT_ARGUMENTS_PREVIEW_CHARS): string {
  if (canonical.length <= cap) return canonical;
  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`;
}

/**
 * Consecutive trailing tool steps with `toolName`, skipping model steps (they
 * separate calls but do not reset the chain). Any completed-or-rejected tool
 * step participates; running/indeterminate steps break the chain because the
 * outcome is not yet durable evidence. The preview carries the LAST call's
 * canonical arguments for the detailed reminder.
 */
export function toolRepeatStreak(steps: RunStep[], toolName: string): number {
  let streak = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    if (step.kind !== 'tool') continue;
    if (step.tool_name !== toolName) return streak;
    if (step.status !== 'completed' && step.status !== 'indeterminate') return streak;
    streak += 1;
  }
  return streak;
}

/** The repeating tool at the tail of the step list, if any tool repeats at all. */
export function trailingRepeatTool(steps: RunStep[]): { toolName: string; streak: number; preview: string } | undefined {
  let toolName: string | undefined;
  let streak = 0;
  let preview = '';
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    if (step.kind !== 'tool') continue;
    if (step.status !== 'completed' && step.status !== 'indeterminate') break;
    if (toolName === undefined) {
      toolName = step.tool_name!;
      streak = 1;
      preview = previewArguments(canonicalArguments(step.input_json));
      continue;
    }
    if (step.tool_name !== toolName) break;
    streak += 1;
  }
  if (!toolName || streak < 2) return undefined;
  return { toolName, streak, preview };
}

export type RepeatStallDecision = 'none' | 'remind';

export interface RepeatStallInput {
  steps: RunStep[];
  /** Threshold streaks that trigger a reminder (default [3, 5, 8]). */
  thresholds?: number[];
}

/**
 * Remind only when the streak lands exactly on a configured threshold; the
 * first threshold is gentle, the rest detailed. Beyond the last threshold the
 * guard is silent — it advises, the budget and the owner end the run.
 */
export function repeatStallDecision(input: RepeatStallInput): { decision: RepeatStallDecision; tier?: 'gentle' | 'detailed'; toolName?: string; streak?: number; preview?: string } {
  const repeat = trailingRepeatTool(input.steps);
  if (!repeat) return { decision: 'none' };
  const thresholds = input.thresholds ?? DEFAULT_REPEAT_THRESHOLDS;
  if (!thresholds.includes(repeat.streak)) return { decision: 'none' };
  return repeat.streak === thresholds[0]
    ? { decision: 'remind', tier: 'gentle', toolName: repeat.toolName, streak: repeat.streak, preview: repeat.preview }
    : { decision: 'remind', tier: 'detailed', toolName: repeat.toolName, streak: repeat.streak, preview: repeat.preview };
}

/** The first-tier reminder: analyze before repeating. */
export function gentleRepeatReminder(toolName: string): string {
  return `You are repeating the same tool call (${toolName}). Carefully analyze the previous result before calling it again: if the task is not complete, take a different approach — a different tool or different arguments — instead of repeating the call.`;
}

/** The detailed tier: names the tool, the streak, and the repeated arguments. */
export function detailedRepeatReminder(toolName: string, streak: number, preview?: string): string {
  return `Repeated tool call detected: ${toolName} has now been called ${streak} times consecutively without making progress${preview ? ` with arguments: ${preview}` : ''}. Do not call it again in the same manner. Inspect the latest result and either choose a different tool or different arguments, or finish the task if enough evidence has been gathered.`;
}
