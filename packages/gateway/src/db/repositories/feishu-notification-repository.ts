import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';

export type FeishuNotificationType = 'attention'|'failure'|'completion'|'lifecycle'|'app_action'|'automation';
export interface FeishuNotificationConfig {
  contentLevel?:'status'|'summary';
  enabled:boolean;targetId:string|null;identityId:string|null;types:FeishuNotificationType[];webBaseUrl:string;revision:number;
}
export interface FeishuNotificationDelivery {
  id:string;notification_id:string|null;test_key:string|null;event_type:FeishuNotificationType|'test';
  subscription_revision:number;identity_revision:number;
  target_id:string|null;target_revision:number;
  status:'pending'|'sending'|'delivered'|'failed'|'unknown'|'cancelled';error_code:string|null;
  claim_token:string|null;lease_until:number|null;attempt_count:number;next_attempt_at:number;expires_at:number;created_at:number;
}
export class FeishuNotificationRepository {
  constructor(private readonly db:Database,private readonly userId:string) {}
  config():FeishuNotificationConfig {
    const row=this.db.prepare('SELECT enabled,target_id,identity_id,types_json,web_base_url,revision,content_level FROM feishu_notification_settings WHERE user_id=?')
      .get(this.userId) as {enabled:number;target_id:string|null;identity_id:string|null;types_json:string;web_base_url:string;revision:number;content_level:'status'|'summary'}|undefined;
    return row?{enabled:row.enabled===1,targetId:row.target_id,identityId:row.identity_id,types:JSON.parse(row.types_json) as FeishuNotificationType[],webBaseUrl:row.web_base_url,revision:row.revision,contentLevel:'summary'}
      :{enabled:false,targetId:null,identityId:null,types:['attention','failure','completion'],webBaseUrl:'',revision:0,contentLevel:'summary'};
  }
  save(config:FeishuNotificationConfig):FeishuNotificationConfig {
    this.db.prepare(`INSERT INTO feishu_notification_settings(user_id,enabled,identity_id,types_json,web_base_url,revision,updated_at,target_id,content_level)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,identity_id=excluded.identity_id,target_id=excluded.target_id,
      types_json=excluded.types_json,web_base_url=excluded.web_base_url,revision=excluded.revision,updated_at=excluded.updated_at,content_level=excluded.content_level`)
      .run(this.userId,Number(config.enabled),config.identityId,JSON.stringify(config.types),config.webBaseUrl,config.revision+1,Date.now(),config.targetId,'summary');
    this.db.prepare("UPDATE feishu_notification_deliveries SET status='cancelled',error_code='SUBSCRIPTION_CHANGED' WHERE user_id=? AND status='pending'").run(this.userId);
    return this.config();
  }
  enqueue(input:{notificationId?:string;testKey?:string;eventType:FeishuNotificationDelivery['event_type'];subscriptionRevision:number;identityRevision:number;targetId:string;targetRevision:number;ttlMs:number}):FeishuNotificationDelivery {
    const id=randomUUID(),now=Date.now();
    this.db.prepare(`INSERT INTO feishu_notification_deliveries(id,user_id,notification_id,test_key,event_type,subscription_revision,identity_revision,expires_at,created_at,target_id,target_revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`).run(id,this.userId,input.notificationId??null,input.testKey??null,input.eventType,input.subscriptionRevision,input.identityRevision,now+input.ttlMs,now,input.targetId,input.targetRevision);
    return this.db.prepare('SELECT * FROM feishu_notification_deliveries WHERE user_id=? AND (notification_id=? OR test_key=?)')
      .get(this.userId,input.notificationId??null,input.testKey??null) as FeishuNotificationDelivery;
  }
  get(id:string):FeishuNotificationDelivery|undefined {
    return this.db.prepare('SELECT * FROM feishu_notification_deliveries WHERE user_id=? AND id=?').get(this.userId,id) as FeishuNotificationDelivery|undefined;
  }
  getTest(testKey:string):FeishuNotificationDelivery|undefined {
    return this.db.prepare('SELECT * FROM feishu_notification_deliveries WHERE user_id=? AND test_key=?').get(this.userId,testKey) as FeishuNotificationDelivery|undefined;
  }
  list():FeishuNotificationDelivery[] {
    return this.db.prepare('SELECT * FROM feishu_notification_deliveries WHERE user_id=? ORDER BY rowid DESC LIMIT 30').all(this.userId) as FeishuNotificationDelivery[];
  }
  pendingCount():number {
    return (this.db.prepare("SELECT count(*) n FROM feishu_notification_deliveries WHERE user_id=? AND status IN ('pending','sending')").get(this.userId) as {n:number}).n;
  }
  claim():FeishuNotificationDelivery|undefined {
    return this.db.transaction(()=>{
      const now=Date.now();
      this.db.prepare("UPDATE feishu_notification_deliveries SET status='unknown',error_code='CLAIM_EXPIRED',claim_token=NULL,lease_until=NULL WHERE user_id=? AND status='sending' AND lease_until<=?").run(this.userId,now);
      this.db.prepare("UPDATE feishu_notification_deliveries SET status='cancelled',error_code='EXPIRED' WHERE user_id=? AND status='pending' AND expires_at<=?").run(this.userId,now);
      const next=this.db.prepare("SELECT id FROM feishu_notification_deliveries WHERE user_id=? AND status='pending' AND next_attempt_at<=? ORDER BY rowid LIMIT 1").get(this.userId,now) as {id:string}|undefined;
      if(!next)return;
      this.db.prepare("UPDATE feishu_notification_deliveries SET status='sending',claim_token=?,lease_until=?,attempt_count=attempt_count+1 WHERE user_id=? AND id=? AND status='pending'")
        .run(randomUUID(),now+30_000,this.userId,next.id);
      return this.get(next.id);
    }).immediate();
  }
  owns(item:FeishuNotificationDelivery):boolean {
    const saved=this.get(item.id);
    return saved?.status==='sending' && saved.claim_token===item.claim_token && (saved.lease_until??0)>Date.now();
  }
  finish(item:FeishuNotificationDelivery,status:FeishuNotificationDelivery['status'],errorCode?:string,messageId?:string):void {
    this.db.prepare('UPDATE feishu_notification_deliveries SET status=?,error_code=?,provider_message_id=?,claim_token=NULL,lease_until=NULL WHERE user_id=? AND id=? AND status=\'sending\' AND claim_token=? AND lease_until>?')
      .run(status,errorCode??null,messageId??null,this.userId,item.id,item.claim_token,Date.now());
  }
  retry(item:FeishuNotificationDelivery,delayMs:number):void {
    if(item.attempt_count>=5){this.finish(item,'failed','RETRY_EXHAUSTED');return;}
    this.db.prepare("UPDATE feishu_notification_deliveries SET status='pending',error_code='RETRY_SCHEDULED',next_attempt_at=?,claim_token=NULL,lease_until=NULL WHERE user_id=? AND id=? AND status='sending' AND claim_token=? AND lease_until>?")
      .run(Date.now()+Math.max(1000,delayMs),this.userId,item.id,item.claim_token,Date.now());
  }
}
