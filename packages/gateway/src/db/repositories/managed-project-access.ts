import {actorGeneration,teamProjectAuthority,isEnrolled,hasTeams} from './team-authority.js';
import { realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Database } from '../types.js';

function canonical(value:string):string {
 let ancestor=path.resolve(value);const suffix:string[]=[];
 while(!existsSync(ancestor)&&path.dirname(ancestor)!==ancestor) { suffix.unshift(path.basename(ancestor));ancestor=path.dirname(ancestor); }
 try { return path.join(realpathSync(ancestor),...suffix); } catch { return path.resolve(value); }
}
function contains(root:string,target:string):boolean {
 const relative=path.relative(root,target);
 return relative==='' || (!relative.startsWith(`..${path.sep}`) && relative!=='..' && !path.isAbsolute(relative));
}
function overlaps(a:string,b:string):boolean { return contains(a,b)||contains(b,a); }
function enabled(db:Database):boolean { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='delivery_runs'").get(); }
interface ManagedRow {actor_id:string;user_id:string;project_id:string;membership_revision:number;state:string;workspace_path:string}

/** Path-based guard also covers aliases/imports of managed projects through legacy private APIs. */
export function canUseProjectPath(db:Database,actorId:string,projectPath:string,provisioning=false, internalOperation=false):boolean {
 if(!enabled(db)) return true; // Pre-feature fixtures/DBs cannot contain managed executions.
 const target=canonical(projectPath);
 const managed=db.prepare('SELECT actor_id,user_id,project_id,membership_revision,state,workspace_path FROM delivery_runs').all() as ManagedRow[];
 for(const row of managed) {
  if(!overlaps(row.workspace_path,target) && !overlaps(row.workspace_path,path.resolve(projectPath))) continue;
  if(!internalOperation && db.prepare('SELECT 1 FROM delivery_operations WHERE run_id=(SELECT id FROM delivery_runs WHERE workspace_path=?)').get(row.workspace_path)) return false;
  if(row.actor_id!==actorId || !contains(row.workspace_path,target)) return false;
  if(canonical(row.workspace_path)!==row.workspace_path) return false;
  if(row.state!=='ready' && !(provisioning&&row.state==='provisioning')) return false;
  if(!db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(actorId)) return false;
  const source=db.prepare(`SELECT p.path,c.protected_root,c.execution_enabled FROM projects p JOIN collaboration_projects c ON c.project_id=p.id AND c.user_id=p.user_id
   WHERE p.id=? AND p.user_id=? AND p.status='active'`).get(row.project_id,row.user_id) as {path:string;protected_root:string;execution_enabled:number}|undefined;
  if(!source?.execution_enabled || canonical(source.path)!==source.protected_root) return false;
  try {
   const team=teamProjectAuthority(db,actorId,row.project_id);
   const epoch=hasTeams(db)?(db.prepare('SELECT authority_epoch FROM delivery_runs WHERE workspace_path=?').get(row.workspace_path) as {authority_epoch:string}).authority_epoch:'';
   if(team) { if(!team.capabilities.includes('develop')||team.membershipRevision!==row.membership_revision||team.authorityEpoch!==epoch)return false; }
   else {
    if(!db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(row.user_id))return false;
    const generation=actorGeneration(db,actorId),expected=generation?JSON.stringify(['personal',generation]):'';
    if(epoch!==expected)return false;
    if(actorId!==row.user_id && !db.prepare("SELECT 1 FROM collaboration_members WHERE user_id=? AND project_id=? AND member_id=? AND role='developer' AND state='active' AND revision=?").get(row.user_id,row.project_id,actorId,row.membership_revision))return false;
   }
  } catch {return false;}
 }
 const roots=db.prepare('SELECT user_id,project_id,protected_root FROM collaboration_projects').all() as Array<{user_id:string;project_id:string;protected_root:string}>;
 for(const root of roots) if(overlaps(root.protected_root,target)) {
  if(isEnrolled(db,root.project_id)||root.user_id!==actorId) return false;
  if(!internalOperation&&db.prepare("SELECT 1 FROM delivery_operations o JOIN collaboration_projects c ON c.project_id=o.project_id WHERE c.protected_root=? AND o.kind='integrate'").get(root.protected_root)) return false;
 }
 return true;
}
export function assertProjectPathAccess(db:Database,actorId:string,projectPath:string,provisioning=false):void {
 if(!canUseProjectPath(db,actorId,projectPath,provisioning)) throw new Error('MANAGED_PROJECT_ACCESS_DENIED');
}
/** Call before protecting a source. Existing foreign ancestor registrations must be resolved explicitly. */
export function protectableRoot(db:Database,ownerId:string,projectPath:string):string {
 const root=realpathSync(projectPath);
 const projects=db.prepare('SELECT user_id,path FROM projects WHERE user_id!=?').all(ownerId) as Array<{user_id:string;path:string}>;
 if(projects.some(p=>overlaps(root,canonical(p.path)))) throw new Error('PROJECT_PATH_OWNERSHIP_CONFLICT');
 return root;
}
export function hasDeliveryHistory(db:Database,kind:'project'|'session'|'task',id:string):boolean {
 if(!enabled(db)) return false;
 const query=kind==='project'?'SELECT 1 FROM delivery_runs WHERE project_id=? OR workspace_project_id=?':kind==='session'?'SELECT 1 FROM delivery_runs WHERE session_id=?':'SELECT 1 FROM delivery_runs WHERE work_item_id=?';
 return !!(kind==='project'?db.prepare(query).get(id,id):db.prepare(query).get(id));
}

/** Legacy create/import cannot add unmanaged aliases or extra terminals to an execution. */
export function assertNewProjectResource(db:Database,actorId:string,projectPath:string,runId?:string):void {
 assertProjectPathAccess(db,actorId,projectPath,!!runId);
 if(!enabled(db)) return;
 const target=canonical(projectPath);
 const rows=db.prepare('SELECT id,actor_id,state,workspace_path FROM delivery_runs').all() as Array<{id:string;actor_id:string;state:string;workspace_path:string}>;
 for(const run of rows) if(overlaps(run.workspace_path,target) || overlaps(run.workspace_path,path.resolve(projectPath))) {
  if(run.id!==runId || run.actor_id!==actorId || run.state!=='provisioning' || run.workspace_path!==target) throw new Error('MANAGED_WORKSPACE_REQUIRES_TASK_WORKFLOW');
 }
}

export function assertManagedSessionAccess(db:Database,actorId:string,sessionId:string,cwd:string):void {
 assertProjectPathAccess(db,actorId,cwd);
 if(!enabled(db)) return;
 const target=canonical(cwd);
 const rows=db.prepare('SELECT session_id,workspace_path FROM delivery_runs').all() as Array<{session_id:string|null;workspace_path:string}>;
 for(const row of rows) if(overlaps(row.workspace_path,target) && row.session_id!==sessionId) throw new Error('MANAGED_SESSION_IDENTITY_REQUIRED');
}
