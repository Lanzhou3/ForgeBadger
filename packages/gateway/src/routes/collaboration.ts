import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../auth/middleware.js';
import { CollaborationError, type CollaborationOptions } from '../services/collaboration/types.js';
import { DeliveryService } from '../services/collaboration/delivery-service.js';
import { DeliveryEvidence } from '../services/collaboration/delivery-evidence.js';

const id=z.string().uuid();
const taskFields={title:z.string().trim().min(1).max(200),description:z.string().max(10000).optional(),acceptanceCriteria:z.array(z.string().trim().min(1).max(1000)).max(50),assigneeId:id.nullable().optional(),reviewerId:id.nullable().optional()};
const taskCreate=z.object(taskFields).strict();
const taskPatch=z.object(taskFields).partial().extend({expectedRevision:z.number().int().min(1)}).strict();
const commit=z.string().regex(/^[a-f0-9]{40,64}$/);
const key=z.string().uuid();
const runInput=z.object({aiTool:z.enum(['claude','opencode','codex','kimi']),idempotencyKey:key}).strict();
const expectedCommit=z.object({expectedCommit:commit}).strict();
const url=z.string().max(2048).refine(value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}},'HTTP(S) URL without credentials required').nullable();
const actor=(req:Request)=>(req as unknown as AuthenticatedRequest).userId;
const project=(req:Request)=>id.parse(req.params.projectId);
const task=(req:Request)=>id.parse(req.params.taskId);
const run=(req:Request)=>id.parse(req.params.runId);

export function createCollaborationRoutes(options:CollaborationOptions, service=new DeliveryService(options)):Router {
 const router=Router(),verification=new DeliveryEvidence(service);
 router.use(authenticate);
 const handle=(fn:(req:Request)=>unknown|Promise<unknown>,status=200)=>(req:Request,res:Response)=>{
  void Promise.resolve().then(()=>fn(req)).then(data=>res.status(status).json({code:0,data,message:''})).catch(error=>{
   const invalid=error instanceof z.ZodError;
   const code=error instanceof CollaborationError?error.code:invalid?'INVALID_INPUT':'COLLABORATION_OPERATION_FAILED';
   if(!invalid && !(error instanceof CollaborationError)) console.error('[collaboration] request failed',{userId:actor(req),action:req.method,code,timestamp:Date.now()});
   res.status(error instanceof CollaborationError?error.status:invalid?400:409).json({code:1,message:code,details:{code}});
  });
 };
 router.get('/projects',handle(req=>({projects:service.authority(actor(req)).list()})));
 router.get('/projects/:projectId',handle(req=>{
  const authority=service.authority(actor(req)),access=authority.access(project(req)),policy=authority.policy(access);
  return {project:{id:access.projectId,name:access.name,role:access.role,capabilities:access.capabilities,teamId:access.teamId,logicalOwnerId:access.logicalOwnerId,managedExecution:service.managedExecution(),revision:policy.revision,verificationRevision:policy.verificationRevision,executionEnabled:policy.executionEnabled,verification:policy.verification},members:authority.members(access),tasks:service.tasks(actor(req)).list(access),events:authority.events(access)};
 }));
 router.post('/projects/:projectId/archive',handle(req=>{z.object({}).strict().parse(req.body);return service.archive(actor(req),project(req));}));
 router.put('/projects/:projectId/members',handle(req=>{
  const input=z.object({email:z.string().email().max(254),role:z.enum(['developer','reviewer','viewer'])}).strict().parse(req.body);
  return {members:service.authority(actor(req)).putMember(project(req),input.email,input.role)};
 }));
 router.delete('/projects/:projectId/members/:userId',handle(req=>service.revoke(actor(req),project(req),id.parse(req.params.userId))));
 router.post('/projects/:projectId/tasks',handle(req=>({task:service.tasks(actor(req)).create(project(req),taskCreate.parse(req.body))}),201));
 router.patch('/projects/:projectId/tasks/:taskId',handle(req=>({task:service.tasks(actor(req)).update(project(req),task(req),taskPatch.parse(req.body))})));
 router.get('/projects/:projectId/tasks/:taskId',handle(req=>{
  const access=service.authority(actor(req)).access(project(req)),tasks=service.tasks(actor(req)),repo=service.repository(access);
  return {task:tasks.get(access,task(req)),comments:tasks.comments(access,task(req)),runs:repo.list(project(req),task(req)).map(r=>repo.dto(r,actor(req)))};
 }));
 router.post('/projects/:projectId/tasks/:taskId/comments',handle(req=>{
  const input=z.object({text:z.string().trim().min(1).max(5000)}).strict().parse(req.body);
  return {comment:service.tasks(actor(req)).comment(project(req),task(req),input.text)};
 },201));
 router.post('/projects/:projectId/tasks/:taskId/runs',handle(req=>service.prepare(actor(req),project(req),task(req),runInput.parse(req.body)),201));
 router.get('/projects/:projectId/runs/:runId',handle(req=>service.details(actor(req),project(req),run(req))));
 router.get('/projects/:projectId/runs/:runId/diff',handle(req=>service.diff(actor(req),project(req),run(req),z.string().min(1).max(512).parse(req.query.path))));
 router.patch('/projects/:projectId/runs/:runId/links',handle(req=>{
  const input=z.object({previewUrl:url,prUrl:url}).strict().parse(req.body);
  return service.links(actor(req),project(req),run(req),input.previewUrl,input.prUrl);
 }));
 router.post('/projects/:projectId/runs/:runId/review',handle(req=>verification.review(actor(req),project(req),run(req),z.object({expectedCommit:commit,verificationId:id,decision:z.enum(['accepted','changes_requested']),note:z.string().trim().min(1).max(5000)}).strict().parse(req.body))));
 router.post('/projects/:projectId/runs/:runId/integrate',handle(req=>verification.integrate(actor(req),project(req),run(req),expectedCommit.parse(req.body).expectedCommit)));
 router.post('/projects/:projectId/runs/:runId/recover',handle(req=>service.recover(actor(req),project(req),run(req),z.object({idempotencyKey:key}).strict().parse(req.body).idempotencyKey)));
 router.post('/projects/:projectId/runs/:runId/close',handle(req=>{z.object({}).strict().parse(req.body);return service.close(actor(req),project(req),run(req));}));
 router.get('/projects/:projectId/runs/:runId/handoff',handle(req=>verification.handoff(actor(req),project(req),run(req))));
 return router;
}
