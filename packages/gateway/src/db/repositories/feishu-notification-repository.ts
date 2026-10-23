import type { Database } from '../types.js';
import { NotificationDeliveryRepository, type NotificationDelivery, type NotificationEventType } from './notification-delivery-repository.js';

export type FeishuNotificationType = NotificationEventType;
export interface FeishuNotificationConfig {
  contentLevel?:'status'|'summary';
  enabled:boolean;targetId:string|null;identityId:string|null;types:FeishuNotificationType[];webBaseUrl:string;revision:number;
}
export type FeishuNotificationDelivery = NotificationDelivery;
export class FeishuNotificationRepository extends NotificationDeliveryRepository {
  constructor(db:Database,userId:string) {super(db,userId,'feishu_notification_deliveries');}
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
    this.cancelPending('SUBSCRIPTION_CHANGED');
    return this.config();
  }
}
