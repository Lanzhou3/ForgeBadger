import { z } from 'zod';

export const developmentId = z.string().min(1).max(128);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const sourcePathSchema = z.string().min(1).max(512).refine(value => {
  if (value.startsWith('/') || value.includes('\\') || /[\x00-\x1f\x7f:]/.test(value)) return false;
  return value.split('/').every(p => p.length > 0 && p !== '..' && !p.startsWith('.') && p !== 'node_modules');
}, 'Expected a non-hidden relative source path');
export const developmentPlanSchema = z.object({
  projectId: developmentId,
  goal: z.string().min(1).max(2000),
  sourceFiles: z.array(sourcePathSchema).min(1).max(200),
  changes: z.array(z.object({ path: sourcePathSchema, beforeSha256: sha256Schema.nullable(), content: z.string().max(65536).nullable() }).strict()).min(1).max(64),
  checks: z.array(z.object({ path: sourcePathSchema, sha256: sha256Schema }).strict()).min(1).max(10)
}).strict();
export type DevelopmentPlan = z.infer<typeof developmentPlanSchema>;
export type DevelopmentStatus = 'queued' | 'running' | 'checks_passed' | 'checks_failed' | 'failed' | 'cancelled' | 'indeterminate' | 'accepted';
export interface DevelopmentTaskRow {
  id:string; user_id:string; project_id:string; goal:string; status:DevelopmentStatus;
  plan_json:string; recipe_digest:string; source_digest:string; output_digest:string;
  intent_id:string; origin_run_id:string|null; origin_step_id:string|null;
  project_root:string; workspace_path:string|null; evidence_json:string|null;
  artifact_digest:string|null; error:string|null; owner:string|null; lease_expires_at:number|null;
  cancel_requested:number; revision:number; created_at:number; updated_at:number;
}
export interface DevelopmentEvidence {
  sourceDigest:string; outputDigest:string; recipeDigest:string;
  files:Array<{path:string;beforeSha256:string|null;afterSha256:string|null}>;
  diff:string; checks:Array<{path:string;exitCode:number|null;stdout:string;stderr:string;timedOut:boolean;cancelled:boolean;durationMs:number}>;
  startedAt:number; finishedAt:number;
}
export function taskSummary(row:DevelopmentTaskRow) {
  return {id:row.id,projectId:row.project_id,goal:row.goal,status:row.status,revision:row.revision,
    recipeDigest:row.recipe_digest,sourceDigest:row.source_digest,outputDigest:row.output_digest,
    artifactDigest:row.artifact_digest,error:row.error,createdAt:row.created_at,updatedAt:row.updated_at};
}
