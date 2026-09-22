import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Database} from '../../db/types.js';
import {CollaborationRepository} from '../../db/repositories/collaboration-repository.js';
import {DevelopmentTaskRepository} from '../../db/repositories/development-task-repository.js';
import {ProjectRepository} from '../../db/repositories/project-repository.js';
import {TaskArtifactLinkRepository,type ArtifactLinkRow} from '../../db/repositories/task-artifact-link-repository.js';
import {CollaborationTasks} from '../collaboration/tasks.js';
import {CollaborationError,type CollaborationAccess} from '../collaboration/types.js';
import type {DevelopmentTaskRow} from '../development/contracts.js';

export const artifactLinkInput=z.object({developmentTaskId:z.string().uuid(),artifactDigest:z.string().regex(/^[a-f0-9]{64}$/),expectedTaskRevision:z.number().int().positive(),shareSummary:z.literal(true)}).strict();
const evidenceSummary=z.object({files:z.array(z.object({}).passthrough()).max(200),checks:z.array(z.object({exitCode:z.number().int().nullable(),timedOut:z.boolean(),cancelled:z.boolean()}).passthrough()).max(10)}).passthrough();
const completed=z.enum(['checks_passed','checks_failed','accepted']);
function summary(row:DevelopmentTaskRow){
 if(!row.evidence_json||!row.artifact_digest||!completed.safeParse(row.status).success)return null;
 if(createHash('sha256').update(row.evidence_json).digest('hex')!==row.artifact_digest)return null;
 try{const evidence=evidenceSummary.parse(JSON.parse(row.evidence_json));return {developmentTaskId:row.id,artifactDigest:row.artifact_digest,status:completed.parse(row.status),filesCount:evidence.files.length,checksCount:evidence.checks.length,passedChecks:evidence.checks.filter(c=>c.exitCode===0&&!c.timedOut&&!c.cancelled).length};}catch{return null;}
}

/** An explicit summary reference, never authority to execute, accept or merge an artifact. */
export class TaskArtifactLinks {
 constructor(private readonly db:Database,private readonly actorId:string){}
 list(projectId:string,taskId:string){
  const authority=new CollaborationRepository(this.db,this.actorId),access=authority.access(projectId);
  const tasks=new CollaborationTasks(this.db,this.actorId),digest=tasks.digest(access,taskId);
  const repo=new TaskArtifactLinkRepository(this.db,access.userId);
  const candidates=access.capabilities.includes('develop')?new DevelopmentTaskRepository(this.db,this.actorId).list(projectId).filter(r=>r.project_root===access.path).flatMap(r=>{const s=summary(r);return s?[s]:[];}):[];
  return {artifacts:repo.list(projectId,taskId).map(row=>this.dto(access,row,digest)),candidates};
 }
 link(projectId:string,taskId:string,raw:z.infer<typeof artifactLinkInput>){
  const input=artifactLinkInput.parse(raw);
  return this.db.transaction(()=>{
   const authority=new CollaborationRepository(this.db,this.actorId),access=authority.access(projectId,'develop');
   const tasks=new CollaborationTasks(this.db,this.actorId),task=tasks.get(access,taskId);
   if(task.revision!==input.expectedTaskRevision)throw new CollaborationError(409,'STALE_TASK_REVISION');
   const artifact=new DevelopmentTaskRepository(this.db,this.actorId).get(input.developmentTaskId,projectId);
   const safe=artifact&&artifact.project_root===access.path?summary(artifact):null;
   if(!safe||safe.artifactDigest!==input.artifactDigest)throw new CollaborationError(409,'ARTIFACT_UNAVAILABLE_OR_STALE');
   const repo=new TaskArtifactLinkRepository(this.db,access.userId),digest=tasks.digest(access,taskId);
   const existing=repo.list(projectId,taskId).find(r=>r.development_task_id===safe.developmentTaskId&&r.artifact_digest===safe.artifactDigest);
   if(existing){
    if(existing.task_digest!==digest)throw new CollaborationError(409,'ARTIFACT_LINK_STALE');
    return this.dto(access,existing,digest);
   }
   const row:ArtifactLinkRow={id:randomUUID(),user_id:access.userId,project_id:projectId,work_item_id:taskId,development_task_id:safe.developmentTaskId,artifact_digest:safe.artifactDigest,task_digest:digest,artifact_status:safe.status,files_count:safe.filesCount,checks_count:safe.checksCount,passed_checks:safe.passedChecks,linked_by:this.actorId,linked_at:Date.now()};
   repo.insert(row);authority.event(access,taskId,'copilot_artifact_linked',{linkId:row.id,artifactDigest:row.artifact_digest});
   return this.dto(access,row,digest);
  })();
 }
 private dto(access:CollaborationAccess,row:ArtifactLinkRow,taskDigest:string){
  const source=new DevelopmentTaskRepository(this.db,row.user_id).get(row.development_task_id,row.project_id),safe=source?summary(source):null;
  const canOpen=this.actorId===row.user_id&&!!new ProjectRepository(this.db,this.actorId).getById(row.project_id);
  return {id:row.id,developmentTaskId:row.development_task_id,artifactDigest:row.artifact_digest,status:row.artifact_status,filesCount:row.files_count,checksCount:row.checks_count,passedChecks:row.passed_checks,linkedAt:row.linked_at,
   current:row.task_digest===taskDigest&&safe?.artifactDigest===row.artifact_digest&&source?.project_root===access.path,canOpen};
 }
}
