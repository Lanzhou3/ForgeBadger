import { fetchJson } from './api';
export interface ChannelPairing {id:string;accountId:string;accountRevision:number;status:string;revision:number;externalUserId:string|null;chatId:string|null;expiresAt:number}
export interface ChannelIdentity {id:string;accountId:string;accountRevision:number;externalUserId:string;chatId:string;status:string}
export interface ChannelRoute {id:string;identityId:string;grantId:string;grantRevision:number;conversationId:string;status:string}
export interface ChannelDelivery {id:string;inboxId:string;phase:string;status:string;createdAt:number;receiptRecorded:boolean}
const base='/api/v1/copilot/channels';
const post=<T>(path:string,body:unknown={})=>fetchJson<T>(base+path,{method:'POST',body:JSON.stringify(body)});
export async function getChannelRecords() {
  const [pairings,identities,routes,deliveries]=await Promise.all([
    fetchJson<{pairings:ChannelPairing[]}>(base+'/pairings'),fetchJson<{identities:ChannelIdentity[]}>(base+'/identities'),
    fetchJson<{routes:ChannelRoute[]}>(base+'/routes'),fetchJson<{deliveries:ChannelDelivery[]}>(base+'/deliveries')
  ]);
  return {...pairings,...identities,...routes,...deliveries};
}
export const createChannelPairing=(accountId:string)=>post<{pairing:ChannelPairing;token:string}>('/pairings',{channel:'feishu',accountId});
export const confirmChannelPairing=(p:ChannelPairing)=>post(`/pairings/${encodeURIComponent(p.id)}/confirm`,{revision:p.revision,externalUserId:p.externalUserId,chatId:p.chatId});
export const cancelChannelPairing=(id:string)=>post(`/pairings/${encodeURIComponent(id)}/cancel`);
export const revokeChannelIdentity=(id:string)=>post(`/identities/${encodeURIComponent(id)}/revoke`);
export const createChannelRoute=(identityId:string,grantId:string)=>post('/routes',{identityId,grantId});
export const revokeChannelRoute=(id:string)=>post(`/routes/${encodeURIComponent(id)}/revoke`);
