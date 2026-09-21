import {Router} from 'express';
import {z} from 'zod';
import {authenticate,type AuthenticatedRequest} from '../auth/middleware.js';
import type {Database} from '../db/types.js';
import {TaskArtifactLinks,artifactLinkInput} from '../services/project-manager/task-artifact-links.js';
import {CollaborationError} from '../services/collaboration/types.js';

export function createTaskArtifactLinkRoutes(db:Database):Router {
 const router=Router();router.use(authenticate);
 router.route('/projects/:projectId/tasks/:taskId/copilot-artifacts').get((req,res,next)=>{try{
  const service=new TaskArtifactLinks(db,(req as unknown as AuthenticatedRequest).userId);
  res.json({code:0,data:service.list(z.string().uuid().parse(req.params.projectId),z.string().uuid().parse(req.params.taskId)),message:''});
 }catch(error){next(error);}}).post((req,res,next)=>{try{
  const service=new TaskArtifactLinks(db,(req as unknown as AuthenticatedRequest).userId);
  res.json({code:0,data:{artifact:service.link(z.string().uuid().parse(req.params.projectId),z.string().uuid().parse(req.params.taskId),artifactLinkInput.parse(req.body))},message:''});
 }catch(error){next(error);}});
 router.use((error:unknown,req:import('express').Request,res:import('express').Response,_next:import('express').NextFunction)=>{
  const invalid=error instanceof z.ZodError,known=error instanceof CollaborationError;
  const code=invalid?'INVALID_INPUT':known?error.code:'ARTIFACT_LINK_FAILED';
  if(!known&&!invalid)console.error('[task-artifact-link]',{action:req.method,code,timestamp:Date.now()});
  res.status(invalid?400:known?error.status:409).json({code:1,message:code,details:{code}});
 });
 return router;
}
