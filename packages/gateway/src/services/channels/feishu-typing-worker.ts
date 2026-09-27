import type { Database } from '../../db/types.js';
import { decryptSecret, type EncryptedSecret } from '../../crypto/secret-box.js';
import { FeishuChannelRepository } from '../../db/repositories/feishu-channel-repository.js';
import { FeishuTypingRepository, type TypingJob } from '../../db/repositories/feishu-typing-repository.js';
import { ChannelMessageRepository } from '../../db/repositories/channel-message-repository.js';
import { ChannelIdentityService, type TrustedChannelPeer } from './channel-identity-service.js';
import { FeishuReactions, FeishuReactionError, type FeishuReactionIO } from '../integrations/feishu-reactions.js';

/** Best-effort processing feedback. Durable compensation is independent of text delivery. */
export class FeishuTypingWorker {
  private readonly records: FeishuTypingRepository;
  private readonly accounts: FeishuChannelRepository;
  constructor(private readonly db: Database, private readonly userId: string,
    private readonly key: string, private readonly io: FeishuReactionIO = {}) {
    this.records = new FeishuTypingRepository(db, userId);
    this.accounts = new FeishuChannelRepository(db, userId, key);
  }

  async runOnce(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    this.records.project();
    const job = this.records.claim();
    if (!job) return;
    try {
      if (job.state === 'pending') {
        if (Date.now() - job.created_at > 120_000 || !this.processing(job)) {
          this.records.release(job, 'done'); return;
        }
        this.records.adding(job); job.state = 'adding';
        const reactionId = await this.api(job, signal, true).add();
        this.records.saveReceipt(job, reactionId);
      }
      if (job.state === 'active' && this.processing(job)) {
        this.records.release(job, 'active'); return;
      }
      const api = this.api(job, signal, false);
      // Uncertain creates are never repeated, even after a process restart.
      const ids = job.state === 'active' && job.reaction_id ? [job.reaction_id]
        : (await api.listOwn()).filter(id => !job.reaction_id || id === job.reaction_id);
      if (!ids.length && !job.reaction_id && Date.now() < job.reconcile_until) {
        // A timed-out POST may become visible after the first empty list response.
        this.records.release(job, 'uncertain', 30_000); return;
      }
      for (const id of ids) await api.remove(id);
      this.records.release(job, 'done');
    } catch (error) {
      const delay = error instanceof FeishuReactionError ? error.retryAfterMs : 30_000;
      // A DELETE can succeed even when its response is lost. Query before retrying it.
      this.records.release(job, job.state === 'adding' || job.state === 'active' ? 'uncertain' : job.state,
        Math.max(delay, Math.min(300_000, 30_000 * 2 ** Math.min(job.attempt_count, 4))), true);
    }
  }

  private processing(job: TypingJob): boolean {
    if (this.records.ended(job)) return false;
    try { this.authorizeProcessing(job); return true; } catch { return false; }
  }

  private authorizeProcessing(job: TypingJob): void {
    const message = new ChannelMessageRepository(this.db, this.userId).get(job.inbox_id);
    if (!message) throw new Error('FEISHU_TYPING_INBOX_MISSING');
    const payload = JSON.parse(decryptSecret(JSON.parse(message.payload_encrypted) as EncryptedSecret, { key: this.key })) as { peer: TrustedChannelPeer };
    if (payload.peer.channel !== 'feishu' || payload.peer.accountId !== job.account_id) throw new Error('FEISHU_TYPING_PEER_MISMATCH');
    new ChannelIdentityService(this.db, this.userId).admit(message.route_id, payload.peer);
  }

  private api(job: TypingJob, signal: AbortSignal, adding: boolean): FeishuReactions {
    return new FeishuReactions({ messageId: job.message_id, appId: job.app_id, signal,
      credentials: () => this.accounts.decryptAccountCredentials(job.account_id),
      authorize: () => {
        if (!this.records.owns(job) || !this.records.actorActive() || this.accounts.getAccount(job.account_id)?.appId !== job.app_id)
          throw new Error('FEISHU_TYPING_AUTHORITY_REJECTED');
        // Deleting our own recorded Typing is compensation, allowed after revocation/emergency stop.
        if (adding) {
          if (Date.now() - job.created_at > 120_000 || this.records.ended(job)) throw new Error('FEISHU_TYPING_FINISHED');
          this.authorizeProcessing(job);
        }
      }
    }, this.io);
  }
}
