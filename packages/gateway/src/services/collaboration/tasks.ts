import { createHash } from 'node:crypto';
import { CollaborationRepository } from '../../db/repositories/collaboration-repository.js';
import { ProjectManagerRepository, type ProjectManagerWorkItem } from '../../db/repositories/project-manager-repository.js';
import type { Database } from '../../db/types.js';
import { CollaborationError, type CollaborationAccess } from './types.js';
export interface TaskInput { title:string; description?:string|undefined; acceptanceCriteria:string[]; assigneeId?:string|null|undefined; reviewerId?:string|null|undefined }
export interface TaskPatch { expectedRevision:number; title?:string|undefined; description?:string|undefined; acceptanceCriteria?:string[]|undefined; assigneeId?:string|null|undefined; reviewerId?:string|null|undefined }
export interface CollaborationTask { id:string; title:string; description:string|null; status:ProjectManagerWorkItem['status']; acceptanceCriteria:string[]; revision:number; semanticRevision:number; assigneeId:string|null; reviewerId:string|null }
interface Metadata { revision:number; semantic_revision:number; assignee_id:string|null; reviewer_id:string|null }
export class CollaborationTasks {
 private readonly authority:CollaborationRepository;
 constructor(private readonly db:Database,private readonly actorId:string) { this.authority=new CollaborationRepository(db,actorId); }
 list(access:CollaborationAccess):CollaborationTask[] { return new ProjectManagerRepository(this.db,access.userId,this.actorId).listWorkItems(access.projectId).map(item=>this.dto(access,item)); }
 get(access:CollaborationAccess,id:string):CollaborationTask {
  const item=new ProjectManagerRepository(this.db,access.userId,this.actorId).getWorkItem(access.projectId,id);
  if(!item) throw new CollaborationError(404,'TASK_NOT_FOUND');
  return this.dto(access,item);
 }
 create(projectId:string,input:TaskInput):CollaborationTask {
  const access=this.authority.access(projectId);
  if(!access.capabilities.includes('develop')&&!access.capabilities.includes('manage'))throw new CollaborationError(403,'PROJECT_CAPABILITY_DENIED');
  this.assertAssignments(access,input);
  return this.db.transaction(()=>{
   const item=new ProjectManagerRepository(this.db,access.userId,this.actorId).createWorkItem(projectId,{title:input.title,description:input.description,acceptanceCriteria:input.acceptanceCriteria,details:{collaboration:true}});
   this.db.prepare('INSERT INTO collaboration_tasks(user_id,project_id,work_item_id,assignee_id,reviewer_id) VALUES(?,?,?,?,?)').run(access.userId,projectId,item.id,input.assigneeId??null,input.reviewerId??null);
   this.authority.event(access,item.id,'task_created',{title:input.title});
   return this.dto(access,item);
  })();
 }
 update(projectId:string,id:string,input:TaskPatch):CollaborationTask {
  const access=this.authority.access(projectId);
  if(!access.capabilities.includes('develop')&&!access.capabilities.includes('manage'))throw new CollaborationError(403,'PROJECT_CAPABILITY_DENIED');
  this.assertAssignments(access,input);
  return this.db.transaction(()=>{
   const current=this.get(access,id);
   if(current.revision!==input.expectedRevision) throw new CollaborationError(409,'STALE_TASK_REVISION');
   this.db.prepare('INSERT OR IGNORE INTO collaboration_tasks(user_id,project_id,work_item_id) VALUES(?,?,?)').run(access.userId,projectId,id);
   this.db.prepare('UPDATE collaboration_tasks SET assignee_id=?,reviewer_id=? WHERE user_id=? AND project_id=? AND work_item_id=? AND revision=?')
    .run(input.assigneeId===undefined?current.assigneeId:input.assigneeId,input.reviewerId===undefined?current.reviewerId:input.reviewerId,access.userId,projectId,id,input.expectedRevision);
   const repository=new ProjectManagerRepository(this.db,access.userId,this.actorId);
   const changed=(input.title!==undefined&&input.title!==current.title)||(input.description!==undefined&&input.description!==current.description)||(input.acceptanceCriteria!==undefined&&JSON.stringify(input.acceptanceCriteria)!==JSON.stringify(current.acceptanceCriteria));
   const item=changed?repository.updateWorkItem(projectId,id,{
    ...(input.title!==undefined?{title:input.title}:{}),...(input.description!==undefined?{description:input.description}:{}),...(input.acceptanceCriteria!==undefined?{acceptanceCriteria:input.acceptanceCriteria}:{})}):repository.getWorkItem(projectId,id)!;
   if(!changed)this.db.prepare('UPDATE collaboration_tasks SET revision=revision+1 WHERE user_id=? AND project_id=? AND work_item_id=?').run(access.userId,projectId,id);
   this.authority.event(access,id,'task_updated',{revision:input.expectedRevision+1});
   return this.dto(access,item);
  })();
 }
 progress(access:CollaborationAccess,id:string,status:'in_progress'|'ready_for_review'|'done',evidence?:{runId:string;commit:string}) {
  const repository=new ProjectManagerRepository(this.db,access.userId,this.actorId),task=repository.getWorkItem(access.projectId,id);
  if(!task || task.status===status || ['done','cancelled'].includes(task.status)) return;
  if((task.status==='todo'||task.status==='blocked')&&status!=='in_progress') repository.updateWorkItemStatus(access.projectId,id,{status:'in_progress'});
  repository.updateWorkItemStatus(access.projectId,id,{status,...(evidence?{evidenceRefs:[{kind:'delivery',label:'Verified and accepted delivery',ref:evidence.commit,status:'passed'}],details:{deliveryRunId:evidence.runId}}:{})});
 }
 comment(projectId:string,id:string,text:string) {
  const access=this.authority.access(projectId,'comment');this.get(access,id);
  const eventId=this.authority.event(access,id,'comment',{text});
  return this.comments(access,id).find(c=>c.id===eventId)!;
 }
 comments(access:CollaborationAccess,id:string) {
  return this.authority.events(access,id).filter(e=>e.kind==='comment').reverse().map(e=>({id:e.id,actorId:e.actorId,actorLabel:e.actorLabel,text:String(e.body.text??''),createdAt:e.createdAt}));
 }
 digest(access:CollaborationAccess,id:string):string {
  const task=this.get(access,id);
  return createHash('sha256').update(JSON.stringify({title:task.title,description:task.description,acceptanceCriteria:task.acceptanceCriteria,assigneeId:task.assigneeId,reviewerId:task.reviewerId,semanticRevision:task.semanticRevision})).digest('hex');
 }
 private dto(access:CollaborationAccess,item:ProjectManagerWorkItem):CollaborationTask {
  const meta=this.db.prepare('SELECT revision,semantic_revision,assignee_id,reviewer_id FROM collaboration_tasks WHERE user_id=? AND project_id=? AND work_item_id=?').get(access.userId,access.projectId,item.id) as Metadata|undefined;
  return {id:item.id,title:item.title,description:item.description,status:item.status,acceptanceCriteria:item.acceptanceCriteria,revision:meta?.revision??1,semanticRevision:meta?.semantic_revision??1,assigneeId:meta?.assignee_id??null,reviewerId:meta?.reviewer_id??null};
 }
 private assertAssignments(access:CollaborationAccess,input:Pick<TaskInput,'assigneeId'|'reviewerId'>) {
  this.authority.assertAssignee(access,input.assigneeId,'assignee');this.authority.assertAssignee(access,input.reviewerId,'reviewer');
 }
}
