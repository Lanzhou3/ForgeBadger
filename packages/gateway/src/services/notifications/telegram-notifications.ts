import { z } from 'zod';
import type { Database } from '../../db/types.js';
import type { Notification } from '../../db/repositories/notification-repository.js';
import { TelegramNotificationRepository, type TelegramNotificationDelivery } from '../../db/repositories/telegram-notification-repository.js';
import { TelegramNotificationError, TelegramNotificationTargets } from './telegram-notification-targets.js';
import { notificationType } from './feishu-notifications.js';
import { renderNotificationContent } from './notification-content.js';
export { TelegramNotificationError } from './telegram-notification-targets.js';

const types=z.enum(['attention','failure','completion','lifecycle','app_action','automation']);
const configSchema=z.object({enabled:z.boolean(),targetId:z.string().min(1).max(160).nullable(),types:z.array(types).max(6),
  webBaseUrl:z.string().trim().max(2048).transform(value=>{
    if(!value)return '';
    let url:URL;
    try{url=new URL(value);}catch{throw new TelegramNotificationError('WEB_URL_INVALID');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||value.includes('\\'))throw new TelegramNotificationError('WEB_URL_INVALID');
    return url.toString().replace(/\/+$/,'');
  }),revision:z.number().int().min(0)}).strict();

/** Personal Telegram subscription; mirrors the Feishu notification authority model. */
export class TelegramNotifications {
  readonly records:TelegramNotificationRepository;
  readonly targets:TelegramNotificationTargets;
  constructor(private readonly db:Database,private readonly userId:string) {
    this.records=new TelegramNotificationRepository(db,userId);this.targets=new TelegramNotificationTargets(db,userId);
  }
  authority(config=this.records.config()) {
    return this.targets.authority(config.targetId);
  }
  state() {
    const config=this.records.config();
    let blocker:string|null=null;
    try{this.authority(config);}catch(error){blocker=error instanceof TelegramNotificationError?error.code:'CONFIG_INVALID';}
    return {config,ready:blocker===null,blocker,targets:this.targets.list()};
  }
  update(input:unknown) {
    const parsed=configSchema.parse(input);
    const next={...parsed,types:[...new Set(parsed.types)].sort()};
    return this.db.transaction(()=>{
      const previous=this.records.config();
      if(previous.revision!==next.revision)throw new TelegramNotificationError('CONFIG_CONFLICT');
      if(next.enabled){if(!next.types.length)throw new TelegramNotificationError('TYPES_REQUIRED');this.authority(next);}
      if(previous.enabled===next.enabled && previous.targetId===next.targetId && previous.webBaseUrl===next.webBaseUrl
        && [...previous.types].sort().join(',')===next.types.join(','))return this.state();
      this.records.save(next);return this.state();
    }).immediate();
  }
  enqueue(notification:Notification):void {
    const config=this.records.config();
    const eventType=notificationType(notification);
    if(!config.enabled || !eventType || !config.types.includes(eventType))return;
    try {
      const target=this.authority(config);
      this.records.enqueue({notificationId:notification.id,eventType,subscriptionRevision:config.revision,identityRevision:target.revision,targetId:target.id,targetRevision:target.revision,
        ttlMs:eventType==='attention'?10*60_000:24*60*60_000});
    }catch(error){if(!(error instanceof TelegramNotificationError))throw error;}
  }
  test(input:unknown) {
    const {requestId}=z.object({requestId:z.string().uuid()}).strict().parse(input);
    return this.db.transaction(()=>{
      const config=this.records.config();
      if(!config.enabled)throw new TelegramNotificationError('SUBSCRIPTION_DISABLED');
      const target=this.authority(config);
      const existing=this.records.getTest(requestId);
      if(existing)return existing;
      if(this.records.pendingCount()>=100)throw new TelegramNotificationError('QUEUE_FULL');
      return this.records.enqueue({testKey:requestId,eventType:'test',subscriptionRevision:config.revision,identityRevision:target.revision,targetId:target.id,targetRevision:target.revision,ttlMs:10*60_000});
    }).immediate();
  }
  assertDelivery(item:TelegramNotificationDelivery) {
    const config=this.records.config();
    if(!config.enabled || config.revision!==item.subscription_revision)throw new TelegramNotificationError('SUBSCRIPTION_CHANGED');
    if(item.expires_at<=Date.now())throw new TelegramNotificationError('EXPIRED');
    const target=this.authority(config);
    if(target.id!==item.target_id||target.revision!==item.target_revision)throw new TelegramNotificationError('TARGET_CHANGED');
    return {target,config};
  }
}

/** Plain text only (the sender never sets parse_mode), so user-controlled content cannot inject markup. */
export function renderTelegramNotificationText(item:TelegramNotificationDelivery,notification:Notification|undefined,webBaseUrl:string):string {
  const content=renderNotificationContent(item,notification,webBaseUrl,{testMessage:'Telegram 通知连接正常。启用后，新通知将发送到所选私聊。'});
  return [content.title,'',content.body,...(content.link?['',`${content.link.label}：${content.link.url}`]:[])].join('\n');
}
