import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { CopilotRunLedger, inputDigest, type TurnInput } from './run-ledger.js';
import { AgentError } from './types.js';
import { redactAgentText } from './redaction.js';

export interface Followup { id: string; conversation_id: string; status: string; run_id: string | null; error: string | null; created_at: number; input_json: string }

/** Queued text is not part of the transcript until transactional promotion. */
export class CopilotFollowups {
  constructor(private db: Database, private userId: string) {}

  enqueue(input: TurnInput): Followup {
    return this.db.transaction(() => {
      const ledger = new CopilotRunLedger(this.db, this.userId);
      ledger.validateScope(input);
      if (input.source && input.source !== 'user') throw new AgentError('COPILOT_QUEUE_SOURCE', 'Only owner follow-ups can be queued');
      if (!input.clientRequestId || input.clientRequestId.length > 128 || input.skipUserMessage || input.editMessageId)
        throw new AgentError('COPILOT_REQUEST_KEY_INVALID', 'A follow-up request key is required');
      const digest = inputDigest(JSON.stringify(input));
      const previous = this.db.prepare('SELECT * FROM copilot_followups WHERE user_id=? AND conversation_id=? AND request_key=?')
        .get(this.userId, input.conversationId, input.clientRequestId) as (Followup & { request_digest: string }) | undefined;
      if (previous) {
        if (previous.request_digest !== digest) throw new AgentError('COPILOT_REQUEST_CONFLICT', 'Follow-up key was used for another request');
        return previous;
      }
      if ((this.db.prepare("SELECT count(*) AS count FROM copilot_followups WHERE user_id=? AND conversation_id=? AND status='queued'").get(this.userId, input.conversationId) as { count: number }).count >= 10)
        throw new AgentError('COPILOT_QUEUE_FULL', 'At most ten follow-ups can be queued');
      const id = randomUUID();
      this.db.prepare('INSERT INTO copilot_followups(id,user_id,conversation_id,request_key,request_digest,input_json,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, this.userId, input.conversationId, input.clientRequestId, digest,
          JSON.stringify({ ...input, userText: redactAgentText(input.userText) }), Date.now());
      return this.get(id)!;
    }).immediate();
  }

  get(id: string): Followup | undefined {
    return this.db.prepare('SELECT * FROM copilot_followups WHERE user_id=? AND id=?').get(this.userId, id) as Followup | undefined;
  }

  list(conversationId: string): Followup[] {
    return this.db.prepare("SELECT * FROM copilot_followups WHERE user_id=? AND conversation_id=? ORDER BY (status='queued') DESC,created_at DESC,id LIMIT 100")
      .all(this.userId, conversationId) as Followup[];
  }

  cancel(id: string): boolean {
    return this.db.prepare("UPDATE copilot_followups SET status='cancelled' WHERE user_id=? AND id=? AND status='queued'")
      .run(this.userId, id).changes > 0;
  }

  promote(): string[] {
    const rows = this.db.prepare("SELECT f.* FROM copilot_followups f WHERE f.user_id=? AND f.status='queued' AND NOT EXISTS (SELECT 1 FROM copilot_runs r WHERE r.user_id=f.user_id AND r.conversation_id=f.conversation_id AND r.status IN ('pending','running','awaiting_approval')) ORDER BY f.created_at,f.id LIMIT 100")
      .all(this.userId) as Followup[];
    const admitted: string[] = [];
    for (const row of rows) {
      const runId = this.db.transaction(() => {
        if (this.get(row.id)?.status !== 'queued') return;
        const ledger = new CopilotRunLedger(this.db, this.userId);
        try {
          const input = JSON.parse(row.input_json) as TurnInput;
          ledger.validateScope(input);
          if (ledger.log.listRuns(input.conversationId).some(run => ['pending', 'running', 'awaiting_approval'].includes(run.status))) return;
          const id = ledger.admit(input, 16);
          this.db.prepare("UPDATE copilot_followups SET status='started',run_id=? WHERE user_id=? AND id=? AND status='queued'")
            .run(id, this.userId, row.id);
          return id;
        } catch {
          this.db.prepare("UPDATE copilot_followups SET status='failed',error='Follow-up admission rejected' WHERE user_id=? AND id=?")
            .run(this.userId, row.id);
        }
      }).immediate();
      if (runId) admitted.push(runId);
    }
    return admitted;
  }
}
