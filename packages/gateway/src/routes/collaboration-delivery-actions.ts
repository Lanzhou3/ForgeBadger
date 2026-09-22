import {Router,type Request,type Response} from 'express';
import {z} from 'zod';
import {authenticate,type AuthenticatedRequest} from '../auth/middleware.js';
import {DeliveryActions} from '../services/collaboration/delivery-actions.js';
import type {DeliveryService} from '../services/collaboration/delivery-service.js';
import {CollaborationError} from '../services/collaboration/types.js';
import {draftPullRequestInput} from '../services/collaboration/github-pull-requests.js';
const id=z.string().uuid();
export function createDeliveryActionsRoutes(service:DeliveryService):Router {
  const router=Router(),actions=new DeliveryActions(service);router.use(authenticate);
  const handle=(fn:(req:Request)=>Promise<unknown>)=>(req:Request,res:Response)=>{
    void fn(req).then(data=>res.json({code:0,data,message:''})).catch(error=>{
      const code=error instanceof CollaborationError?error.code:error instanceof z.ZodError?'INVALID_INPUT':'DELIVERY_ACTION_FAILED';
      res.status(error instanceof CollaborationError?error.status:error instanceof z.ZodError?400:409).json({code:1,message:code,details:{code}});
    });
  };
  const scope=(req:Request)=>[(req as AuthenticatedRequest).userId,id.parse(req.params.projectId),id.parse(req.params.runId)] as const;
  router.post('/projects/:projectId/runs/:runId/reconcile',handle(async req=>{
    const input=z.object({expectedCommit:z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),idempotencyKey:id}).strict().parse(req.body);
    return actions.reconcile(...scope(req),input.expectedCommit,input.idempotencyKey);
  }));
  router.post('/projects/:projectId/runs/:runId/pull-request',handle(async req=>{
    const address=req.socket.remoteAddress;
    if(!req.secure&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address??''))throw new CollaborationError(403,'SECURE_GITHUB_CREDENTIAL_TRANSPORT_REQUIRED');
    return actions.pullRequest(...scope(req),draftPullRequestInput.parse(req.body));
  }));
  return router;
}
