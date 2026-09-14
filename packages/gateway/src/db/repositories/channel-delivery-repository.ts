import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
export interface ChannelDelivery {
  id: string; inbox_id: string; phase: string; payload_encrypted: string;
  status: 'pending'|'sending'|'delivered'|'failed'|'unknown'|'cancelled';
  claim_token: string|null; lease_until: number|null;
}
/** Native-only ledger: no historical Feishu outbox is consulted. */
export class ChannelDeliveryRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}
  listMetadata(): {id:string;inboxId:string;phase:string;status:string;createdAt:number;receiptRecorded:boolean}[] {
    const rows=this.db.prepare('SELECT id,inbox_id AS inboxId,phase,status,created_at AS createdAt,provider_message_id IS NOT NULL AS receiptRecorded FROM channel_deliveries WHERE user_id=? ORDER BY rowid DESC LIMIT 100').all(this.userId) as {id:string;inboxId:string;phase:string;status:string;createdAt:number;receiptRecorded:number}[];
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
            (SELECT 1 FROM channel_deliveries d WHERE d.user_id=m.user_id AND d.inbox_id=m.id AND d.phase='approval:'||p.id)))
      ) ORDER BY m.rowid LIMIT 20`).all(this.userId) as {id:string}[];
  }
  enqueue(inboxId:string,phase:string,encrypted:string):void {
    this.db.prepare("INSERT INTO channel_deliveries(id,user_id,inbox_id,phase,payload_encrypted,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,inbox_id,phase) DO NOTHING")
      .run(randomUUID(),this.userId,inboxId,phase,encrypted,Date.now());
  }
  claim(now=Date.now()):ChannelDelivery|undefined {
    return this.db.transaction(()=>{
      this.db.prepare("UPDATE channel_deliveries SET status='unknown',claim_token=NULL,lease_until=NULL WHERE user_id=? AND status='sending' AND lease_until<=?").run(this.userId,now);
      const row=this.db.prepare("SELECT id FROM channel_deliveries WHERE user_id=? AND status='pending' ORDER BY rowid LIMIT 1").get(this.userId) as {id:string}|undefined;
      if(!row)return undefined;
      this.db.prepare("UPDATE channel_deliveries SET status='sending',claim_token=?,lease_until=? WHERE user_id=? AND id=? AND status='pending'").run(randomUUID(),now+30_000,this.userId,row.id);
      return this.get(row.id);
    }).immediate();
  }
  owns(item:ChannelDelivery):boolean {
    const current=this.get(item.id);
    return current?.status==='sending' && current.claim_token===item.claim_token && (current.lease_until??0)>Date.now();
  }
  finish(item:ChannelDelivery,status:ChannelDelivery['status'],providerId?:string):void {
    this.db.prepare("UPDATE channel_deliveries SET status=?,provider_message_id=?,claim_token=NULL,lease_until=NULL WHERE user_id=? AND id=? AND status='sending' AND claim_token=? AND lease_until>?")
      .run(status,providerId??null,this.userId,item.id,item.claim_token,Date.now());
  }
}
