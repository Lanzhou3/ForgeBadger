import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';

export type NotificationEventType = 'attention'|'failure'|'completion'|'lifecycle'|'app_action'|'automation';
export interface NotificationDelivery {
  id:string;notification_id:string|null;test_key:string|null;event_type:NotificationEventType|'test';
  subscription_revision:number;identity_revision:number;
  target_id:string|null;target_revision:number;
  status:'pending'|'sending'|'delivered'|'failed'|'unknown'|'cancelled';error_code:string|null;
  claim_token:string|null;lease_until:number|null;attempt_count:number;next_attempt_at:number;expires_at:number;created_at:number;
}
export interface EnqueueNotificationDelivery {
  notificationId?:string;testKey?:string;eventType:NotificationDelivery['event_type'];subscriptionRevision:number;identityRevision:number;
  targetId:string;targetRevision:number;ttlMs:number;
}
// Table names are picked from this closed literal set, never from request input.
export type NotificationDeliveryTable = 'feishu_notification_deliveries'|'telegram_notification_deliveries';

/** Leased outbound notification queue shared by every push channel; all statements are tenant scoped. */
export class NotificationDeliveryRepository {
  constructor(protected readonly db:Database,protected readonly userId:string,private readonly table:NotificationDeliveryTable) {}
  enqueue(input:EnqueueNotificationDelivery):NotificationDelivery {
    const id=randomUUID(),now=Date.now();
    this.db.prepare(`INSERT INTO ${this.table}(id,user_id,notification_id,test_key,event_type,subscription_revision,identity_revision,expires_at,created_at,target_id,target_revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`).run(id,this.userId,input.notificationId??null,input.testKey??null,input.eventType,input.subscriptionRevision,input.identityRevision,now+input.ttlMs,now,input.targetId,input.targetRevision);
    return this.db.prepare(`SELECT * FROM ${this.table} WHERE user_id=? AND (notification_id=? OR test_key=?)`)
      .get(this.userId,input.notificationId??null,input.testKey??null) as NotificationDelivery;
  }
  get(id:string):NotificationDelivery|undefined {
    return this.db.prepare(`SELECT * FROM ${this.table} WHERE user_id=? AND id=?`).get(this.userId,id) as NotificationDelivery|undefined;
  }
  getTest(testKey:string):NotificationDelivery|undefined {
    return this.db.prepare(`SELECT * FROM ${this.table} WHERE user_id=? AND test_key=?`).get(this.userId,testKey) as NotificationDelivery|undefined;
  }
  list():NotificationDelivery[] {
    return this.db.prepare(`SELECT * FROM ${this.table} WHERE user_id=? ORDER BY rowid DESC LIMIT 30`).all(this.userId) as NotificationDelivery[];
  }
  pendingCount():number {
    return (this.db.prepare(`SELECT count(*) n FROM ${this.table} WHERE user_id=? AND status IN ('pending','sending')`).get(this.userId) as {n:number}).n;
  }
  /** Settings changes never redirect queued work to a new destination. */
  cancelPending(errorCode:string):void {
    this.db.prepare(`UPDATE ${this.table} SET status='cancelled',error_code=? WHERE user_id=? AND status='pending'`).run(errorCode,this.userId);
  }
  claim():NotificationDelivery|undefined {
    return this.db.transaction(()=>{
      const now=Date.now();
      this.db.prepare(`UPDATE ${this.table} SET status='unknown',error_code='CLAIM_EXPIRED',claim_token=NULL,lease_until=NULL WHERE user_id=? AND status='sending' AND lease_until<=?`).run(this.userId,now);
      this.db.prepare(`UPDATE ${this.table} SET status='cancelled',error_code='EXPIRED' WHERE user_id=? AND status='pending' AND expires_at<=?`).run(this.userId,now);
      const next=this.db.prepare(`SELECT id FROM ${this.table} WHERE user_id=? AND status='pending' AND next_attempt_at<=? ORDER BY rowid LIMIT 1`).get(this.userId,now) as {id:string}|undefined;
      if(!next)return;
      this.db.prepare(`UPDATE ${this.table} SET status='sending',claim_token=?,lease_until=?,attempt_count=attempt_count+1 WHERE user_id=? AND id=? AND status='pending'`)
        .run(randomUUID(),now+30_000,this.userId,next.id);
      return this.get(next.id);
    }).immediate();
  }
  owns(item:NotificationDelivery):boolean {
    const saved=this.get(item.id);
    return saved?.status==='sending' && saved.claim_token===item.claim_token && (saved.lease_until??0)>Date.now();
  }
  finish(item:NotificationDelivery,status:NotificationDelivery['status'],errorCode?:string,messageId?:string):void {
    this.db.prepare(`UPDATE ${this.table} SET status=?,error_code=?,provider_message_id=?,claim_token=NULL,lease_until=NULL WHERE user_id=? AND id=? AND status='sending' AND claim_token=? AND lease_until>?`)
      .run(status,errorCode??null,messageId??null,this.userId,item.id,item.claim_token,Date.now());
  }
  retry(item:NotificationDelivery,delayMs:number):void {
    if(item.attempt_count>=5){this.finish(item,'failed','RETRY_EXHAUSTED');return;}
    this.db.prepare(`UPDATE ${this.table} SET status='pending',error_code='RETRY_SCHEDULED',next_attempt_at=?,claim_token=NULL,lease_until=NULL WHERE user_id=? AND id=? AND status='sending' AND claim_token=? AND lease_until>?`)
      .run(Date.now()+Math.max(1000,delayMs),this.userId,item.id,item.claim_token,Date.now());
  }
}
