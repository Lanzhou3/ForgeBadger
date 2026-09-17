import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { FeishuChannelRepository } from '../../db/repositories/feishu-channel-repository.js';
import { assertResolvedPublicHttpsEndpoint } from '../network-policy.js';
import type { NativeChannelSender } from '../channels/native-channel-delivery.js';

const tokenUrl='https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const messageUrl='https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';
const tokenSchema=z.object({code:z.literal(0),tenant_access_token:z.string().min(1)});
const receiptSchema=z.object({code:z.number(),data:z.object({message_id:z.string().min(1)}).optional()});
/** Fixed domestic endpoints, no redirects/retries. Unknown send outcomes require operator reconciliation. */
export function createFeishuNativeSender(db:Database,userId:string,key:string,io:{fetch?:typeof fetch;validate?:typeof assertResolvedPublicHttpsEndpoint}={}):NativeChannelSender {
  const request=io.fetch??fetch;
  const validate=io.validate??assertResolvedPublicHttpsEndpoint;
  return async input=>{
    const signal=AbortSignal.any([input.signal,AbortSignal.timeout(15_000)]);
    const authorize=()=>{signal.throwIfAborted();input.authorize();};
    await validate(tokenUrl);authorize();
    const credentials=new FeishuChannelRepository(db,userId,key).decryptAccountCredentials(input.peer.accountId);
    let token:string;
    try {
      const response=await request(tokenUrl,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json'},body:JSON.stringify({app_id:credentials.appId,app_secret:credentials.appSecret})});
      if(!response.ok)return {status:'failed'};
      token=tokenSchema.parse(await response.json()).tenant_access_token;
    } catch { return {status:'failed'}; }
    await validate(messageUrl);authorize();
    try {
      const response=await request(messageUrl,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({receive_id:input.peer.chatId,msg_type:'text',content:JSON.stringify({text:input.text}),uuid:input.deliveryId})});
      // A malformed response or gateway error cannot establish whether a message was accepted.
      const parsed=receiptSchema.safeParse(await response.json());
      if(!parsed.success || !response.ok)return {status:'unknown'};
      if(parsed.data.code!==0)return {status:'failed'};
      return parsed.data.data?.message_id ? {status:'delivered',messageId:parsed.data.data.message_id} : {status:'unknown'};
    } catch { return {status:'unknown'}; }
  };
}
