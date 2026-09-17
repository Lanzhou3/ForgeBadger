import type { Database } from '../../db/types.js';
import { FeishuChannelRepository } from '../../db/repositories/feishu-channel-repository.js';
import { FeishuIntegrationRepository } from '../../db/repositories/feishu-integration-repository.js';
import { FeishuSdkFactory } from '../integrations/feishu-sdk.js';
import { FeishuConnectionSupervisor, type FeishuSupervisorAccount } from '../integrations/feishu-connection-supervisor.js';
import { FeishuChannelRuntime } from '../integrations/feishu-channel-runtime.js';
import { NativeChannelInbox, createFeishuNativeIngress } from './native-channel-inbox.js';
import { NativeChannelDelivery } from './native-channel-delivery.js';
import { createFeishuNativeSender } from '../integrations/feishu-native-sender.js';

export interface NativeFeishuIO {
  sdkFactory?: Pick<FeishuSdkFactory,'createWebSocketClient'>;
  fetch?: typeof fetch;
  validate?: typeof import('../network-policy.js').assertResolvedPublicHttpsEndpoint;
}
/** The system scheduler enumerates tenant IDs; every subsequent business read is tenant-scoped. */
export function createNativeFeishuRuntime(db:Database,key:string,io:NativeFeishuIO={}):FeishuChannelRuntime {
  const userIds=()=> (db.prepare("SELECT id FROM users WHERE status='active' ORDER BY id").all() as {id:string}[]).map(u=>u.id);
  const account=(userId:string):FeishuSupervisorAccount|undefined=>{
    if(!db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(userId))return undefined;
    const repository=new FeishuChannelRepository(db,userId,key);
    const saved=repository.getAccount();
    const config=new FeishuIntegrationRepository(db,userId).getConfig();
    if(!saved?.enabled || !config.enabled || config.emergencyDisabled)return undefined;
    return {userId,accountId:saved.id,configRevision:saved.configRevision,enabled:true,...repository.decryptAccountCredentials(saved.id)};
  };
  const supervisor=new FeishuConnectionSupervisor({
    sdkFactory:io.sdkFactory??new FeishuSdkFactory(),
    createHandlers:entry=>({onMessage:createFeishuNativeIngress({db,userId:entry.userId,masterKey:key,accountId:entry.accountId,accountRevision:entry.configRevision})}),
    accounts:{
      listEnabled:()=>userIds().flatMap(userId=>{try {const found=account(userId);return found?[found]:[];}catch{return [];}}),
      get:account,
      updateHealth:(userId,health)=>{
        if(!db.open || !health.accountId)return;
        const repository=new FeishuChannelRepository(db,userId,key);
        if(repository.getAccount(health.accountId)?.configRevision!==health.configRevision)return;
        repository.updateAccountHealth(health.accountId,{state:health.state,lastConnectedAt:health.lastConnectedAt,errorCode:health.lastErrorMessage?'FEISHU_CONNECTION_FAILED':null});
      }
    }
  });
  // Four bounded lanes share a round-robin cursor; each tenant has at most one active sender.
  let cursor=0;
  const active=new Set<string>();
  return new FeishuChannelRuntime({supervisor,
    // HTTP/WS owns process lifetime, as with the native recovery pump.
    setInterval:(callback,ms)=>{const timer=setInterval(callback,ms);timer.unref();return timer;},
    workers:Array.from({length:4},()=>async (signal:AbortSignal)=>{
    if(signal.aborted || !db.open)return;
    const ids=userIds();if(!ids.length)return;
    const userId=ids[cursor++%ids.length]!;
    if(active.has(userId))return;
    active.add(userId);
    try {
      new NativeChannelInbox(db,userId,key).adoptNext();
      await new NativeChannelDelivery(db,userId,key,createFeishuNativeSender(db,userId,key,io)).runOnce(signal);
    }finally{active.delete(userId);}
  })});
}
