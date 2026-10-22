import { fetchJson } from './api';
import type { FeishuNotificationType } from './feishu-notifications-api';
export type TelegramNotificationType=FeishuNotificationType;
export interface TelegramNotificationConfig {enabled:boolean;targetId:string|null;types:TelegramNotificationType[];webBaseUrl:string;revision:number}
/** Telegram notifications target confirmed private pairings only. */
export interface TelegramNotificationTarget {id:string;kind:'private';name:string;chatId:string;accountId:string;accountRevision:number;revision:number;available:boolean;reason:string|null}
export interface TelegramNotificationState {config:TelegramNotificationConfig;ready:boolean;blocker:string|null;targets:TelegramNotificationTarget[]}
export interface TelegramNotificationDelivery {id:string;type:TelegramNotificationType|'test';status:string;errorCode:string|null;createdAt:number}
const base='/api/v1/notifications/telegram';
export const getTelegramNotificationSettings=()=>fetchJson<TelegramNotificationState>(base);
export const saveTelegramNotificationSettings=(config:TelegramNotificationConfig)=>fetchJson<TelegramNotificationState>(base,{method:'PUT',body:JSON.stringify(config)});
export const getTelegramNotificationDeliveries=()=>fetchJson<{deliveries:TelegramNotificationDelivery[]}>(base+'/deliveries');
export const testTelegramNotification=(requestId:string)=>fetchJson<{id:string;status:string}>(base+'/test',{method:'POST',body:JSON.stringify({requestId})});
