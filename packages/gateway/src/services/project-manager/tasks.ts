import type {Database} from '../../db/types.js';
import {ProjectManagerRepository,type ProjectManagerWorkItem,type ProjectManagerEvidenceRef} from '../../db/repositories/project-manager-repository.js';
import {CollaborationRepository} from '../../db/repositories/collaboration-repository.js';
import {assertProjectManagerWrite} from './access.js';
export function mutateAssignedTask(db:Database,actorId:string,projectId:string,id:string|undefined,input:{title?:string|undefined;description?:string|null|undefined;priority?:number|undefined;stageId?:string|null|undefined;acceptanceCriteria?:string[]|undefined;evidenceRefs?:ProjectManagerEvidenceRef[]|undefined;expectedRevision?:number|undefined;assigneeId?:string|null|undefined;reviewerId?:string|null|undefined}) {
 const {access}=assertProjectManagerWrite(db,actorId,projectId),authority=new CollaborationRepository(db,actorId),repo=new ProjectManagerRepository(db,access.userId,actorId);
 authority.assertAssignee(access,input.assigneeId,'assignee');authority.assertAssignee(access,input.reviewerId,'reviewer');
 return db.transaction(()=>{
  if(id)repo.assertRevision(projectId,id,input.expectedRevision);
  const fields={...(input.title!==undefined?{title:input.title}:{}),...(input.description!==undefined?{description:input.description}:{}),...(input.priority!==undefined?{priority:input.priority}:{}),...(input.stageId!==undefined?{stageId:input.stageId}:{}),...(input.acceptanceCriteria!==undefined?{acceptanceCriteria:input.acceptanceCriteria}:{})};
  const existing=id?repo.getWorkItem(projectId,id):undefined;
  const changed=existing&&Object.entries(fields).some(([key,value])=>JSON.stringify(existing[key as keyof ProjectManagerWorkItem])!==JSON.stringify(value));
  const item=id?(changed?repo.updateWorkItem(projectId,id,fields):repo.getWorkItem(projectId,id)!):repo.createWorkItem(projectId,{...fields,title:input.title!,...(input.evidenceRefs?{evidenceRefs:input.evidenceRefs}:{})});
  if(input.assigneeId!==undefined||input.reviewerId!==undefined){
   db.prepare('INSERT OR IGNORE INTO collaboration_tasks(user_id,project_id,work_item_id) VALUES(?,?,?)').run(access.userId,projectId,item.id);
   const old=repo.taskMetadata(projectId,item.id);
   const nextAssignee=input.assigneeId===undefined?old.assigneeId:input.assigneeId,nextReviewer=input.reviewerId===undefined?old.reviewerId:input.reviewerId;
   db.prepare('UPDATE collaboration_tasks SET assignee_id=?,reviewer_id=?,revision=revision+? WHERE user_id=? AND project_id=? AND work_item_id=?').run(nextAssignee,nextReviewer,id&&!changed?1:0,access.userId,projectId,item.id);
   if(nextAssignee!==old.assigneeId||nextReviewer!==old.reviewerId)authority.event(access,item.id,'task_assignment_updated',{assigneeId:nextAssignee,reviewerId:nextReviewer,revision:repo.taskMetadata(projectId,item.id).revision});
  }
  return item;
 })();
}
