import { Router } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { Database } from '../db/types.js';
import { FeishuNotificationError, FeishuNotifications } from '../services/notifications/feishu-notifications.js';
import type { FeishuDirectoryIO } from '../services/notifications/feishu-notification-directory-client.js';
import type { FeishuNotificationTarget } from '../services/notifications/feishu-notification-targets.js';

export interface FeishuNotificationRouteOptions {masterKey:string;io?:FeishuDirectoryIO}

/** Mounted below the authenticated notifications router. No arbitrary receiver or card payload API. */
export function createFeishuNotificationRoutes(db:Database,options?:FeishuNotificationRouteOptions):Router {
  const router=Router();
  const refreshing=new Map<string,Promise<FeishuNotificationTarget[]>>();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  router.use((req,res,next)=>{res.locals.service=new FeishuNotifications(db,(req as AuthenticatedRequest).userId);next();});
  router.get('/',(_req,res)=>res.json({code:0,data:(res.locals.service as FeishuNotifications).state(),message:''}));
  router.post('/targets/refresh',async(req,res)=>{
    try {
      z.object({}).strict().parse(req.body??{});
      if(!options)throw new FeishuNotificationError('DIRECTORY_UNAVAILABLE');
      const userId=(req as AuthenticatedRequest).userId;
      let pending=refreshing.get(userId);
      if(!pending){pending=(res.locals.service as FeishuNotifications).targets.refresh(options.masterKey,options.io)
        .finally(()=>{refreshing.delete(userId);});refreshing.set(userId,pending);}
      const targets=await pending;
      res.json({code:0,data:{targets},message:''});
    }catch(error){const failure=notificationFailure(error);res.status(failure.status).json({code:1,message:'接收位置未刷新',details:{code:failure.code}});}
  });
  router.put('/',(req,res)=>{
    try{res.json({code:0,data:(res.locals.service as FeishuNotifications).update(req.body),message:''});}
    catch(error){const failure=notificationFailure(error);
      res.status(failure.status).json({code:1,message:'通知配置未保存',details:{code:failure.code}});}
  });
  router.get('/deliveries',(_req,res)=>{
    const deliveries=(res.locals.service as FeishuNotifications).records.list().map(row=>({id:row.id,type:row.event_type,status:row.status,errorCode:row.error_code,createdAt:row.created_at}));
    res.json({code:0,data:{deliveries},message:''});
  });
  router.post('/test',(req,res)=>{
    try{const row=(res.locals.service as FeishuNotifications).test(req.body);res.status(202).json({code:0,data:{id:row.id,status:row.status},message:''});}
    catch(error){const failure=notificationFailure(error);
      res.status(failure.status).json({code:1,message:'测试通知未入队',details:{code:failure.code}});}
  });
  return router;
}

function notificationFailure(error:unknown):{status:number;code:string} {
  if(error instanceof z.ZodError)return {status:400,code:'INPUT_INVALID'};
  if(error instanceof FeishuNotificationError)return {status:error.code==='WEB_URL_INVALID'?400:409,code:error.code};
  return {status:500,code:'INTERNAL_ERROR'};
}
