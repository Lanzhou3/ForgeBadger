import { randomUUID,createHash } from 'node:crypto';
import type { Database } from '../types.js';
import type { DevelopmentTaskRow, DevelopmentStatus, DevelopmentEvidence } from '../../services/development/contracts.js';
const hashText=(value:string)=>createHash('sha256').update(value).digest('hex');

export class DevelopmentTaskRepository {
 constructor(private db:Database,readonly userId:string){}
 get(id:string,projectId?:string):DevelopmentTaskRow|undefined {
  const row=this.db.prepare('SELECT * FROM copilot_development_tasks WHERE user_id=? AND id=?').get(this.userId,id) as DevelopmentTaskRow|undefined;
  return row&&(!projectId||row.project_id===projectId)?row:undefined;
 }
 list(projectId:string,limit=50):DevelopmentTaskRow[]{return this.db.prepare('SELECT * FROM copilot_development_tasks WHERE user_id=? AND project_id=? ORDER BY created_at DESC LIMIT ?').all(this.userId,projectId,limit) as DevelopmentTaskRow[];}
 create(input:Pick<DevelopmentTaskRow,'project_id'|'goal'|'plan_json'|'recipe_digest'|'source_digest'|'output_digest'|'intent_id'|'origin_run_id'|'origin_step_id'|'project_root'>) {
  if((this.db.prepare('SELECT COUNT(*) n FROM copilot_development_tasks WHERE user_id=?').get(this.userId) as {n:number}).n>=100)throw new Error('DEVELOPMENT_RETENTION_LIMIT');
  const id=randomUUID(),now=Date.now();
  this.db.prepare(`INSERT INTO copilot_development_tasks(id,user_id,project_id,goal,status,plan_json,recipe_digest,source_digest,output_digest,intent_id,origin_run_id,origin_step_id,project_root,created_at,updated_at) VALUES (?,?,?,?,'queued',?,?,?,?,?,?,?,?,?,?)`).run(id,this.userId,input.project_id,input.goal,input.plan_json,input.recipe_digest,input.source_digest,input.output_digest,input.intent_id,input.origin_run_id,input.origin_step_id,input.project_root,now,now);
  const row=this.get(id)!;this.event(row);return row;
 }
 claim(owner:string,leaseMs=15000) {
  try {return this.db.transaction(()=>{
   const row=this.db.prepare("SELECT * FROM copilot_development_tasks WHERE user_id=? AND status='queued' ORDER BY created_at LIMIT 1").get(this.userId) as DevelopmentTaskRow|undefined;
   if(!row)return undefined;const now=Date.now();
   const changed=this.db.prepare("UPDATE copilot_development_tasks SET status='running',owner=?,lease_expires_at=?,revision=revision+1,updated_at=? WHERE user_id=? AND id=? AND status='queued'").run(owner,now+leaseMs,now,this.userId,row.id).changes;
   if(!changed)return undefined;const next=this.get(row.id)!;this.event(next);return next;
  }).immediate();}catch(error){if((error as {code?:string}).code==='SQLITE_CONSTRAINT_UNIQUE')return undefined;throw error;}
 }
 owns(id:string,owner:string){const r=this.get(id);return !!r&&r.status==='running'&&r.owner===owner&&(r.lease_expires_at??0)>Date.now()&&!r.cancel_requested;}
 renew(id:string,owner:string,leaseMs=15000){return this.db.prepare("UPDATE copilot_development_tasks SET lease_expires_at=? WHERE user_id=? AND id=? AND owner=? AND status='running' AND cancel_requested=0 AND lease_expires_at>?").run(Date.now()+leaseMs,this.userId,id,owner,Date.now()).changes===1;}
 setWorkspace(id:string,owner:string,directory:string){if(!this.owns(id,owner))throw new Error('DEVELOPMENT_LEASE_LOST');this.db.prepare('UPDATE copilot_development_tasks SET workspace_path=? WHERE user_id=? AND id=? AND owner=?').run(directory,this.userId,id,owner);}
 finish(id:string,owner:string,status:DevelopmentStatus,evidence?:DevelopmentEvidence,error?:string) {
  return this.db.transaction(()=>{
   const row=this.get(id);if(!row||row.status!=='running'||row.owner!==owner||(row.lease_expires_at??0)<=Date.now())return false;
   const json=evidence?JSON.stringify(evidence):null;
   const final=row.cancel_requested?'cancelled':status;
   this.db.prepare('UPDATE copilot_development_tasks SET status=?,evidence_json=?,artifact_digest=?,error=?,owner=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=? WHERE user_id=? AND id=? AND owner=?').run(final,json,json?hashText(json):null,error??null,Date.now(),this.userId,id,owner);
   this.event(this.get(id)!);return true;
  }).immediate();
 }
 cancel(id:string,projectId:string) {
  return this.db.transaction(()=>{const row=this.get(id,projectId);if(!row)throw new Error('DEVELOPMENT_TASK_NOT_FOUND');
   if(row.status==='running'){this.db.prepare('UPDATE copilot_development_tasks SET cancel_requested=1,revision=revision+1,updated_at=? WHERE user_id=? AND id=?').run(Date.now(),this.userId,id);}
   else if(row.status==='queued'){this.db.prepare("UPDATE copilot_development_tasks SET status='cancelled',cancel_requested=1,revision=revision+1,updated_at=? WHERE user_id=? AND id=?").run(Date.now(),this.userId,id);}
   else if(row.status==='indeterminate')throw new Error('DEVELOPMENT_RECONCILIATION_REQUIRED');
   this.event(this.get(id)!);return this.get(id)!;
  }).immediate();
 }
 accept(id:string,projectId:string,digest:string){return this.db.transaction(()=>{
  const row=this.get(id,projectId);if(!row||row.status!=='checks_passed'||row.artifact_digest!==digest)throw new Error('DEVELOPMENT_ACCEPTANCE_STALE');
  this.db.prepare("UPDATE copilot_development_tasks SET status='accepted',revision=revision+1,updated_at=? WHERE user_id=? AND id=? AND status='checks_passed'").run(Date.now(),this.userId,id);this.event(this.get(id)!);return this.get(id)!;
 }).immediate();}
 recover(now=Date.now()) {return this.db.transaction(()=>{
  const rows=this.db.prepare("SELECT id FROM copilot_development_tasks WHERE user_id=? AND status='running' AND lease_expires_at<=?").all(this.userId,now) as {id:string}[];
  for(const row of rows){this.db.prepare("UPDATE copilot_development_tasks SET status='indeterminate',error='Execution interrupted; automatic replay prohibited',revision=revision+1,updated_at=? WHERE user_id=? AND id=? AND status='running'").run(now,this.userId,row.id);this.event(this.get(row.id)!);}return rows.length;
 }).immediate();}
 private event(row:DevelopmentTaskRow){this.db.prepare('INSERT OR IGNORE INTO copilot_development_events(id,user_id,task_id,revision,status,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(),this.userId,row.id,row.revision,row.status,Date.now());}
 pendingEvents(){return this.db.prepare('SELECT id,task_id,revision,status FROM copilot_development_events WHERE user_id=? AND delivered_at IS NULL ORDER BY created_at LIMIT 100').all(this.userId) as {id:string;task_id:string;revision:number;status:string}[];}
 delivered(id:string){this.db.prepare('UPDATE copilot_development_events SET delivered_at=? WHERE user_id=? AND id=? AND delivered_at IS NULL').run(Date.now(),this.userId,id);}
}
