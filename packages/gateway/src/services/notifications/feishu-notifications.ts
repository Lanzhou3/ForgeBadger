import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { FeishuNotificationTargets } from './feishu-notification-targets.js';
import { FeishuNotificationError } from './feishu-notification-error.js';
export { FeishuNotificationError } from './feishu-notification-error.js';
import { FeishuNotificationRepository, type FeishuNotificationConfig, type FeishuNotificationDelivery, type FeishuNotificationType } from '../../db/repositories/feishu-notification-repository.js';
import type { Notification } from '../../db/repositories/notification-repository.js';

const types=z.enum(['attention','failure','completion','lifecycle','app_action','automation']);
const configSchema=z.object({enabled:z.boolean(),targetId:z.string().min(1).max(160).nullable().optional(),identityId:z.string().min(1).max(128).nullable().optional(),types:z.array(types).max(6),
  webBaseUrl:z.string().trim().max(2048).transform(value=>{
    if(!value)return '';
    let url:URL;
    try{url=new URL(value);}catch{throw new FeishuNotificationError('WEB_URL_INVALID');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||value.includes('\\'))throw new FeishuNotificationError('WEB_URL_INVALID');
    return url.toString().replace(/\/+$/,'');
  }),revision:z.number().int().min(0)}).strict();
export class FeishuNotifications {
  readonly records:FeishuNotificationRepository;
  readonly targets:FeishuNotificationTargets;
  constructor(private readonly db:Database,private readonly userId:string) {
    this.records=new FeishuNotificationRepository(db,userId);this.targets=new FeishuNotificationTargets(db,userId);
  }
  authority(config=this.records.config()) {
    return this.targets.authority(config.targetId);
  }
  state() {
    const config=this.records.config();
    let blocker:string|null=null;
    try{this.authority(config);}catch(error){blocker=error instanceof FeishuNotificationError?error.code:'CONFIG_INVALID';}
    return {config,ready:blocker===null,blocker,targets:this.targets.list()};
  }
  update(input:unknown) {
    const parsed=configSchema.parse(input);
    const targetId=parsed.targetId===undefined?(parsed.identityId?`private:${parsed.identityId}`:null):parsed.targetId;
    if(parsed.identityId&&targetId!==`private:${parsed.identityId}`)throw new FeishuNotificationError('TARGET_CONFLICT');
    const next={...parsed,targetId,identityId:targetId?.startsWith('private:')?targetId.slice(8):null,types:[...new Set(parsed.types)].sort()};
    return this.db.transaction(()=>{
      const previous=this.records.config();
      if(previous.revision!==next.revision)throw new FeishuNotificationError('CONFIG_CONFLICT');
      if(next.enabled){if(!next.types.length)throw new FeishuNotificationError('TYPES_REQUIRED');this.authority(next);}
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
      this.records.enqueue({notificationId:notification.id,eventType,subscriptionRevision:config.revision,identityRevision:target.kind==='private'?target.revision:0,targetId:target.id,targetRevision:target.revision,
        ttlMs:eventType==='attention'?10*60_000:24*60*60_000});
    }catch(error){if(!(error instanceof FeishuNotificationError))throw error;}
  }
  test(input:unknown) {
    const {requestId}=z.object({requestId:z.string().uuid()}).strict().parse(input);
    return this.db.transaction(()=>{
      const config=this.records.config();
      if(!config.enabled)throw new FeishuNotificationError('SUBSCRIPTION_DISABLED');
      const target=this.authority(config);
      const existing=this.records.getTest(requestId);
      if(existing)return existing;
      if(this.records.pendingCount()>=100)throw new FeishuNotificationError('QUEUE_FULL');
      return this.records.enqueue({testKey:requestId,eventType:'test',subscriptionRevision:config.revision,identityRevision:target.kind==='private'?target.revision:0,targetId:target.id,targetRevision:target.revision,ttlMs:10*60_000});
    }).immediate();
  }
  assertDelivery(item:FeishuNotificationDelivery) {
    const config=this.records.config();
    if(!config.enabled || config.revision!==item.subscription_revision)throw new FeishuNotificationError('SUBSCRIPTION_CHANGED');
    if(item.expires_at<=Date.now())throw new FeishuNotificationError('EXPIRED');
    const target=this.authority(config);
    if(target.id!==item.target_id||target.revision!==item.target_revision)throw new FeishuNotificationError('TARGET_CHANGED');
    return {target,config};
  }
}

export function notificationType(notification:Notification):FeishuNotificationType|undefined {
  let payload:Record<string,unknown>={};
  try{payload=JSON.parse(notification.payload??'{}') as Record<string,unknown>;}catch{return;}
  if(!payload || typeof payload!=='object')return;
  if(notification.type==='copilot_automation')return 'automation';
  if(notification.type==='app_action_notification')return 'app_action';
  if(notification.type!=='claude_notification')return;
  switch(payload.notification_type) {
    case 'attention':case 'permission_prompt':return 'attention';
    case 'task_failed':case 'permission_denied':return 'failure';
    case 'task_completed':return 'completion';
    case 'task_interrupted':case 'session_ended':return 'lifecycle';
    default:return;
  }
}
