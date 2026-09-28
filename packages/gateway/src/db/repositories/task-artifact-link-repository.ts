import type {Database} from '../types.js';

export interface ArtifactLinkRow {
 id:string;user_id:string;project_id:string;work_item_id:string;development_task_id:string;
 artifact_digest:string;task_digest:string;artifact_status:'checks_passed'|'checks_failed'|'accepted';
 files_count:number;checks_count:number;passed_checks:number;linked_by:string;linked_at:number;
}
export class TaskArtifactLinkRepository {
 constructor(private readonly db:Database,private readonly userId:string){}
 list(projectId:string,taskId:string):ArtifactLinkRow[]{
  return this.db.prepare('SELECT * FROM project_task_artifact_links WHERE user_id=? AND project_id=? AND work_item_id=? ORDER BY linked_at DESC,id').all(this.userId,projectId,taskId) as ArtifactLinkRow[];
 }
 insert(row:ArtifactLinkRow):void {
  if(row.user_id!==this.userId)throw new Error('ARTIFACT_TENANT_MISMATCH');
  this.db.prepare(`INSERT INTO project_task_artifact_links(id,user_id,project_id,work_item_id,development_task_id,artifact_digest,task_digest,artifact_status,files_count,checks_count,passed_checks,linked_by,linked_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id,this.userId,row.project_id,row.work_item_id,row.development_task_id,row.artifact_digest,row.task_digest,row.artifact_status,row.files_count,row.checks_count,row.passed_checks,row.linked_by,row.linked_at);
 }
}
