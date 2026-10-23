import type { Database } from '../types.js';
import { NotificationDeliveryRepository, type NotificationDelivery, type NotificationEventType } from './notification-delivery-repository.js';

export type TelegramNotificationType = NotificationEventType;
export interface TelegramNotificationConfig {
  enabled:boolean;targetId:string|null;types:TelegramNotificationType[];webBaseUrl:string;revision:number;
}
export type TelegramNotificationDelivery = NotificationDelivery;
export class TelegramNotificationRepository extends NotificationDeliveryRepository {
  constructor(db:Database,userId:string) {super(db,userId,'telegram_notification_deliveries');}
  config():TelegramNotificationConfig {
    const row=this.db.prepare('SELECT enabled,target_id,types_json,web_base_url,revision FROM telegram_notification_settings WHERE user_id=?')
      .get(this.userId) as {enabled:number;target_id:string|null;types_json:string;web_base_url:string;revision:number}|undefined;
    return row?{enabled:row.enabled===1,targetId:row.target_id,types:JSON.parse(row.types_json) as TelegramNotificationType[],webBaseUrl:row.web_base_url,revision:row.revision}
      :{enabled:false,targetId:null,types:['attention','failure','completion'],webBaseUrl:'',revision:0};
  }
  save(config:TelegramNotificationConfig):TelegramNotificationConfig {
    this.db.prepare(`INSERT INTO telegram_notification_settings(user_id,enabled,target_id,types_json,web_base_url,revision,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,target_id=excluded.target_id,
      types_json=excluded.types_json,web_base_url=excluded.web_base_url,revision=excluded.revision,updated_at=excluded.updated_at`)
      .run(this.userId,Number(config.enabled),config.targetId,JSON.stringify(config.types),config.webBaseUrl,config.revision+1,Date.now());
    this.cancelPending('SUBSCRIPTION_CHANGED');
    return this.config();
  }
}
