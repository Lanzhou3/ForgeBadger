import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/types.js';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import { DevelopmentTaskRepository } from '../db/repositories/development-task-repository.js';
import { developmentId,taskSummary } from '../services/development/contracts.js';
import { ownedProject } from '../services/development/commands.js';
import { sandboxCapability } from '../services/development/sandbox.js';
import { reconcileDevelopmentTask,reconciliationRemedy } from '../services/development/reconciliation.js';
export function createCopilotDevelopmentRoutes(db:Database):Router {
 const router=Router();
 router.post('/development/tasks/:id/reconcile',(req,res)=>{
  try {
   const userId=(req as unknown as AuthenticatedRequest).userId!;
   const input=z.object({projectId:developmentId,expectedRevision:z.number().int().positive()}).strict().parse(req.body);
   const row=reconcileDevelopmentTask(db,userId,{...input,taskId:developmentId.parse(req.params.id)});
   res.json({code:0,data:{task:taskSummary(row)},message:''});
  }catch(error){
   if(error instanceof z.ZodError){res.status(400).json({code:1,message:'Invalid reconciliation request',details:{code:'DEVELOPMENT_RECONCILIATION_INPUT_INVALID'}});return;}
   const message=error instanceof Error?error.message:'DEVELOPMENT_RECONCILIATION_EVIDENCE_UNAVAILABLE';
   const code=message.startsWith('DEVELOPMENT_RECONCILIATION_')?message:'DEVELOPMENT_RECONCILIATION_EVIDENCE_UNAVAILABLE';
   res.status(code==='DEVELOPMENT_RECONCILIATION_NOT_FOUND'?404:409).json({code:1,message:'Development execution cannot be reconciled',details:{code,remedy:reconciliationRemedy(code)}});
  }
 });
 router.get('/development/capability',(_req,res)=>{res.json({code:0,data:sandboxCapability(),message:''});});
 router.get('/development/tasks', (req,res)=>{try{const userId=(req as unknown as AuthenticatedRequest).userId!,projectId=developmentId.parse(req.query.projectId);ownedProject({db,userId},projectId);res.json({code:0,data:{tasks:new DevelopmentTaskRepository(db,userId).list(projectId).map(taskSummary)},message:''});}catch(e){res.status(e instanceof z.ZodError?400:404).json({code:1,message:'Development project unavailable'});}});
 router.get('/development/tasks/:id',(req,res)=>{try{const userId=(req as unknown as AuthenticatedRequest).userId!,projectId=developmentId.parse(req.query.projectId),id=developmentId.parse(req.params.id);ownedProject({db,userId},projectId);const row=new DevelopmentTaskRepository(db,userId).get(id,projectId);if(!row)throw new Error('not found');res.json({code:0,data:{task:taskSummary(row),evidence:row.evidence_json?JSON.parse(row.evidence_json):null},message:''});}catch(e){res.status(e instanceof z.ZodError?400:404).json({code:1,message:'Development task unavailable'});}});
 return router;
}
