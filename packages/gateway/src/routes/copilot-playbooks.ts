import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../auth/middleware.js';
import type { Database } from '../db/types.js';
import { CopilotSkillService } from '../services/agent/skills/copilot-skill-service.js';
import { copilotSkillQueryOptions, respondSkillError, type CopilotSkillRouteOptions } from './copilot-skills.js';

const idSchema = z.string().uuid();
const updateSchema = z.object({content:z.string().min(1).max(32_000),version:z.string().min(1).max(32)}).strict();
const enabledSchema = z.object({enabled:z.boolean()}).strict();
/** Compatibility API: old clients retain their body/version payloads and durable Skill IDs. */
export function createCopilotPlaybookRoutes(db: Database, options: CopilotSkillRouteOptions = {}): Router {
  const router=Router(); router.use(authenticate);
  router.get('/playbooks',(req,res)=>{
    const userId=(req as unknown as AuthenticatedRequest).userId;
    try {
      const playbooks=new CopilotSkillService(db,userId).details(copilotSkillQueryOptions(userId,options));
      res.json({code:0,data:{playbooks},message:''});
    }catch(error){respondSkillError(res,error);}
  });
  router.put('/playbooks/:id',(req,res)=>{
    const userId=(req as unknown as AuthenticatedRequest).userId;
    try {
      idSchema.parse(req.params.id);const input=updateSchema.parse(req.body);
      const playbook=new CopilotSkillService(db,userId).updateLegacy(req.params.id,input.content,input.version,copilotSkillQueryOptions(userId,options));
      res.json({code:0,data:{playbook},message:''});
    }catch(error){respondSkillError(res,error);}
  });
  router.put('/playbooks/:id/enabled',(req,res)=>{
    const userId=(req as unknown as AuthenticatedRequest).userId;
    try {
      idSchema.parse(req.params.id);const input=enabledSchema.parse(req.body);
      const service=new CopilotSkillService(db,userId);
      const current=service.get(req.params.id);
      if(!current?.editable)throw new Error('Skill not found');
      const playbook=service.setEnabled(req.params.id,input.enabled,current.revisionId,copilotSkillQueryOptions(userId,options));
      res.json({code:0,data:{playbook},message:''});
    }catch(error){respondSkillError(res,error);}
  });
  return router;
}
