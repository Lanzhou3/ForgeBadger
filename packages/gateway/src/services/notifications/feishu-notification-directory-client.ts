import { z } from 'zod';
import { assertResolvedPublicHttpsEndpoint } from '../network-policy.js';
import { FeishuNotificationError } from './feishu-notification-error.js';

export interface FeishuDirectoryIO {fetch?:typeof fetch;validate?:typeof assertResolvedPublicHttpsEndpoint}
const base='https://open.feishu.cn/open-apis';
const groupsSchema=z.object({code:z.literal(0),data:z.object({
  items:z.array(z.object({chat_id:z.string().min(1).max(128),name:z.string().max(1000)})),
  has_more:z.boolean(),page_token:z.string().max(4096).optional(),
})});

async function request(path:string,init:RequestInit,io:FeishuDirectoryIO,fence:()=>void):Promise<unknown> {
  fence();await (io.validate??assertResolvedPublicHttpsEndpoint)(base+path);fence();
  const response=await (io.fetch??fetch)(base+path,{...init,redirect:'error'});
  fence();
  if(!response.ok)throw new FeishuNotificationError(response.status===403?'DIRECTORY_PERMISSION_REQUIRED':'DIRECTORY_UNAVAILABLE');
  const data:unknown=await response.json();fence();
  if(data&&typeof data==='object'&&'code' in data&&data.code!==0)
    throw new FeishuNotificationError(data.code===99991672?'DIRECTORY_PERMISSION_REQUIRED':'DIRECTORY_UNAVAILABLE');
  return data;
}
export async function directoryToken(credentials:{appId:string;appSecret:string},signal:AbortSignal,io:FeishuDirectoryIO,fence:()=>void):Promise<string> {
  const result=await request('/auth/v3/tenant_access_token/internal',{method:'POST',signal,headers:{'content-type':'application/json'},
    body:JSON.stringify({app_id:credentials.appId,app_secret:credentials.appSecret})},io,fence);
  return z.object({code:z.literal(0),tenant_access_token:z.string().min(1)}).parse(result).tenant_access_token;
}
export async function listFeishuGroups(token:string,signal:AbortSignal,io:FeishuDirectoryIO,fence:()=>void):Promise<{chatId:string;name:string}[]> {
  const groups=new Map<string,{chatId:string;name:string}>(),seen=new Set<string>();
  let pageToken='';
  for(let page=0;page<20;page++) {
    const query=new URLSearchParams({page_size:'100',...(pageToken?{page_token:pageToken}:{})});
    const result=groupsSchema.parse(await request(`/im/v1/chats?${query}`,{signal,headers:{authorization:`Bearer ${token}`}},io,fence));
    for(const item of result.data.items)groups.set(item.chat_id,{chatId:item.chat_id,name:item.name});
    if(!result.data.has_more)return [...groups.values()];
    const next=result.data.page_token;
    if(!next||seen.has(next))break;
    seen.add(next);pageToken=next;
  }
  throw new FeishuNotificationError('DIRECTORY_INCOMPLETE');
}
export async function isFeishuGroupMember(chatId:string,token:string,signal:AbortSignal,io:FeishuDirectoryIO,fence:()=>void):Promise<boolean> {
  const result=await request(`/im/v1/chats/${encodeURIComponent(chatId)}/members/is_in_chat`,{signal,headers:{authorization:`Bearer ${token}`}},io,fence);
  return z.object({code:z.literal(0),data:z.object({is_in_chat:z.boolean()})}).parse(result).data.is_in_chat;
}
