import type { Database } from '../../db/types.js';
import { ChannelIdentityRepository } from '../../db/repositories/channel-identity-repository.js';
import { FeishuChannelRepository } from '../../db/repositories/feishu-channel-repository.js';
import { FeishuIntegrationRepository } from '../../db/repositories/feishu-integration-repository.js';
import { FeishuNotificationTargetRepository } from '../../db/repositories/feishu-notification-target-repository.js';
import { FeishuNotificationError } from './feishu-notification-error.js';
import { directoryToken, listFeishuGroups, type FeishuDirectoryIO } from './feishu-notification-directory-client.js';
import { redactSensitiveContent } from '../../lib/redaction.js';

export interface FeishuNotificationTarget {
  id:string;kind:'private'|'group';name:string;chatId:string;accountId:string;accountRevision:number;
  revision:number;available:boolean;reason:string|null;
}
export class FeishuNotificationTargets {
  readonly records:FeishuNotificationTargetRepository;
  private readonly identities:ChannelIdentityRepository;
  constructor(private readonly db:Database,private readonly userId:string) {
    this.records=new FeishuNotificationTargetRepository(db,userId);
    this.identities=new ChannelIdentityRepository(db,userId);
  }
  private assertAccount(accountId:string,accountRevision:number):void {
    if(!this.identities.actorActive())throw new FeishuNotificationError('USER_DISABLED');
    const account=this.identities.accountMetadata('feishu',accountId);
    if(!account?.enabled||account.configRevision!==accountRevision)throw new FeishuNotificationError('ACCOUNT_CHANGED');
    const config=new FeishuIntegrationRepository(this.db,this.userId).getConfig();
    if(!config.enabled||config.emergencyDisabled)throw new FeishuNotificationError('CHANNEL_DISABLED');
  }
  private privateTarget(id:string):FeishuNotificationTarget|undefined {
    const identity=this.identities.identity(id);
    if(!identity||identity.channel!=='feishu')return;
    return {id:`private:${identity.id}`,kind:'private',name:`已确认私聊 · ${identity.externalUserId}`,chatId:identity.chatId,
      accountId:identity.accountId,accountRevision:identity.accountRevision,revision:identity.revision,
      available:identity.status==='active',reason:identity.status==='active'?null:'IDENTITY_INVALID'};
  }
  resolve(id:string|null):FeishuNotificationTarget|undefined {
    if(!id)return;
    if(id.startsWith('private:'))return this.privateTarget(id.slice(8));
    if(!id.startsWith('group:'))return;
    const group=this.records.group(id.slice(6));
    return group?{...group,id:`group:${group.id}`,kind:'group',reason:group.available?null:'TARGET_UNAVAILABLE'}:undefined;
  }
  authority(id:string|null):FeishuNotificationTarget {
    const target=this.resolve(id);
    if(!target)throw new FeishuNotificationError('TARGET_INVALID');
    this.assertAccount(target.accountId,target.accountRevision);
    if(!target.available)throw new FeishuNotificationError(target.reason??'TARGET_UNAVAILABLE');
    return target;
  }
  list():FeishuNotificationTarget[] {
    const account=this.records.account();
    if(!account)return [];
    const privateTargets=this.identities.listIdentities()
      .filter(identity=>identity.channel==='feishu'&&identity.accountId===account.id&&identity.accountRevision===account.configRevision&&identity.status==='active')
      .map(identity=>this.privateTarget(identity.id)!);
    const groups=this.records.groups(account.id,account.configRevision).map(group=>this.resolve(`group:${group.id}`)!);
    return [...privateTargets,...groups].map(target=>{
      try{this.authority(target.id);return target;}
      catch(error){return {...target,available:false,reason:error instanceof FeishuNotificationError?error.code:'TARGET_UNAVAILABLE'};}
    });
  }
  async refresh(masterKey:string,io:FeishuDirectoryIO={}):Promise<FeishuNotificationTarget[]> {
    const accounts=new FeishuChannelRepository(this.db,this.userId,masterKey);
    const account=accounts.getAccount();
    if(!account)throw new FeishuNotificationError('ACCOUNT_CHANGED');
    const signal=AbortSignal.timeout(20_000);
    const fence=()=>{signal.throwIfAborted();this.assertAccount(account.id,account.configRevision);};
    fence();
    const config=new FeishuIntegrationRepository(this.db,this.userId).getConfig();
    const candidates=new Set([...config.allowedChatIds,...this.records.knownGroupChatIds(account.id,account.configRevision),
      ...this.records.groups(account.id,account.configRevision).map(group=>group.chatId)]);
    let groups:{chatId:string;name:string}[];
    try {
      const token=await directoryToken(accounts.decryptAccountCredentials(account.id),signal,io,fence);
      groups=await listFeishuGroups(token,signal,io,fence);
    }catch(error){
      if(error instanceof FeishuNotificationError)throw error;
      throw new FeishuNotificationError('DIRECTORY_UNAVAILABLE');
    }
    fence();
    this.records.synchronize(account.id,account.configRevision,groups.filter(group=>candidates.has(group.chatId))
      .map(group=>({...group,name:Array.from(redactSensitiveContent(group.name)).slice(0,200).join('')||'未命名群聊'})));
    return this.list();
  }
}
