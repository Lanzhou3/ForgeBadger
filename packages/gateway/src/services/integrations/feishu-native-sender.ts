import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { FeishuChannelRepository } from '../../db/repositories/feishu-channel-repository.js';
import { assertResolvedPublicHttpsEndpoint } from '../network-policy.js';
import type { NativeChannelSender } from '../channels/native-channel-delivery.js';
import { buildFeishuMessageParts, type FeishuMessagePart } from './feishu-markdown.js';

const tokenUrl='https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const messageUrl='https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';
const tokenSchema=z.object({code:z.literal(0),tenant_access_token:z.string().min(1)});
const receiptSchema=z.object({code:z.number(),msg:z.string().optional(),data:z.object({message_id:z.string().min(1)}).optional()});
type PartResult = {status:'delivered';messageId:string} | {status:'retry';retryAfterMs:number}
  | {status:'failed'} | {status:'unknown'} | {status:'format_rejected'};
/** Fixed domestic endpoints. Only definite rejections or pre-send failures may be retried. */
export function createFeishuNativeSender(db:Database,userId:string,key:string,io:{fetch?:typeof fetch;validate?:typeof assertResolvedPublicHttpsEndpoint}={}):NativeChannelSender {
  const request=io.fetch??fetch;
  const validate=io.validate??assertResolvedPublicHttpsEndpoint;
  return async input=>{
    const parts: Array<Omit<FeishuMessagePart,'msg_type'> & {msg_type:'post'|'text'|'interactive'}>=input.card
      ? [{msg_type:'interactive',content:JSON.stringify(input.card),plain:input.text}]:buildFeishuMessageParts(input.text);
    const start=input.nextPart??0;
    if(start>=parts.length)return {status:'delivered'};
    const startedAt=Date.now();
    const signal=AbortSignal.any([input.signal,AbortSignal.timeout(15_000)]);
    const authorize=()=>{signal.throwIfAborted();input.authorize();};
    await validate(tokenUrl);authorize();
    const credentials=new FeishuChannelRepository(db,userId,key).decryptAccountCredentials(input.peer.accountId);
    let token:string;
    try {
      const response=await request(tokenUrl,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json'},body:JSON.stringify({app_id:credentials.appId,app_secret:credentials.appSecret})});
      if(!response.ok)return response.status===429 || response.status>=500 ? {status:'retry',retryAfterMs:retryDelay(response)} : {status:'failed'};
      token=tokenSchema.parse(await response.json()).tenant_access_token;
    } catch { return {status:'retry',retryAfterMs:1000}; }
    const reply = input.peer.threadId && input.peer.replyToMessageId;
    const endpoint = reply ? `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(input.peer.replyToMessageId!)}/reply` : messageUrl;
    await validate(endpoint);authorize();
    const sendPart=async(part:typeof parts[number],index:number,plain=false):Promise<PartResult>=>{
      authorize();
      const uuid=createHash('sha256').update(`${input.deliveryId}:feishu-post-v1:${index}:${plain?'text':part.msg_type}`).digest('hex').slice(0,32);
      const response=await request(endpoint,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({...(reply ? {reply_in_thread:true} : {receive_id:input.peer.chatId}),msg_type:plain?'text':part.msg_type,content:plain?JSON.stringify({text:part.plain}):part.content,uuid})});
      if(response.status===429)return {status:'retry',retryAfterMs:retryDelay(response)};
      // A malformed response or gateway error cannot establish whether a message was accepted.
      const parsed=receiptSchema.safeParse(await response.json());
      if(!parsed.success || response.status>=500)return {status:'unknown'};
      if(parsed.data.code!==0 && response.status<500 && part.msg_type==='post' && !plain
        && /content format of the post type is incorrect/i.test(parsed.data.msg??'')) return {status:'format_rejected'};
      if(!response.ok)return {status:'unknown'};
      if(parsed.data.code!==0)return {status:'failed'};
      return parsed.data.data?.message_id ? {status:'delivered',messageId:parsed.data.data.message_id} : {status:'unknown'};
    };
    try {
      let messageId:string|undefined;
      for(let index=start;index<parts.length;index++) {
        // Yield only between confirmed sends; an in-flight timeout is still unknown.
        if(index>start && (index-start>=4 || Date.now()-startedAt>=8_000))return {status:'continue'};
        const part=parts[index]!;
        let result=await sendPart(part,index);
        if(result.status==='format_rejected') result=await sendPart(part,index,true);
        if(result.status==='format_rejected')return {status:'failed'};
        if(result.status!=='delivered')return result;
        messageId=result.messageId;
        input.checkpoint?.(index+1,messageId!);
      }
      return {status:'delivered',...(messageId?{messageId}:{})};
    } catch { return {status:'unknown'}; }
  };
}

function retryDelay(response: Response): number {
  const header = response.headers?.get('retry-after');
  if (!header) return 1000;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? Math.max(1000,seconds*1000) : Math.max(1000,Date.parse(header)-Date.now() || 1000);
}
