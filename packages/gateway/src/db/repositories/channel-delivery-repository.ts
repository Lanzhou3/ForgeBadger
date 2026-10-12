import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
export interface ChannelDelivery {
  id: string; inbox_id: string; phase: string; payload_encrypted: string;
  status: 'pending'|'sending'|'delivered'|'failed'|'unknown'|'cancelled';
  next_part: number; attempt_count: number; next_attempt_at: number;
  claim_token: string|null; lease_until: number|null;
  created_at: number; provider_message_id: string|null;
}
/** Native-only ledger: no historical Feishu outbox is consulted. */
export class ChannelDeliveryRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}
  listMetadata(): {id:string;inboxId:string;accountId:string;channel:string;phase:string;status:string;createdAt:number;receiptRecorded:boolean}[] {
    const rows=this.db.prepare('SELECT d.id,d.inbox_id AS inboxId,m.account_id AS accountId,i.channel,d.phase,d.status,d.created_at AS createdAt,d.provider_message_id IS NOT NULL AS receiptRecorded FROM channel_deliveries d JOIN channel_messages m ON m.user_id=d.user_id AND m.id=d.inbox_id JOIN channel_routes r ON r.user_id=m.user_id AND r.id=m.route_id JOIN channel_identities i ON i.user_id=r.user_id AND i.id=r.identity_id WHERE d.user_id=? ORDER BY d.rowid DESC LIMIT 100').all(this.userId) as {id:string;inboxId:string;accountId:string;channel:string;phase:string;status:string;createdAt:number;receiptRecorded:number}[];
    return rows.map(row=>({...row,receiptRecorded:Boolean(row.receiptRecorded)}));
  }
  get(id: string): ChannelDelivery|undefined {
    return this.db.prepare('SELECT * FROM channel_deliveries WHERE user_id=? AND id=?').get(this.userId,id) as ChannelDelivery|undefined;
  }
  candidates(): {id:string}[] {
    return this.db.prepare(`SELECT m.id FROM channel_messages m JOIN copilot_runs r ON r.user_id=m.user_id AND r.id=m.run_id
      WHERE m.user_id=? AND m.status='adopted' AND (
        (r.status IN ('completed','failed','cancelled','stopped','indeterminate') AND NOT EXISTS
          (SELECT 1 FROM channel_deliveries d WHERE d.user_id=m.user_id AND d.inbox_id=m.id AND d.phase='terminal'))
        OR (r.status='awaiting_approval' AND EXISTS (SELECT 1 FROM copilot_pending_actions p
          WHERE p.user_id=r.user_id AND p.run_id=r.id AND p.status='pending' AND NOT EXISTS
            (SELECT 1 FROM channel_deliveries d WHERE d.user_id=m.user_id AND d.inbox_id=m.id AND d.phase=
              (CASE WHEN EXISTS (SELECT 1 FROM feishu_channel_accounts a WHERE a.user_id=m.user_id AND a.id=m.account_id)
                THEN 'approval-card-v1:' ELSE 'approval:' END)||p.id)
          AND NOT EXISTS (SELECT 1 FROM channel_deliveries old WHERE old.user_id=m.user_id AND old.inbox_id=m.id
            AND old.phase='approval:'||p.id AND old.status IN ('unknown','sending'))))
      ) ORDER BY m.rowid LIMIT 20`).all(this.userId) as {id:string}[];
  }
  enqueue(inboxId:string,phase:string,encrypted:string):void {
    this.db.prepare("INSERT INTO channel_deliveries(id,user_id,inbox_id,phase,payload_encrypted,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,inbox_id,phase) DO NOTHING")
      .run(randomUUID(),this.userId,inboxId,phase,encrypted,Date.now());
  }
  claim(now=Date.now()):ChannelDelivery|undefined {
    return this.db.transaction(()=>{
      this.db.prepare("UPDATE channel_deliveries SET status='unknown',claim_token=NULL,lease_until=NULL WHERE user_id=? AND status='sending' AND lease_until<=?").run(this.userId,now);
      const row=this.db.prepare("SELECT id FROM channel_deliveries WHERE user_id=? AND status='pending' AND next_attempt_at<=? ORDER BY rowid LIMIT 1").get(this.userId,now) as {id:string}|undefined;
      if(!row)return undefined;
      this.db.prepare("UPDATE channel_deliveries SET status='sending',claim_token=?,lease_until=?,attempt_count=attempt_count+1 WHERE user_id=? AND id=? AND status='pending'").run(randomUUID(),now+30_000,this.userId,row.id);
      return this.get(row.id);
    }).immediate();
  }
  checkpoint(item: ChannelDelivery, nextPart: number, messageId: string): void {
    const saved = this.db.prepare("UPDATE channel_deliveries SET next_part=?,provider_message_id=? WHERE user_id=? AND id=? AND status='sending' AND claim_token=? AND lease_until>? AND next_part=?")
      .run(nextPart,messageId,this.userId,item.id,item.claim_token,Date.now(),nextPart-1);
    if (saved.changes !== 1) throw new Error('CHANNEL_CHECKPOINT_FAILED');
  }
  retry(item: ChannelDelivery, delayMs: number): void {
    const exhausted = item.attempt_count >= 5;
    this.db.prepare("UPDATE channel_deliveries SET status=?,next_attempt_at=?,claim_token=NULL,lease_until=NULL WHERE user_id=? AND id=? AND status='sending' AND claim_token=? AND lease_until>?")
      .run(exhausted ? 'failed' : 'pending',Date.now()+Math.max(1000,delayMs),this.userId,item.id,item.claim_token,Date.now());
  }
  /** A confirmed batch is progress, not a failed attempt. Only resume after a persisted checkpoint. */
  continue(item: ChannelDelivery): void {
    this.db.prepare("UPDATE channel_deliveries SET status='pending',attempt_count=0,next_attempt_at=0,claim_token=NULL,lease_until=NULL WHERE user_id=? AND id=? AND status='sending' AND claim_token=? AND lease_until>? AND next_part>?")
      .run(this.userId,item.id,item.claim_token,Date.now(),item.next_part);
  }
  owns(item:ChannelDelivery):boolean {
    const current=this.get(item.id);
    return current?.status==='sending' && current.claim_token===item.claim_token && (current.lease_until??0)>Date.now();
  }
  finish(item:ChannelDelivery,status:ChannelDelivery['status'],providerId?:string):void {
    this.db.prepare("UPDATE channel_deliveries SET status=?,provider_message_id=COALESCE(?,provider_message_id),claim_token=NULL,lease_until=NULL WHERE user_id=? AND id=? AND status='sending' AND claim_token=? AND lease_until>?")
      .run(status,providerId??null,this.userId,item.id,item.claim_token,Date.now());
  }
}
