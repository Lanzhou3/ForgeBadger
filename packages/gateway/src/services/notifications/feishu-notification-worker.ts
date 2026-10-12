import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { FeishuChannelRepository } from '../../db/repositories/feishu-channel-repository.js';
import { NotificationRepository } from '../../db/repositories/notification-repository.js';
import { FeishuNotifications, FeishuNotificationError } from './feishu-notifications.js';
import { renderFeishuNotificationCard } from './feishu-notification-card.js';
import { assertResolvedPublicHttpsEndpoint } from '../network-policy.js';
import { isFeishuGroupMember } from './feishu-notification-directory-client.js';

export interface FeishuNotificationIO {fetch?:typeof fetch;validate?:typeof assertResolvedPublicHttpsEndpoint}
const tokenUrl='https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const messageUrl='https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';
const tokenSchema=z.object({code:z.literal(0),tenant_access_token:z.string().min(1)});
const receiptSchema=z.object({code:z.number(),data:z.object({message_id:z.string().min(1)}).optional()});
export class FeishuNotificationWorker {
  constructor(private readonly db:Database,private readonly userId:string,private readonly key:string,private readonly io:FeishuNotificationIO={}) {}
  async runOnce(stop:AbortSignal):Promise<void> {
    if(stop.aborted || !this.db.open)return;
    const service=new FeishuNotifications(this.db,this.userId),records=service.records;
    const item=records.claim();if(!item)return;
    const notifications=new NotificationRepository(this.db,this.userId);
    const signal=AbortSignal.any([stop,AbortSignal.timeout(15_000)]);
    const authorize=()=>{
      signal.throwIfAborted();
      if(!this.db.open || !records.owns(item))throw new FeishuNotificationError('CLAIM_LOST');
      const scope=service.assertDelivery(item);
      if(item.notification_id && !notifications.get(item.notification_id))throw new FeishuNotificationError('NOTIFICATION_REMOVED');
      return scope;
    };
    const request=this.io.fetch??fetch,validate=this.io.validate??assertResolvedPublicHttpsEndpoint;
    let attempted=false;
    try {
      authorize();await validate(tokenUrl);
      const {target}=authorize();
      const credentials=new FeishuChannelRepository(this.db,this.userId,this.key).decryptAccountCredentials(target.accountId);
      const tokenResponse=await request(tokenUrl,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json'},
        body:JSON.stringify({app_id:credentials.appId,app_secret:credentials.appSecret})});
      if(tokenResponse.status===429 || tokenResponse.status>=500){records.retry(item,retryDelay(tokenResponse));return;}
      if(!tokenResponse.ok){records.finish(item,'failed','TOKEN_REJECTED');return;}
      const token=tokenSchema.parse(await tokenResponse.json()).tenant_access_token;
      authorize();
      if(target.kind==='group'&&!await isFeishuGroupMember(target.chatId,token,signal,this.io,()=>{authorize();})) {
        service.targets.records.invalidate(target.id.slice(6));
        throw new FeishuNotificationError('TARGET_UNAVAILABLE');
      }
      await validate(messageUrl);const current=authorize();
      const notification=item.notification_id?notifications.get(item.notification_id):undefined;
      const card=renderFeishuNotificationCard(item,notification,current.config.webBaseUrl);
      const body=JSON.stringify({receive_id:current.target.chatId,msg_type:'interactive',content:JSON.stringify(card),uuid:item.id});
      authorize();attempted=true;
      const response=await request(messageUrl,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body});
      if(stop.aborted || !this.db.open)return;
      if(response.status===429){records.retry(item,retryDelay(response));return;}
      if(response.status>=500){records.finish(item,'unknown','SEND_UNCERTAIN');return;}
      const parsed=receiptSchema.safeParse(await response.json());
      if(!parsed.success){records.finish(item,'unknown','SEND_UNCERTAIN');return;}
      if(parsed.data.code!==0){records.finish(item,'failed','SEND_REJECTED');return;}
      const messageId=parsed.data.data?.message_id;
      records.finish(item,response.ok && messageId?'delivered':'unknown',messageId?undefined:'SEND_UNCERTAIN',messageId);
    }catch(error){
      if(stop.aborted || !this.db.open)return;
      if(attempted)records.finish(item,'unknown','SEND_UNCERTAIN');
      else if(error instanceof FeishuNotificationError&&error.code==='DIRECTORY_UNAVAILABLE')records.retry(item,1000);
      else if(error instanceof FeishuNotificationError&&error.code==='DIRECTORY_PERMISSION_REQUIRED')records.finish(item,'failed',error.code);
      else if(error instanceof FeishuNotificationError)records.finish(item,'cancelled',error.code);
      else records.retry(item,1000);
    }
  }
}
function retryDelay(response:Response):number {
  const header=response.headers.get('retry-after');if(!header)return 1000;
  const seconds=Number(header),delay=Number.isFinite(seconds)?seconds*1000:Date.parse(header)-Date.now();
  return Number.isFinite(delay)?Math.max(1000,delay):1000;
}
