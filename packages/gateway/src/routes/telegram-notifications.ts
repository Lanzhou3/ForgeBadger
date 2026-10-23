import { Router } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { Database } from '../db/types.js';
import { TelegramNotificationError, TelegramNotifications } from '../services/notifications/telegram-notifications.js';

/** Mounted below the authenticated notifications router. Targets are confirmed private pairings only. */
export function createTelegramNotificationRoutes(db:Database):Router {
  const router=Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  router.use((req,res,next)=>{res.locals.service=new TelegramNotifications(db,(req as AuthenticatedRequest).userId);next();});
  router.get('/',(_req,res)=>res.json({code:0,data:(res.locals.service as TelegramNotifications).state(),message:''}));
  router.put('/',(req,res)=>{
    try{res.json({code:0,data:(res.locals.service as TelegramNotifications).update(req.body),message:''});}
    catch(error){const failure=notificationFailure(error);
      res.status(failure.status).json({code:1,message:'通知配置未保存',details:{code:failure.code}});}
  });
  router.get('/deliveries',(_req,res)=>{
    const deliveries=(res.locals.service as TelegramNotifications).records.list().map(row=>({id:row.id,type:row.event_type,status:row.status,errorCode:row.error_code,createdAt:row.created_at}));
    res.json({code:0,data:{deliveries},message:''});
  });
  router.post('/test',(req,res)=>{
    try{const row=(res.locals.service as TelegramNotifications).test(req.body);res.status(202).json({code:0,data:{id:row.id,status:row.status},message:''});}
    catch(error){const failure=notificationFailure(error);
      res.status(failure.status).json({code:1,message:'测试通知未入队',details:{code:failure.code}});}
  });
  return router;
}

function notificationFailure(error:unknown):{status:number;code:string} {
  if(error instanceof z.ZodError)return {status:400,code:'INPUT_INVALID'};
  if(error instanceof TelegramNotificationError)return {status:error.code==='WEB_URL_INVALID'?400:409,code:error.code};
  return {status:500,code:'INTERNAL_ERROR'};
}
