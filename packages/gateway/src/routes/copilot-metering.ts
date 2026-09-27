import { Router } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { Database } from '../db/types.js';
import { CopilotTokenRates, tokenRatesSchema } from '../services/agent/model-metering.js';
import { CopilotRunLedger } from '../services/agent/run-ledger.js';
import { RunGovernance } from '../services/agent/run-governance.js';
import { revokeDevelopmentRepairs } from '../services/agent/development-repair.js';
const id = z.string().min(1).max(128);
/** Mounted below the authenticated Copilot router. */
export function createCopilotMeteringRoutes(db: Database): Router {
  const router=Router();
  router.delete('/runs/:runId/repairs',(req,res)=>{
    const userId=(req as unknown as AuthenticatedRequest).userId!,runId=id.safeParse(req.params.runId);
    if(!runId.success||!new CopilotRunLedger(db,userId).get(runId.data)){res.status(404).json({code:1,message:'Run not found'});return;}
    revokeDevelopmentRepairs(db,userId,runId.data);res.json({code:0,data:{revoked:true},message:''});
  });
  for(const method of ['get','put'] as const) router[method]('/token-rates/:modelId',(req,res)=>{
    try {
      const repo=new CopilotTokenRates(db,(req as unknown as AuthenticatedRequest).userId!);
      const modelId=id.parse(req.params.modelId);
      const rates=method==='get'?repo.get(modelId):repo.set(modelId,tokenRatesSchema.parse(req.body));
      res.json({code:0,data:{rates,currency:'USD',basis:'owner_configured_per_million_tokens'},message:''});
    }catch(error){res.status(error instanceof z.ZodError?400:404).json({code:1,message:error instanceof z.ZodError?'Invalid token rates':'Model not found'});}
  });
  router.get('/runs/:runId/usage',(req,res)=>{
    const userId=(req as unknown as AuthenticatedRequest).userId!,runId=id.safeParse(req.params.runId);
    if(!runId.success || !new CopilotRunLedger(db,userId).get(runId.data)) {res.status(404).json({code:1,message:'Run not found'});return;}
    const meter=new RunGovernance(db,userId,runId.data);
    res.json({code:0,data:{usage:meter.usage(),calls:meter.calls().map(row=>({id:row.id,runId:row.run_id,kind:row.kind,status:row.status,
      chargedTokens:row.charged_tokens,measurement:row.usage_json?'provider_reported':'estimated',usage:row.usage_json?JSON.parse(row.usage_json):null,
      model:row.model_json?JSON.parse(row.model_json):null,pricing:row.pricing_json?JSON.parse(row.pricing_json):null,
      costUsd:row.cost_nanousd===null?null:row.cost_nanousd/1_000_000_000,createdAt:row.created_at,completedAt:row.completed_at}))},message:''});
  });
  return router;
}
