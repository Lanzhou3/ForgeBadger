import type { Database } from '../../db/types.js';
import { ChannelIdentityRepository, type ChannelIdentity } from '../../db/repositories/channel-identity-repository.js';
import { TelegramIntegrationRepository } from '../../db/repositories/telegram-integration-repository.js';

export class TelegramNotificationError extends Error {
  constructor(readonly code:string){super(code);}
}
export interface TelegramNotificationTarget {
  id:string;kind:'private';name:string;chatId:string;accountId:string;accountRevision:number;
  revision:number;available:boolean;reason:string|null;
}
/** Telegram targets are confirmed private pairings only; group delivery is out of scope. */
export class TelegramNotificationTargets {
  private readonly identities:ChannelIdentityRepository;
  constructor(private readonly db:Database,private readonly userId:string) {
    this.identities=new ChannelIdentityRepository(db,userId);
  }
  private assertAccount(accountId:string,accountRevision:number):void {
    if(!this.identities.actorActive())throw new TelegramNotificationError('USER_DISABLED');
    const account=this.identities.accountMetadata('telegram',accountId);
    if(!account?.enabled||account.configRevision!==accountRevision)throw new TelegramNotificationError('ACCOUNT_CHANGED');
    const config=new TelegramIntegrationRepository(this.db,this.userId).getConfig();
    if(!config.enabled||config.emergencyDisabled)throw new TelegramNotificationError('CHANNEL_DISABLED');
  }
  private toTarget(identity:ChannelIdentity):TelegramNotificationTarget {
    return {id:`private:${identity.id}`,kind:'private',name:`已确认私聊 · ${identity.externalUserId}`,chatId:identity.chatId,
      accountId:identity.accountId,accountRevision:identity.accountRevision,revision:identity.revision,
      available:identity.status==='active',reason:identity.status==='active'?null:'IDENTITY_INVALID'};
  }
  resolve(id:string|null):TelegramNotificationTarget|undefined {
    if(!id?.startsWith('private:'))return;
    const identity=this.identities.identity(id.slice(8));
    return identity?.channel==='telegram'?this.toTarget(identity):undefined;
  }
  authority(id:string|null):TelegramNotificationTarget {
    const target=this.resolve(id);
    if(!target)throw new TelegramNotificationError('TARGET_INVALID');
    this.assertAccount(target.accountId,target.accountRevision);
    if(!target.available)throw new TelegramNotificationError(target.reason??'TARGET_UNAVAILABLE');
    return target;
  }
  list():TelegramNotificationTarget[] {
    return this.identities.listIdentities()
      .filter(identity=>identity.channel==='telegram'&&identity.status==='active')
      .filter(identity=>this.identities.accountMetadata('telegram',identity.accountId)?.configRevision===identity.accountRevision)
      .map(identity=>{
        const target=this.toTarget(identity);
        try{this.authority(target.id);return target;}
        catch(error){return {...target,available:false,reason:error instanceof TelegramNotificationError?error.code:'TARGET_UNAVAILABLE'};}
      });
  }
}
