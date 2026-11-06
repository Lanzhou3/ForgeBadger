import type { Database } from '../../db/types.js';
import { NotificationRepository } from '../../db/repositories/notification-repository.js';
import { TelegramChannelRepository } from '../../db/repositories/telegram-channel-repository.js';
import { TelegramApiError, TelegramBotApi, type TelegramBotApiIO } from '../integrations/telegram-bot-api.js';
import { TelegramNotifications, TelegramNotificationError, renderTelegramNotificationText } from './telegram-notifications.js';

export class TelegramNotificationWorker {
  constructor(private readonly db:Database,private readonly userId:string,private readonly key:string,private readonly io:TelegramBotApiIO={}) {}
  async runOnce(stop:AbortSignal):Promise<void> {
    if(stop.aborted || !this.db.open)return;
    const service=new TelegramNotifications(this.db,this.userId),records=service.records;
    const item=records.claim();if(!item)return;
    const notifications=new NotificationRepository(this.db,this.userId);
    const signal=AbortSignal.any([stop,AbortSignal.timeout(15_000)]);
    const authorize=()=>{
      signal.throwIfAborted();
      if(!this.db.open || !records.owns(item))throw new TelegramNotificationError('CLAIM_LOST');
      const scope=service.assertDelivery(item);
      if(item.notification_id && !notifications.get(item.notification_id))throw new TelegramNotificationError('NOTIFICATION_REMOVED');
      return scope;
    };
    let attempted=false;
    try {
      const {target,config}=authorize();
      const credentials=new TelegramChannelRepository(this.db,this.userId,this.key).decryptAccountCredentials(target.accountId);
      const api=new TelegramBotApi({token:credentials.botToken,...(this.io.fetch?{fetch:this.io.fetch}:{}),...(this.io.validate?{validate:this.io.validate}:{})});
      const notification=item.notification_id?notifications.get(item.notification_id):undefined;
      const text=renderTelegramNotificationText(item,notification,config.webBaseUrl);
      // The Bot API re-runs this fence after endpoint validation, immediately before the request.
      const messageId=await api.sendMessage(target.chatId,text,signal,undefined,()=>{authorize();attempted=true;});
      if(stop.aborted || !this.db.open)return;
      records.finish(item,'delivered',undefined,String(messageId));
    }catch(error){
      if(stop.aborted || !this.db.open)return;
      if(error instanceof TelegramApiError && error.status===429){records.retry(item,Math.max(1,error.retryAfterSeconds??1)*1000);return;}
      // A Telegram error payload is a definite rejection (blocked bot, deleted chat, invalid request).
      if(error instanceof TelegramApiError && error.status>=400 && error.status<500 && error.message!=='TELEGRAM_RESPONSE_INVALID_JSON'){
        records.finish(item,'failed','SEND_REJECTED');return;
      }
      if(attempted)records.finish(item,'unknown','SEND_UNCERTAIN');
      else if(error instanceof TelegramNotificationError)records.finish(item,'cancelled',error.code);
      else records.retry(item,1000);
    }
  }
}
