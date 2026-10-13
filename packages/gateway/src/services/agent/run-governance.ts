import { CopilotTokenRates, modelCostNanoUsd, reportedTokens } from './model-metering.js';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';
import type { AgentLlmClient } from './orchestrator-types.js';
import type { LlmUsage } from './llm-response.js';
import { AgentError } from './types.js';
import { runDuration } from './approval-clock.js';
import { traceRunEvent } from './run-trace.js';
import { CopilotGoalStore, goalBudgetExhausted, type GoalRow } from './goal-store.js';

export type RunPhase = 'queued' | 'context' | 'summarizing' | 'model' | 'tool' | 'awaiting_approval' | 'finished';
export interface RunUsage { chargedTokens: number; reportedTokens: number; estimatedCalls: number; calls: number; costUsd: number | null; knownCostUsd: number; unpricedCalls: number }

// Migration-tolerant column probe: the goal column arrives in migration 0137,
// and durable evidence tests run the current code against pre-0137 schemas.
const goalColumnCache = new WeakMap<Database, boolean>();
function hasGoalColumn(db: Database): boolean {
  const cached = goalColumnCache.get(db);
  if (cached !== undefined) return cached;
  const has = (db.prepare("PRAGMA table_info(copilot_runs)").all() as { name: string }[]).some(column => column.name === 'goal_id');
  goalColumnCache.set(db, has);
  return has;
}

/** Conservative reservations survive crashes; missing usage is never counted as zero. */
export class RunGovernance {
  constructor(private db: Database, private userId: string, private runId: string) {}

  usage(): RunUsage {
    const rows = this.calls();
    const unpricedCalls=rows.filter(row=>row.cost_nanousd===null).length;
    const known=rows.reduce((sum,row)=>sum+BigInt(row.cost_nanousd??0),0n);
    const knownCostUsd=Number(known)/1_000_000_000;
    return {
      chargedTokens:rows.reduce((sum,row)=>sum+row.charged_tokens,0),
      reportedTokens:rows.reduce((sum,row)=>sum+(row.usage_json?row.charged_tokens:0),0),
      estimatedCalls:rows.filter(row=>!row.usage_json).length,calls:rows.length,
      costUsd:unpricedCalls?null:knownCostUsd,knownCostUsd,unpricedCalls,
    };
  }

  calls() {
    return this.db.prepare('SELECT id,run_id,kind,status,charged_tokens,usage_json,model_json,pricing_json,cost_nanousd,created_at,completed_at FROM copilot_model_calls WHERE user_id=? AND (run_id=? OR run_id IN (SELECT child_run_id FROM copilot_research_jobs WHERE user_id=? AND origin_run_id=?)) ORDER BY created_at,id')
      .all(this.userId,this.runId,this.userId,this.runId) as Array<{id:string;run_id:string;kind:string;status:string;charged_tokens:number;usage_json:string|null;model_json:string|null;pricing_json:string|null;cost_nanousd:number|null;created_at:number;completed_at:number|null}>;
  }

  remainingDurationMs(now = Date.now()): number {
    return runDuration(this.db, this.userId, this.runId, now).remainingMs;
  }

  check(additionalTokens = 0, includeParent = true, includeTime = true): void {
    const run = this.db.prepare('SELECT token_budget FROM copilot_runs WHERE user_id=? AND id=?')
      .get(this.userId, this.runId) as { token_budget: number } | undefined;
    if (!run) throw new AgentError('COPILOT_NOT_FOUND', 'Run not found');
    // Goal-level ceilings gate every model step of a goal run; per-run budgets
    // below are unchanged. Databases mid-migration (pre-goal column) and
    // dangling goal references keep per-run behavior.
    if (hasGoalColumn(this.db)) this.checkGoalBudget(this.runId);
    if (includeTime && this.remainingDurationMs() <= 0)
      throw new AgentError('COPILOT_TIME_BUDGET', 'Run elapsed-time budget exhausted');
    const parent = includeParent ? this.db.prepare('SELECT origin_run_id FROM copilot_research_jobs WHERE user_id=? AND child_run_id=?').get(this.userId, this.runId) as { origin_run_id: string } | undefined : undefined;
    if (parent) {
      const row = this.db.prepare('SELECT input_json FROM copilot_runs WHERE user_id=? AND id=?').get(this.userId, this.runId) as { input_json: string };
      new RunGovernance(this.db, this.userId, parent.origin_run_id).check(additionalTokens, false, JSON.parse(row.input_json).executionMode === 'research');
    }
    if (this.usage().chargedTokens + additionalTokens > run.token_budget)
      throw new AgentError('COPILOT_TOKEN_BUDGET', 'Run token budget exhausted');
  }

  phase(phase: RunPhase): void {
    this.db.prepare('UPDATE copilot_runs SET execution_phase=?,phase_started_at=?,revision=revision+1 WHERE user_id=? AND id=? AND status=\'running\'')
      .run(phase, Date.now(), this.userId, this.runId);
  }

  /** Aggregates the whole goal chain (all its runs) against the triple ceiling. */
  private checkGoalBudget(runId: string, now = Date.now()): void {
    const goalId = (this.db.prepare('SELECT goal_id FROM copilot_runs WHERE user_id=? AND id=?')
      .get(this.userId, runId) as { goal_id: string | null } | undefined)?.goal_id;
    if (!goalId) return;
    const goal = this.db.prepare('SELECT * FROM copilot_goals WHERE user_id=? AND id=?')
      .get(this.userId, goalId) as GoalRow | undefined;
    if (!goal) return;
    const usage = new CopilotGoalStore(this.db, this.userId).usage(goalId, now);
    if (goalBudgetExhausted(goal, usage, now))
      throw new AgentError('COPILOT_GOAL_BUDGET_EXHAUSTED', 'Goal-level budget exhausted (tokens, duration, or run count)');
  }

  async measure<T>(kind: string, input: unknown, invoke: () => Promise<T>, resultUsage?: (result: T) => LlmUsage | undefined, model?: {modelProfileId:string;modelId:string;apiFormat:string}): Promise<T> {
    const id = randomUUID();
    const rates = model ? new CopilotTokenRates(this.db,this.userId).get(model.modelProfileId) : null;
    // UTF-8 bytes are a conservative estimate, plus output reserve (not a price quote).
    const reservation = Buffer.byteLength(JSON.stringify(input), 'utf8') + 16_384;
    this.db.transaction(() => {
      this.check(reservation);
      this.db.prepare('INSERT INTO copilot_model_calls(id,user_id,run_id,kind,charged_tokens,created_at,model_json,pricing_json) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, this.userId, this.runId, kind, reservation, Date.now(),model?JSON.stringify(model):null,rates?JSON.stringify(rates):null);
    }).immediate();
    try {
      const result = await invoke();
      const usage = resultUsage?.(result);
      const tokens = reportedTokens(usage);
      if (this.db.open) this.db.transaction(() => {
        this.db.prepare("UPDATE copilot_model_calls SET status='completed',charged_tokens=?,usage_json=?,cost_nanousd=?,completed_at=? WHERE user_id=? AND run_id=? AND id=?")
          .run(tokens ?? reservation + Buffer.byteLength(JSON.stringify(result) ?? '', 'utf8'), tokens === undefined ? null : JSON.stringify(usage), modelCostNanoUsd(usage,rates), Date.now(), this.userId, this.runId, id);
        const fence = (this.db.prepare('SELECT fence FROM copilot_runs WHERE user_id=? AND id=?').get(this.userId, this.runId) as { fence: number } | undefined)?.fence ?? 0;
        traceRunEvent(this.db, this.userId, this.runId, fence, 'llm_call_completed', { kind, chargedTokens: tokens ?? null, reported: tokens !== undefined });
      }).immediate();
      return result;
    } catch (error) {
      if (this.db.open) this.db.prepare('UPDATE copilot_model_calls SET status=\'unknown\',completed_at=? WHERE user_id=? AND run_id=? AND id=?')
        .run(Date.now(), this.userId, this.runId, id);
      throw error;
    }
  }
}

/** Includes auxiliary calls; estimates are explicitly distinguished from provider usage. */
export function meteredLlm(llm: AgentLlmClient, meter: RunGovernance, onPhase: (phase: RunPhase) => void): AgentLlmClient {
  const model=(modelId?:string)=>llm.modelInfo?.(modelId);
  return {
    ...(llm.modelInfo ? {modelInfo:llm.modelInfo} : {}),
    ...(llm.contextBudget ? { contextBudget: (modelId?: string) => llm.contextBudget!(modelId) } : {}),
    stream: input => { onPhase('model'); return meter.measure('model', { messages: input.messages, tools: input.tools,system:input.system }, () => llm.stream(input), result => result.usage,model(input.modelId)); },
    summarize: input => { onPhase('summarizing'); let usage:LlmUsage|undefined; return meter.measure('summary',input.messages,()=>llm.summarize({...input,onUsage:value=>{usage=value;input.onUsage?.(value);}}),()=>usage,model(input.modelId)); },
    generateTitle: input => { let usage:LlmUsage|undefined; return meter.measure('title',input,()=>llm.generateTitle({...input,onUsage:value=>{usage=value;input.onUsage?.(value);}}),()=>usage,model(input.modelId)); },
    proposeMemory: input => { let usage:LlmUsage|undefined; return meter.measure('memory',input,()=>llm.proposeMemory({...input,onUsage:value=>{usage=value;input.onUsage?.(value);}}),()=>usage,model(input.modelId)); },
  };
}
