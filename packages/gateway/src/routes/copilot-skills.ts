import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../auth/middleware.js';
import type { Database } from '../db/types.js';
import { CopilotSkillService, type CopilotSkillQueryOptions } from '../services/agent/skills/copilot-skill-service.js';
import { skillFilesSchema } from '../services/agent/skills/copilot-skill-package.js';
import { publicFetch } from '../services/extensions/public-fetch.js';
import { importCopilotSkill } from '../services/agent/skills/copilot-skill-import.js';

export interface CopilotSkillRouteOptions { availableToolNames?: readonly string[] | ((userId: string) => readonly string[]); fetch?: typeof publicFetch; }
const revisionId = z.string().uuid();
const fileImport = z.object({ source: z.object({kind:z.enum(['paste','upload']),label:z.string().max(240).optional()}).strict(), files: skillFilesSchema }).strict();
const urlImport = z.object({ source:z.object({kind:z.literal('url'),url:z.string().url().max(2048)}).strict() }).strict();
const importSchema = z.union([fileImport,urlImport]);
const updateSchema = z.object({expectedRevisionId:revisionId,files:skillFilesSchema,reviewedVersion:z.string().min(1).max(128).optional()}).strict();
const toggleSchema = z.object({expectedRevisionId:revisionId,enabled:z.boolean()}).strict();
const rollbackSchema = z.object({expectedRevisionId:revisionId,revisionId}).strict();

export function copilotSkillQueryOptions(userId: string, options: CopilotSkillRouteOptions): CopilotSkillQueryOptions {
  const names = typeof options.availableToolNames === 'function' ? options.availableToolNames(userId) : options.availableToolNames;
  return names ? { availableToolNames: names } : {};
}
export function respondSkillError(res: Response, error: unknown): void {
  const message = error instanceof z.ZodError ? 'Invalid Skill input' : error instanceof Error ? error.message : 'Skill operation failed';
  const status = /not found/i.test(message) ? 404 : /revision|changed|already exists|review|incompatible/i.test(message) ? 409 : 400;
  res.status(status).json({code:1,message});
}
export function createCopilotSkillRoutes(db: Database, options: CopilotSkillRouteOptions = {}): Router {
  const router = Router(); router.use(authenticate);
  router.get('/skills', (req,res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try { res.json({code:0,data:{skills:new CopilotSkillService(db,userId).list(copilotSkillQueryOptions(userId,options))},message:''}); }
    catch(error) { respondSkillError(res,error); }
  });
  router.post('/skills/imports', async (req,res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try {
      const input = importSchema.parse(req.body);
      const skill = await importCopilotSkill(db,userId,input,copilotSkillQueryOptions(userId,options),options.fetch ?? publicFetch);
      res.status(201).json({code:0,data:{skill},message:''});
    } catch(error) { respondSkillError(res,error); }
  });
  router.get('/skills/:id', (req,res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try {
      revisionId.parse(req.params.id);
      const skill = new CopilotSkillService(db,userId).get(req.params.id,copilotSkillQueryOptions(userId,options));
      if (!skill) throw new Error('Skill not found');
      res.json({code:0,data:{skill},message:''});
    } catch(error) { respondSkillError(res,error); }
  });
  router.put('/skills/:id', (req,res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try { revisionId.parse(req.params.id); const input=updateSchema.parse(req.body);
      const skill = new CopilotSkillService(db,userId).update(req.params.id,input,copilotSkillQueryOptions(userId,options));
      res.json({code:0,data:{skill},message:''});
    } catch(error) { respondSkillError(res,error); }
  });
  router.put('/skills/:id/enabled', (req,res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try { revisionId.parse(req.params.id); const input=toggleSchema.parse(req.body);
      const skill = new CopilotSkillService(db,userId).setEnabled(req.params.id,input.enabled,input.expectedRevisionId,copilotSkillQueryOptions(userId,options));
      res.json({code:0,data:{skill},message:''});
    } catch(error) { respondSkillError(res,error); }
  });
  router.get('/skills/:id/revisions', (req,res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try { revisionId.parse(req.params.id); res.json({code:0,data:{revisions:new CopilotSkillService(db,userId).revisions(req.params.id)},message:''}); }
    catch(error) { respondSkillError(res,error); }
  });
  router.get('/skills/:id/revisions/:revisionId', (req,res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try { revisionId.parse(req.params.id); revisionId.parse(req.params.revisionId);
      const revision = new CopilotSkillService(db,userId).revision(req.params.id,req.params.revisionId);
      if (!revision) throw new Error('Skill revision not found');
      res.json({code:0,data:{revision},message:''});
    } catch(error) { respondSkillError(res,error); }
  });
  router.post('/skills/:id/rollback', (req,res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try { revisionId.parse(req.params.id); const input=rollbackSchema.parse(req.body);
      const skill = new CopilotSkillService(db,userId).rollback(req.params.id,input.revisionId,input.expectedRevisionId,copilotSkillQueryOptions(userId,options));
      res.json({code:0,data:{skill},message:''});
    } catch(error) { respondSkillError(res,error); }
  });
  return router;
}
