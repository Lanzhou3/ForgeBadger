import { fetchJson } from './api';
export type FeishuNotificationType='attention'|'failure'|'completion'|'lifecycle'|'app_action'|'automation';
export interface FeishuNotificationConfig {enabled:boolean;targetId:string|null;identityId:string|null;types:FeishuNotificationType[];webBaseUrl:string;revision:number}
export interface FeishuNotificationTarget {id:string;kind:'private'|'group';name:string;chatId:string;accountId:string;accountRevision:number;revision:number;available:boolean;reason:string|null}
export interface FeishuNotificationState {config:FeishuNotificationConfig;ready:boolean;blocker:string|null;targets:FeishuNotificationTarget[]}
export interface FeishuNotificationDelivery {id:string;type:FeishuNotificationType|'test';status:string;errorCode:string|null;createdAt:number}
const base='/api/v1/notifications/feishu';
export const getFeishuNotificationSettings=()=>fetchJson<FeishuNotificationState>(base);
export const refreshFeishuNotificationTargets=()=>fetchJson<{targets:FeishuNotificationTarget[]}>(base+'/targets/refresh',{method:'POST',body:'{}'});
export const saveFeishuNotificationSettings=(config:FeishuNotificationConfig)=>fetchJson<FeishuNotificationState>(base,{method:'PUT',body:JSON.stringify(config)});
export const getFeishuNotificationDeliveries=()=>fetchJson<{deliveries:FeishuNotificationDelivery[]}>(base+'/deliveries');
export const testFeishuNotification=(requestId:string)=>fetchJson<{id:string;status:string}>(base+'/test',{method:'POST',body:JSON.stringify({requestId})});
