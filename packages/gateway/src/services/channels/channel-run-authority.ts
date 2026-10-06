import { ChannelMessageRepository } from '../../db/repositories/channel-message-repository.js';
import { CopilotRunLedger } from '../agent/run-ledger.js';
import type { Database } from '../../db/types.js';
import { ChannelIdentityRepository } from '../../db/repositories/channel-identity-repository.js';
import { ChannelIdentityService, ChannelIdentityError } from './channel-identity-service.js';
import { assertChannelRunScope } from './channel-run-scope.js';
import type { TurnInput } from '../agent/run-ledger.js';

/** Durable channel ownership survives missing route joins; callers cannot opt out through TurnInput. */
export function assertChannelConversationAuthority(db: Database, userId: string, conversationId: string): void {
  const records = new ChannelIdentityRepository(db,userId);
  const route = records.conversationRoute(conversationId);
  if (!route && !records.conversationIsChannelOwned(conversationId)) return;
  if (!route) throw new ChannelIdentityError();
  new ChannelIdentityService(db,userId).admitRoute(route.id, conversationId);
}

/** Legacy routes mixed private/group context. Fence unfinished legacy runs before
 * any recovery starts; preserve transcripts and queued, unadopted messages. */
export function recoverLegacyChannelRuns(db: Database, userId: string): void {
  const ledger = new CopilotRunLedger(db,userId);
  for (const runId of new ChannelMessageRepository(db,userId).legacyActiveRuns()) {
    ledger.cancel(runId,'channel_scope_migration');
  }
  const active = db.prepare("SELECT id,input_json FROM copilot_runs WHERE user_id=? AND runtime_version=1 AND status IN ('pending','running','awaiting_approval')")
    .all(userId) as { id: string; input_json: string }[];
  for (const run of active) {
    try { assertChannelRunScope(db, userId, JSON.parse(run.input_json) as TurnInput); }
    catch (error) {
      if (!(error instanceof ChannelIdentityError)) throw error;
      // Cancellation preserves running-write uncertainty and fences late
      // receipts. A missing snapshot never becomes a fresh admission.
      ledger.cancel(run.id, 'channel_scope_migration');
    }
  }
}
