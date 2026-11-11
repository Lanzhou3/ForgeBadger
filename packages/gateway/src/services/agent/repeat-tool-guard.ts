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
 * Two tiers: at `nameThreshold` a reminder is injected into the next model
 * step's prefix; at `hardThreshold` the run is stopped with
 * REPEAT_STALL_STOP_REASON. The hard budget (max_steps) stays the final
 * backstop; this guard must trip first.
 */
import type { RunStep } from './run-ledger.js';

export const REPEAT_STALL_STOP_REASON = 'COPILOT_TOOL_REPEAT_STALL';
export const DEFAULT_REPEAT_NAME_THRESHOLD = 3;
export const DEFAULT_REPEAT_HARD_THRESHOLD = 6;

/**
 * Consecutive trailing tool steps with `toolName`, skipping model steps (they
 * separate calls but do not reset the chain). Any completed-or-rejected tool
 * step participates; running/indeterminate steps break the chain because the
 * outcome is not yet durable evidence.
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
export function trailingRepeatTool(steps: RunStep[]): { toolName: string; streak: number } | undefined {
  let toolName: string | undefined;
  let streak = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    if (step.kind !== 'tool') continue;
    if (step.status !== 'completed' && step.status !== 'indeterminate') break;
    if (toolName === undefined) {
      toolName = step.tool_name!;
      streak = 1;
      continue;
    }
    if (step.tool_name !== toolName) break;
    streak += 1;
  }
  if (!toolName || streak < 2) return undefined;
  return { toolName, streak };
}

export type RepeatStallDecision = 'none' | 'remind' | 'stop';

export interface RepeatStallInput {
  steps: RunStep[];
  nameThreshold?: number;
  hardThreshold?: number;
}

/** Gentle at the first threshold, detailed after; stop at the hard threshold. */
export function repeatStallDecision(input: RepeatStallInput): { decision: RepeatStallDecision; toolName?: string; streak?: number } {
  const repeat = trailingRepeatTool(input.steps);
  if (!repeat) return { decision: 'none' };
  const nameThreshold = input.nameThreshold ?? DEFAULT_REPEAT_NAME_THRESHOLD;
  const hardThreshold = input.hardThreshold ?? DEFAULT_REPEAT_HARD_THRESHOLD;
  if (repeat.streak >= hardThreshold) return { decision: 'stop', toolName: repeat.toolName, streak: repeat.streak };
  if (repeat.streak >= nameThreshold) return { decision: 'remind', toolName: repeat.toolName, streak: repeat.streak };
  return { decision: 'none' };
}

/** The first-tier reminder: analyze before repeating. */
export function gentleRepeatReminder(toolName: string): string {
  return `You are repeating the same tool call (${toolName}). Carefully analyze the previous result before calling it again: if the task is not complete, take a different approach — a different tool or different arguments — instead of repeating the call.`;
}

/** The detailed tier: names the tool, the run length, and orders a different action. */
export function detailedRepeatReminder(toolName: string, streak: number): string {
  return `Repeated tool calls detected: ${toolName} has now been called ${streak} times consecutively without making progress. Do not call it again in the same manner. Inspect the latest result and either choose a different tool or different arguments, or finish the task if enough evidence has been gathered.`;
}
