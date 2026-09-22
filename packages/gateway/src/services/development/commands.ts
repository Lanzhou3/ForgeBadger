import { z } from 'zod';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { PlatformActionRepository } from '../../db/repositories/platform-action-repository.js';
import { DevelopmentTaskRepository } from '../../db/repositories/development-task-repository.js';
import { developmentPlanSchema,developmentId,sha256Schema,taskSummary,type DevelopmentEvidence } from './contracts.js';
import { prepareSource,assertWorkspace,hashText } from './workspace.js';
import type { CommandContext,PlatformCommand } from '../platform-commands/types.js';

export const developmentTaskInput=z.object({projectId:developmentId,taskId:developmentId}).strict();
export const developmentAcceptInput=developmentTaskInput.extend({artifactDigest:sha256Schema});
export function ownedProject(ctx:Pick<CommandContext,'db'|'userId'>,projectId:string) {
 const project=new ProjectRepository(ctx.db,ctx.userId).getById(projectId);if(!project)throw new Error('DEVELOPMENT_PROJECT_NOT_FOUND');return project;
}
function taskResources(ctx:CommandContext,raw:unknown) {
 const v=developmentTaskInput.passthrough().parse(raw);ownedProject(ctx,v.projectId);
 const row=new DevelopmentTaskRepository(ctx.db,ctx.userId).get(v.taskId,v.projectId);if(!row)throw new Error('DEVELOPMENT_TASK_NOT_FOUND');
 return {projectIds:[v.projectId],revision:hashText(JSON.stringify([row.id,row.revision,row.status,row.artifact_digest]))};
}
function verifyEvidence(ctx:CommandContext,raw:unknown) {
 const v=developmentAcceptInput.parse(raw),row=new DevelopmentTaskRepository(ctx.db,ctx.userId).get(v.taskId,v.projectId);
 if(!row||row.status!=='checks_passed'||row.artifact_digest!==v.artifactDigest||!row.evidence_json||!row.workspace_path)throw new Error('DEVELOPMENT_ACCEPTANCE_STALE');
 if(hashText(row.evidence_json)!==v.artifactDigest)throw new Error('DEVELOPMENT_ARTIFACT_DRIFT');
 const evidence=JSON.parse(row.evidence_json) as DevelopmentEvidence;
 if(!evidence.checks.length||evidence.checks.some(c=>c.exitCode!==0||c.cancelled||c.timedOut))throw new Error('DEVELOPMENT_CHECKS_NOT_PASSED');
 const prepared=prepareSource(ownedProject(ctx,row.project_id).path,JSON.parse(row.plan_json));
 if(evidence.checks.length!==prepared.plan.checks.length||evidence.checks.some((check,index)=>check.path!==prepared.plan.checks[index]?.path)||evidence.sourceDigest!==row.source_digest||evidence.recipeDigest!==row.recipe_digest)throw new Error('DEVELOPMENT_EVIDENCE_MISMATCH');
 if(prepared.sourceDigest!==row.source_digest||prepared.outputDigest!==row.output_digest||prepared.recipeDigest!==row.recipe_digest||prepared.root!==row.project_root||evidence.outputDigest!==row.output_digest)throw new Error('DEVELOPMENT_SOURCE_DRIFT');
 assertWorkspace(row.workspace_path,prepared);return row;
}
export function createDevelopmentCommands():PlatformCommand[] {
 return [{id:'development.task.submit',capability:'development.task.submit',effect:'database',delegatable:false,inputSchema:developmentPlanSchema,
  resolve(ctx,raw){const plan=developmentPlanSchema.parse(raw),p=prepareSource(ownedProject(ctx,plan.projectId).path,plan);return {projectIds:[plan.projectId],rootPaths:[p.root],revision:hashText(JSON.stringify([p.root,p.sourceDigest,p.outputDigest,p.recipeDigest]))};},
  execute(ctx,raw){
   const plan=developmentPlanSchema.parse(raw),p=prepareSource(ownedProject(ctx,plan.projectId).path,plan);
   const intent=ctx.actionIntentId?new PlatformActionRepository(ctx.db,ctx.userId).get(ctx.actionIntentId):undefined;
   if(!intent||intent.status!=='executing'||intent.authority!=='owner_action'||intent.grant_id||!['copilot','owner_api'].includes(intent.origin_kind))throw new Error('DEVELOPMENT_APPROVAL_REQUIRED');
   const task=new DevelopmentTaskRepository(ctx.db,ctx.userId).create({project_id:plan.projectId,goal:plan.goal,plan_json:JSON.stringify(plan),recipe_digest:p.recipeDigest,source_digest:p.sourceDigest,output_digest:p.outputDigest,intent_id:intent.id,origin_run_id:intent.origin_run_id,origin_step_id:intent.origin_step_id,project_root:p.root});
   return {taskId:task.id,recipeDigest:task.recipe_digest,status:task.status};
  }},
  {id:'development.task.cancel',capability:'development.task.cancel',effect:'database',delegatable:false,inputSchema:developmentTaskInput,resolve:taskResources,execute(ctx,raw){const v=developmentTaskInput.parse(raw);return taskSummary(new DevelopmentTaskRepository(ctx.db,ctx.userId).cancel(v.taskId,v.projectId));}},
  {id:'development.task.accept',capability:'development.task.accept',effect:'database',delegatable:false,inputSchema:developmentAcceptInput,resolve(ctx,raw){verifyEvidence(ctx,raw);return taskResources(ctx,raw);},execute(ctx,raw){const row=verifyEvidence(ctx,raw);return taskSummary(new DevelopmentTaskRepository(ctx.db,ctx.userId).accept(row.id,row.project_id,row.artifact_digest!));}}
 ];
}
