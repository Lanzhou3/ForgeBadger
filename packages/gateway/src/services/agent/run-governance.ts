import type { Database } from '../../db/types.js';

export type RunPhase = 'queued' | 'context' | 'summarizing' | 'model' | 'tool' | 'awaiting_approval' | 'finished';

/**
 * Durable execution phase for one run. Execution budgets and model-call
 * metering are no longer tracked; runs end on completion, step limit,
 * failure, or an explicit user stop.
 */
export class RunGovernance {
  constructor(private db: Database, private userId: string, private runId: string) {}

  phase(phase: RunPhase): void {
    this.db.prepare('UPDATE copilot_runs SET execution_phase=?,phase_started_at=?,revision=revision+1 WHERE user_id=? AND id=? AND status=\'running\'')
      .run(phase, Date.now(), this.userId, this.runId);
  }
}
