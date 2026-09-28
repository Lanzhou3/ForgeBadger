import {actorGeneration,teamProjectAuthority,isEnrolled,teamAccess} from './team-authority.js';
import { realpathSync } from 'node:fs';
import { protectableRoot } from './managed-project-access.js';
import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
import { CollaborationError, type Capability, type CollaborationAccess, type CollaborationRole, type MemberRole, type VerificationPolicy } from '../../services/collaboration/types.js';

const roles: Record<Capability, readonly CollaborationRole[]> = {
 read:['owner','developer','reviewer','viewer'], comment:['owner','developer','reviewer'],
 develop:['owner','developer'], review:['owner','reviewer'], manage:['owner'],
};
interface AccessRow { id:string; user_id:string; name:string; path:string; member_role:MemberRole|null; member_revision:number|null; owner_status:string; actor_status:string }
export interface MemberRow { userId:string; email:string; displayName:string|null; role:CollaborationRole; state:string; revision:number }
export interface ProjectPolicy { revision:number; executionEnabled:boolean; verification:VerificationPolicy|null; verificationRevision:number }

/** The only shared-project authority lookup. Actor identity is never replaced by owner identity. */
export class CollaborationRepository {
 constructor(private readonly db:Database, readonly actorId:string) {}
 access(projectId:string, capability:Capability = 'read'):CollaborationAccess {
  const team=teamProjectAuthority(this.db,this.actorId,projectId);
  const row = this.db.prepare(`SELECT p.id,p.user_id,p.name,p.path,m.role AS member_role,m.revision AS member_revision,
    owner.status AS owner_status,actor.status AS actor_status FROM projects p
    JOIN users owner ON owner.id=p.user_id JOIN users actor ON actor.id=@actor
    LEFT JOIN collaboration_members m ON m.project_id=p.id AND m.user_id=p.user_id AND m.member_id=@actor AND m.state='active'
    WHERE p.id=@project AND p.status='active' AND (p.user_id=@actor OR m.member_id IS NOT NULL OR @team=1)
    AND NOT EXISTS(SELECT 1 FROM delivery_runs r WHERE r.workspace_project_id=p.id)`)
   .get({actor:this.actorId,project:projectId,team:team?1:0}) as AccessRow|undefined;
  if (!row || (!team&&row.owner_status!=='active') || row.actor_status!=='active') throw new CollaborationError(404,'PROJECT_NOT_FOUND');
  const role:CollaborationRole = team?.role ?? (row.user_id===this.actorId ? 'owner' : row.member_role!);
  const capabilities=team?.capabilities ?? (Object.keys(roles) as Capability[]).filter(key=>roles[key].includes(role));
  if (!capabilities.includes(capability)) throw new CollaborationError(403,'PROJECT_CAPABILITY_DENIED');
  let root:string;
  try { root=realpathSync(row.path); } catch { throw new CollaborationError(409,'PROJECT_DIRECTORY_UNAVAILABLE'); }
  const protection=this.db.prepare('SELECT protected_root FROM collaboration_projects WHERE user_id=? AND project_id=?').get(row.user_id,row.id) as {protected_root:string}|undefined;
  if(protection && protection.protected_root!==root) throw new CollaborationError(409,'PROJECT_DIRECTORY_CHANGED');
  return {userId:row.user_id,actorId:this.actorId,projectId:row.id,role,capabilities,teamId:team?.teamId??null,logicalOwnerId:team?.logicalOwnerId??row.user_id,authorityEpoch:team?.authorityEpoch??(actorGeneration(this.db,this.actorId)?JSON.stringify(['personal',actorGeneration(this.db,this.actorId)]):''),membershipRevision:team?.membershipRevision??(role==='owner'?0:row.member_revision!),path:root,name:row.name};
 }
 list() {
  const projects=this.db.prepare("SELECT id,name,description FROM projects WHERE status='active' AND NOT EXISTS(SELECT 1 FROM delivery_runs r WHERE r.workspace_project_id=projects.id)").all() as Array<{id:string;name:string;description:string|null}>;
  return projects.flatMap(project=>{try{const access=this.access(project.id);return [{...project,role:access.role,teamId:access.teamId,logicalOwnerId:access.logicalOwnerId,capabilities:access.capabilities,memberCount:this.members(access).filter(m=>m.role!=='owner'&&m.state==='active').length}];}catch{return [];}});
 }

 policy(access:CollaborationAccess):ProjectPolicy {
  const row=this.db.prepare('SELECT * FROM collaboration_projects WHERE user_id=? AND project_id=?').get(access.userId,access.projectId) as
   {revision:number;execution_enabled:number;verification_json:string|null;verification_revision:number}|undefined;
  return row ? {revision:row.revision,executionEnabled:!!row.execution_enabled,verification:row.verification_json?JSON.parse(row.verification_json) as VerificationPolicy:null,verificationRevision:row.verification_revision}
   : {revision:0,executionEnabled:false,verification:null,verificationRevision:0};
 }
 disableExecution(projectId:string, expectedRevision:number) {
  const access=this.access(projectId,'manage');
  return this.db.transaction(()=>{
   this.ensureProtection(access);
   const result=this.db.prepare(`UPDATE collaboration_projects SET revision=revision+1,execution_enabled=0,verification_revision=verification_revision+1
    WHERE user_id=? AND project_id=? AND revision=?`).run(access.userId,projectId,expectedRevision);
   if (!result.changes) throw new CollaborationError(409,'STALE_PROJECT_REVISION');
   this.event(access,null,'execution_disabled',{executionEnabled:false});
   return this.policy(access);
  })();
 }
 private ensureProtection(access:CollaborationAccess) {
  let root:string;
  try { root=protectableRoot(this.db,access.userId,access.path); } catch { throw new CollaborationError(409,'PROJECT_PATH_OWNERSHIP_CONFLICT'); }
  this.db.prepare('INSERT OR IGNORE INTO collaboration_projects(project_id,user_id,protected_root) VALUES(?,?,?)').run(access.projectId,access.userId,root);
 }
 members(access:CollaborationAccess):MemberRow[] {
  if(access.teamId) return this.teamMembers(access);
  return this.db.prepare(`SELECT u.id AS userId,u.email,u.display_name AS displayName,'owner' AS role,'active' AS state,0 AS revision
   FROM users u WHERE u.id=@owner UNION ALL SELECT u.id AS userId,u.email,u.display_name AS displayName,m.role,m.state,m.revision
   FROM collaboration_members m JOIN users u ON u.id=m.member_id WHERE m.user_id=@owner AND m.project_id=@project AND m.state!='revoked'`)
   .all({owner:access.userId,project:access.projectId}) as MemberRow[];
 }
 private teamMembers(access:CollaborationAccess):MemberRow[] {
  const rows=this.db.prepare(`SELECT u.id AS userId,u.email,u.display_name AS displayName,
   CASE WHEN u.id=@owner THEN 'owner' ELSE c.role END AS role,c.state,c.revision
   FROM collaboration_members c JOIN users u ON u.id=c.member_id JOIN team_members tm ON tm.member_id=u.id AND tm.team_id=@team
   WHERE c.project_id=@project AND c.user_id=@storage AND c.state!='revoked' AND tm.state='active' AND u.status='active'`).all({owner:access.logicalOwnerId,team:access.teamId,project:access.projectId,storage:access.userId}) as MemberRow[];
  if(!rows.some(r=>r.userId===access.logicalOwnerId)) {
   const owner=this.db.prepare("SELECT id AS userId,email,display_name AS displayName,'owner' AS role,'active' AS state,0 AS revision FROM users u WHERE id=? AND status='active' AND EXISTS(SELECT 1 FROM team_members m WHERE m.member_id=u.id AND m.team_id=? AND m.state='active')").get(access.logicalOwnerId,access.teamId) as MemberRow|undefined;
   if(owner)rows.unshift(owner);
  }
  return rows;
 }
 putMember(projectId:string,email:string,role:MemberRole) {
  const access=this.access(projectId,'manage');
  this.ensureProtection(access);
  const user=this.db.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND status='active'").get(email) as {id:string}|undefined;
  if(!user) throw new CollaborationError(404,'ACTIVE_MEMBER_ACCOUNT_NOT_FOUND');
  if(access.teamId) teamAccess(this.db,user.id,access.teamId);
  if(user.id===access.logicalOwnerId) throw new CollaborationError(400,'OWNER_ROLE_IS_IMPLICIT');
  const old=this.db.prepare('SELECT role,state FROM collaboration_members WHERE user_id=? AND project_id=? AND member_id=?').get(access.userId,projectId,user.id) as {role:MemberRole;state:string}|undefined;
  if(old?.state==='active' && old.role===role) return this.members(access);
  if(old?.state==='revoking') throw new CollaborationError(409,'MEMBER_REVOCATION_PENDING');
  if(old?.state==='active' && old.role!==role && this.db.prepare("SELECT 1 FROM delivery_runs WHERE user_id=? AND project_id=? AND actor_id=? AND state IN ('provisioning','ready','revoking')").get(access.userId,projectId,user.id))
   throw new CollaborationError(409,'REVOKE_ACTIVE_EXECUTION_BEFORE_ROLE_CHANGE');
  this.db.transaction(()=>{
   this.db.prepare(`INSERT INTO collaboration_members(user_id,project_id,member_id,role,state,revision) VALUES(?,?,?,?,'active',1)
    ON CONFLICT(project_id,member_id) DO UPDATE SET role=excluded.role,state='active',revision=collaboration_members.revision+1`).run(access.userId,projectId,user.id,role);
   this.event(access,null,'member_added',{memberId:user.id,role});
  })();
  return this.members(access);
 }
 beginRevocation(projectId:string,memberId:string) {
  const access=this.access(projectId,'manage');
  if(memberId===access.logicalOwnerId) throw new CollaborationError(400,'OWNER_CANNOT_BE_REVOKED');
  this.db.transaction(()=>{
   this.db.prepare("UPDATE collaboration_members SET state='revoking',revision=revision+1 WHERE user_id=? AND project_id=? AND member_id=? AND state='active'").run(access.userId,projectId,memberId);
   this.db.prepare("UPDATE delivery_runs SET state='revoking',updated_at=? WHERE user_id=? AND project_id=? AND actor_id=? AND state IN ('provisioning','ready')").run(Date.now(),access.userId,projectId,memberId);
   this.event(access,null,'member_revoked',{memberId});
  })();
  return access;
 }
 finishRevocation(access:CollaborationAccess,memberId:string) {
  this.db.prepare("UPDATE collaboration_members SET state='revoked' WHERE user_id=? AND project_id=? AND member_id=? AND state='revoking'").run(access.userId,access.projectId,memberId);
 }
 assertAssignee(access:CollaborationAccess,id:string|null|undefined,kind:'assignee'|'reviewer') {
  if(!id) return;
  const member=this.members(access).find(m=>m.userId===id && m.state==='active');
  const user=this.db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(id);
  if(!member||!user|| !(kind==='assignee'?['owner','developer']:['owner','reviewer']).includes(member.role))
   throw new CollaborationError(400,'INVALID_TASK_'+kind.toUpperCase());
 }
 event(access:CollaborationAccess,taskId:string|null,kind:string,body:Record<string,unknown>) {
  const id=randomUUID();
  this.db.prepare('INSERT INTO collaboration_events(id,user_id,project_id,task_id,actor_id,kind,body_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
   .run(id,access.userId,access.projectId,taskId,this.actorId,kind,JSON.stringify(body),Date.now());
  return id;
 }
 events(access:CollaborationAccess,taskId?:string) {
  const rows=this.db.prepare(`SELECT e.id,e.actor_id AS actorId,COALESCE(u.display_name,u.username) AS actorLabel,e.kind,e.body_json,e.created_at AS createdAt
   FROM collaboration_events e JOIN users u ON u.id=e.actor_id WHERE e.user_id=? AND e.project_id=? AND (? IS NULL OR e.task_id=?) ORDER BY e.created_at DESC,e.rowid DESC LIMIT 200`)
   .all(access.userId,access.projectId,taskId??null,taskId??null) as Array<{id:string;actorId:string;actorLabel:string;kind:string;body_json:string;createdAt:number}>;
  return rows.map(({body_json,...r})=>({...r,body:JSON.parse(body_json) as Record<string,unknown>}));
 }
}
