import {realpathSync} from 'node:fs';
import path from 'node:path';
import type {Database} from '../../db/types.js';
import {randomBytes,randomUUID} from 'node:crypto';
import {TeamRepository} from '../../db/repositories/team-repository.js';
import {CollaborationRepository} from '../../db/repositories/collaboration-repository.js';
import {DeliveryRepository} from '../../db/repositories/delivery-repository.js';
import {CollaborationError,type DeliveryRun} from '../collaboration/types.js';
import type {DeliveryService} from '../collaboration/delivery-service.js';
import {tokenHash,TeamInvitations} from './invitations.js';
import type {Handoff,OffboardingRow,TeamAccess} from './types.js';
interface TeamProjectRow {project_id:string;project_user_id:string;logical_owner_id:string;revision:number;name:string;status:string}
export class TeamService {
 readonly db:Database;readonly invites:TeamInvitations;
 constructor(readonly delivery:DeliveryService){this.db=delivery.options.db;this.invites=new TeamInvitations(this.db);}
 repo(actor:string){return new TeamRepository(this.db,actor);}
 rows(a:TeamAccess){return this.db.prepare('SELECT tp.*,p.name,p.status FROM team_projects tp JOIN projects p ON p.id=tp.project_id AND p.user_id=tp.project_user_id WHERE tp.user_id=? AND tp.team_id=? ORDER BY tp.project_id').all(a.team.user_id,a.team.id) as TeamProjectRow[];}
 project(actor:string,row:TeamProjectRow){const a=new CollaborationRepository(this.db,actor).access(row.project_id);return {projectId:row.project_id,name:row.name,logicalOwnerId:row.logical_owner_id,revision:row.revision,role:a.role,capabilities:a.capabilities};}
 detail(actor:string,teamId:string){const r=this.repo(actor),a=r.access(teamId);return {team:r.dto(a),members:r.members(a),projects:this.rows(a).flatMap(p=>{try{return [this.project(actor,p)];}catch{return [];}})};}
 candidates(actor:string,teamId:string){this.repo(actor).access(teamId);return this.db.prepare("SELECT p.id,p.name,COALESCE(c.revision,0) AS revision FROM projects p LEFT JOIN collaboration_projects c ON c.project_id=p.id WHERE p.user_id=? AND p.status='active' AND NOT EXISTS(SELECT 1 FROM team_projects tp WHERE tp.project_id=p.id) AND NOT EXISTS(SELECT 1 FROM delivery_runs r WHERE r.workspace_project_id=p.id)").all(actor);}
 async enroll(actor:string,teamId:string,projectId:string,expectedProjectRevision:number,expectedTeamRevision:number){
  this.repo(actor).access(teamId);const before=new CollaborationRepository(this.db,actor).access(projectId,'manage');if(before.userId!==actor||before.teamId)throw new CollaborationError(403,'TEAM_CAPABILITY_DENIED');
  await this.assertNoSourceExecution(before.path);
  return this.db.transaction(()=>{
  const r=this.repo(actor),a=r.access(teamId),authority=new CollaborationRepository(this.db,actor),access=authority.access(projectId,'manage');r.revision(a,expectedTeamRevision);this.assertNoSourceExecutionSync(access.path);
  if(access.userId!==actor||access.teamId)throw new CollaborationError(403,'TEAM_CAPABILITY_DENIED');
  if(authority.policy(access).revision!==expectedProjectRevision)throw new CollaborationError(409,'STALE_PROJECT_REVISION');
  if(this.db.prepare("SELECT 1 FROM collaboration_members c WHERE c.project_id=? AND c.state!='revoked' AND NOT EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=? AND m.member_id=c.member_id AND m.state='active')").get(projectId,teamId))throw new CollaborationError(409,'TEAM_PROJECT_HAS_EXTERNAL_MEMBERS');
  if(this.db.prepare("SELECT 1 FROM delivery_runs WHERE project_id=? AND state IN ('provisioning','ready','revoking')").get(projectId)||this.db.prepare("SELECT 1 FROM sessions WHERE project_id=? AND status IN ('starting','running','idle','busy','waiting','stopping')").get(projectId))throw new CollaborationError(409,'TEAM_PROJECT_EXECUTION_ACTIVE');
  authority.disableExecution(projectId,expectedProjectRevision);
  this.db.prepare('INSERT INTO team_projects(user_id,team_id,project_user_id,project_id,logical_owner_id) VALUES(?,?,?,?,?)').run(a.team.user_id,teamId,access.userId,projectId,actor);r.bump(a);r.event(a,'project_enrolled',{projectId});
  return this.project(actor,this.rows(a).find(p=>p.project_id===projectId)!);
 })();}
 private sourceOverlaps(source:string,cwd:string){try{const root=realpathSync(cwd),a=path.relative(source,root),b=path.relative(root,source);return !a||(!a.startsWith('..'+path.sep)&&a!=='..'&&!path.isAbsolute(a))||(!b.startsWith('..'+path.sep)&&b!=='..'&&!path.isAbsolute(b));}catch{return true;}}
 private assertNoSourceExecutionSync(source:string, requireConfirmation=true){
  const manager=this.delivery.options.sessionManager;
  if(manager?.listSessions().some(s=>['pending','running','detached'].includes(s.status)&&this.sourceOverlaps(source,s.launchPlan.cwd)))throw new CollaborationError(409,'TEAM_PROJECT_EXECUTION_ACTIVE');
  const sessions=this.db.prepare('SELECT id,user_id,working_dir,status,runtime_session_name FROM sessions').all() as Array<{id:string;user_id:string;working_dir:string;status:string;runtime_session_name:string|null}>;
  const overlapping=sessions.filter(s=>this.sourceOverlaps(source,s.working_dir));
  if(requireConfirmation&&overlapping.some(s=>this.db.prepare("SELECT 1 FROM session_runtime_confirmations WHERE user_id=? AND session_id=? AND status='pending'").get(s.user_id,s.id)))throw new CollaborationError(409,'TEAM_PROJECT_EXECUTION_ACTIVE');
  if(overlapping.some(s=>!['stopped','exited','lost','error'].includes(s.status)))throw new CollaborationError(409,'TEAM_PROJECT_EXECUTION_ACTIVE');
  return overlapping;
 }
 private async assertNoSourceExecution(source:string){
  const sessions=this.assertNoSourceExecutionSync(source,false),manager=this.delivery.options.sessionManager;
  for(const session of sessions)if(manager?!await manager.isSessionExecutionStopped(session.user_id,session.id,session.runtime_session_name??undefined):!!session.runtime_session_name)throw new CollaborationError(409,'TEAM_PROJECT_EXECUTION_ACTIVE');
 }

 transferProject(actor:string,teamId:string,projectId:string,newOwnerId:string,expectedRevision:number){return this.db.transaction(()=>{
  const r=this.repo(actor),a=r.access(teamId),p=this.rows(a).find(p=>p.project_id===projectId);if(!p)throw new CollaborationError(404,'PROJECT_NOT_FOUND');
  if(a.role==='member'&&p.logical_owner_id!==actor)throw new CollaborationError(403,'TEAM_CAPABILITY_DENIED');
  if(p.revision!==expectedRevision)throw new CollaborationError(409,'STALE_PROJECT_REVISION');r.accessTarget(teamId,newOwnerId);
  this.db.prepare('UPDATE team_projects SET logical_owner_id=?,revision=revision+1 WHERE user_id=? AND team_id=? AND project_id=?').run(newOwnerId,a.team.user_id,teamId,projectId);r.bump(a);r.event(a,'project_owner_transferred',{projectId,newOwnerId});
  const updated=this.rows(a).find(p=>p.project_id===projectId)!;try{return this.project(actor,updated);}catch{return {projectId,name:updated.name,logicalOwnerId:newOwnerId,revision:updated.revision,role:'viewer' as const,capabilities:[]};}
 })();}
 offboardAccess(actor:string,teamId:string,memberId:string){const r=this.repo(actor),a=r.access(teamId),m=r.member(a,memberId);if(memberId===a.team.owner_id)throw new CollaborationError(409,'TEAM_OWNER_TRANSFER_REQUIRED');if(actor!==memberId&&(a.role==='member'||(a.role!=='owner'&&m.role==='admin')))throw new CollaborationError(403,'TEAM_CAPABILITY_DENIED');return {r,a,m};}
 impact(actor:string,teamId:string,memberId:string){const {r,a,m}=this.offboardAccess(actor,teamId,memberId),members=r.members(a).filter(m=>m.state==='active'&&m.userId!==memberId&&!!this.db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(m.userId));
  const projects=this.rows(a).map(p=>{
   const tasks=this.db.prepare(`SELECT w.id,w.title,c.revision,c.assignee_id AS assigneeId,c.reviewer_id AS reviewerId FROM collaboration_tasks c JOIN project_manager_work_items w ON w.id=c.work_item_id WHERE c.user_id=? AND c.project_id=? AND (c.assignee_id=? OR c.reviewer_id=?) ORDER BY w.id`).all(p.project_user_id,p.project_id,memberId,memberId) as {id:string;title:string;revision:number;assigneeId:string|null;reviewerId:string|null}[];
   const runs=this.db.prepare("SELECT id,state FROM delivery_runs WHERE user_id=? AND project_id=? AND actor_id=? AND state IN ('provisioning','ready','revoking') ORDER BY id").all(p.project_user_id,p.project_id,memberId) as {id:string;state:string}[];
   const eligible=(cap:'develop'|'review')=>members.flatMap(m=>{try{new CollaborationRepository(this.db,m.userId).access(p.project_id,cap);return [{userId:m.userId,label:m.displayName??m.email}];}catch{return [];}});
   return {projectId:p.project_id,name:p.name,logicalOwnerId:p.logical_owner_id,revision:p.revision,requiresOwnerTransfer:p.logical_owner_id===memberId,tasks,runs,eligibleOwners:members.map(m=>({userId:m.userId,label:m.displayName??m.email})),eligibleAssignees:eligible('develop'),eligibleReviewers:eligible('review')};
  }).filter(p=>p.requiresOwnerTransfer||p.tasks.length||p.runs.length);
  const blockers=this.db.prepare("SELECT o.project_id AS projectId,o.run_id AS runId FROM delivery_operations o JOIN team_projects p ON p.project_id=o.project_id WHERE p.team_id=? AND o.kind='integrate' AND o.phase IN ('applying','interrupted')").all(teamId) as {projectId:string;runId:string}[];
  const result={member:m,teamRevision:a.team.revision,projects,blockers:blockers.map(b=>({code:'DELIVERY_INTEGRATION_IN_PROGRESS',...b}))};
  return {...result,impactDigest:tokenHash(JSON.stringify(result))};
 }
 validateHandoffs(actor:string,teamId:string,memberId:string,handoffs:Handoff[]){const impact=this.impact(actor,teamId,memberId);if(impact.blockers.length)throw new CollaborationError(409,'DELIVERY_INTEGRATION_IN_PROGRESS');if(new Set(handoffs.map(h=>h.projectId)).size!==handoffs.length||handoffs.length!==impact.projects.length)throw new CollaborationError(400,'TEAM_HANDOFF_REQUIRED');for(const p of impact.projects){const h=handoffs.find(h=>h.projectId===p.projectId);if(!h||(p.requiresOwnerTransfer&&(!h.newOwnerId||!p.eligibleOwners.some(u=>u.userId===h.newOwnerId))))throw new CollaborationError(400,'TEAM_HANDOFF_REQUIRED');if(h.newOwnerId&&!p.requiresOwnerTransfer)throw new CollaborationError(400,'TEAM_HANDOFF_REQUIRED');if(h.assigneeId&&!p.eligibleAssignees.some(u=>u.userId===h.assigneeId)&&h.assigneeId!==h.newOwnerId)throw new CollaborationError(400,'INVALID_ASSIGNEE');if(h.reviewerId&&!p.eligibleReviewers.some(u=>u.userId===h.reviewerId)&&h.reviewerId!==h.newOwnerId)throw new CollaborationError(400,'INVALID_REVIEWER');}return impact;}
 plan(actor:string,teamId:string,memberId:string,expectedMemberRevision:number,handoffs:Handoff[],expectedImpactDigest:string){return this.db.transaction(()=>{const impact=this.validateHandoffs(actor,teamId,memberId,handoffs);if(impact.impactDigest!==expectedImpactDigest)throw new CollaborationError(409,'TEAM_OFFBOARDING_PLAN_STALE');if(impact.member.state!=='active')throw new CollaborationError(409,'TEAM_STOP_PENDING');if(impact.member.revision!==expectedMemberRevision)throw new CollaborationError(409,'STALE_MEMBER_REVISION');const {a,r}=this.offboardAccess(actor,teamId,memberId),id=randomUUID(),token=randomBytes(32).toString('base64url'),now=Date.now();this.db.prepare('INSERT INTO team_offboarding_plans(id,user_id,team_id,actor_id,member_id,confirmation_hash,plan_digest,handoffs_json,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,a.team.user_id,teamId,actor,memberId,tokenHash(token),tokenHash(JSON.stringify(impact)),JSON.stringify(handoffs),now+600000,now);r.event(a,'offboarding_planned',{planId:id,memberId});return {plan:this.planDto(this.rawPlan(teamId,id)),confirmationToken:token};})();}
 rawPlan(teamId:string,id:string){const p=this.db.prepare('SELECT * FROM team_offboarding_plans WHERE team_id=? AND id=?').get(teamId,id) as OffboardingRow|undefined;if(!p)throw new CollaborationError(404,'TEAM_OFFBOARDING_PLAN_NOT_FOUND');return p;}
 planDto(p:OffboardingRow){return {id:p.id,revision:p.revision,memberId:p.member_id,state:p.state,expiresAt:p.expires_at,createdAt:p.created_at,pendingStops:p.pending_stops,error:p.error};}
 planStatus(actor:string,teamId:string,id:string){const p=this.rawPlan(teamId,id);if(p.member_id!==actor){this.repo(actor).access(teamId,true);return {plan:this.planDto(p),...(p.state==='stopping'?{impact:this.impact(actor,teamId,p.member_id)}:{})};}return {plan:this.planDto(p)};}
 plans(actor:string,teamId:string){let manager=false;try{manager=this.repo(actor).access(teamId).role!=='member';}catch{/* Removed members can inspect only their own pending records. */}return {plans:(this.db.prepare("SELECT * FROM team_offboarding_plans WHERE team_id=? AND state!='completed' AND (?=1 OR member_id=?) ORDER BY created_at DESC").all(teamId,Number(manager),actor) as OffboardingRow[]).map(p=>this.planDto(p))};}
 async commit(actor:string,teamId:string,id:string,confirmationToken:string){const p=this.rawPlan(teamId,id);if(p.state!=='planned')return this.resume(actor,teamId,id);if(p.actor_id!==actor)throw new CollaborationError(403,'TEAM_CONFIRMATION_ACTOR_MISMATCH');this.db.transaction(()=>{if(p.confirmation_hash!==tokenHash(confirmationToken))throw new CollaborationError(403,'TEAM_CONFIRMATION_INVALID');if(p.expires_at<=Date.now())throw new CollaborationError(409,'TEAM_OFFBOARDING_PLAN_EXPIRED');const impact=this.validateHandoffs(actor,teamId,p.member_id,JSON.parse(p.handoffs_json) as Handoff[]);if(tokenHash(JSON.stringify(impact))!==p.plan_digest)throw new CollaborationError(409,'TEAM_OFFBOARDING_PLAN_STALE');const {r,a}=this.offboardAccess(actor,teamId,p.member_id);
  this.db.prepare("UPDATE team_members SET state='leaving',revision=revision+1 WHERE user_id=? AND team_id=? AND member_id=?").run(p.user_id,teamId,p.member_id);
  this.db.prepare("UPDATE collaboration_members SET state='revoking',revision=revision+1 WHERE member_id=? AND project_id IN(SELECT project_id FROM team_projects WHERE user_id=? AND team_id=?) AND state='active'").run(p.member_id,p.user_id,teamId);
  this.db.prepare("UPDATE delivery_runs SET state='revoking',updated_at=? WHERE actor_id=? AND project_id IN(SELECT project_id FROM team_projects WHERE user_id=? AND team_id=?) AND state IN ('ready','provisioning')").run(Date.now(),p.member_id,p.user_id,teamId);
  this.db.prepare("UPDATE team_offboarding_plans SET state='stopping',revision=revision+1 WHERE user_id=? AND team_id=? AND id=?").run(p.user_id,teamId,id);r.bump(a);r.event(a,'offboarding_started',{planId:id,memberId:p.member_id});
 })();this.delivery.options.invalidator?.invalidate({scope:'user',userId:p.member_id});await this.attemptDrain(this.rawPlan(teamId,id));return this.planStatus(actor,teamId,id);}
 async resume(actor:string,teamId:string,id:string){this.repo(actor).access(teamId,true);const p=this.rawPlan(teamId,id);if(p.state==='planned')throw new CollaborationError(409,'TEAM_CONFIRMATION_REQUIRED');if(p.state==='stopping')await this.attemptDrain(p);return this.planStatus(actor,teamId,id);}
 repair(actor:string,teamId:string,id:string,expectedPlanRevision:number,expectedImpactDigest:string,handoffs:Handoff[]){return this.db.transaction(()=>{
  const r=this.repo(actor),a=r.access(teamId,true),p=this.rawPlan(teamId,id);
  if(p.state!=='stopping')throw new CollaborationError(409,'TEAM_OFFBOARDING_NOT_STOPPING');
  if(p.revision!==expectedPlanRevision)throw new CollaborationError(409,'TEAM_OFFBOARDING_PLAN_STALE');
  const impact=this.validateHandoffs(actor,teamId,p.member_id,handoffs);
  if(impact.impactDigest!==expectedImpactDigest)throw new CollaborationError(409,'TEAM_OFFBOARDING_PLAN_STALE');
  this.db.prepare('UPDATE team_offboarding_plans SET handoffs_json=?,plan_digest=?,revision=revision+1,error=NULL WHERE user_id=? AND team_id=? AND id=?').run(JSON.stringify(handoffs),tokenHash(JSON.stringify(impact)),p.user_id,teamId,id);
  r.event(a,'offboarding_handoffs_revised',{planId:id,initiatorId:p.actor_id,revision:p.revision+1});return {plan:this.planDto(this.rawPlan(teamId,id))};
 })();}
 private async attemptDrain(p:OffboardingRow){try{await this.drain(p);}catch{this.db.prepare("UPDATE team_offboarding_plans SET error='TEAM_HANDOFF_TARGET_CHANGED' WHERE user_id=? AND team_id=? AND id=? AND revision=? AND state='stopping'").run(p.user_id,p.team_id,p.id,p.revision);}}
 async drain(p:OffboardingRow){const runs=this.db.prepare("SELECT r.* FROM delivery_runs r JOIN team_projects tp ON tp.project_id=r.project_id WHERE tp.user_id=? AND tp.team_id=? AND r.actor_id=? ").all(p.user_id,p.team_id,p.member_id) as DeliveryRun[];let pending=0;for(const run of runs){if(await this.delivery.stop(run)){if(['ready','provisioning','revoking'].includes(run.state))new DeliveryRepository(this.db,run.user_id).state(run,'closed','TEAM_MEMBERSHIP_REVOKED');}else pending++;}
  const progress=this.db.prepare("UPDATE team_offboarding_plans SET pending_stops=? WHERE user_id=? AND team_id=? AND id=? AND revision=? AND state='stopping'").run(pending,p.user_id,p.team_id,p.id,p.revision);if(!progress.changes||pending)return;
  this.db.transaction(()=>{const fresh=this.rawPlan(p.team_id,p.id);if(fresh.state!=='stopping'||fresh.revision!==p.revision)return;const handoffs=JSON.parse(p.handoffs_json) as Handoff[];
   for(const h of handoffs){const row=this.db.prepare('SELECT * FROM team_projects WHERE user_id=? AND team_id=? AND project_id=?').get(p.user_id,p.team_id,h.projectId) as TeamProjectRow|undefined;if(!row)throw new CollaborationError(409,'TEAM_HANDOFF_TARGET_CHANGED');
    for(const target of [h.newOwnerId,h.assigneeId,h.reviewerId])if(target)this.repo(target).access(p.team_id);
    if(row.logical_owner_id===p.member_id){if(!h.newOwnerId)throw new CollaborationError(409,'TEAM_HANDOFF_REQUIRED');this.db.prepare('UPDATE team_projects SET logical_owner_id=?,revision=revision+1 WHERE user_id=? AND team_id=? AND project_id=?').run(h.newOwnerId,p.user_id,p.team_id,h.projectId);}
    for(const [target,cap] of [[h.assigneeId,'develop'],[h.reviewerId,'review']] as const)if(target)new CollaborationRepository(this.db,target).access(h.projectId,cap);
    this.db.prepare('UPDATE collaboration_tasks SET assignee_id=CASE WHEN assignee_id=@member THEN @assignee ELSE assignee_id END,reviewer_id=CASE WHEN reviewer_id=@member THEN @reviewer ELSE reviewer_id END,revision=revision+1 WHERE user_id=@storage AND project_id=@project AND (assignee_id=@member OR reviewer_id=@member)').run({member:p.member_id,assignee:h.assigneeId,reviewer:h.reviewerId,storage:row.project_user_id,project:h.projectId});
   }
   this.db.prepare("UPDATE collaboration_members SET state='revoked' WHERE member_id=? AND project_id IN(SELECT project_id FROM team_projects WHERE user_id=? AND team_id=?) AND state='revoking'").run(p.member_id,p.user_id,p.team_id);
   this.db.prepare("UPDATE team_members SET state='left' WHERE user_id=? AND team_id=? AND member_id=? AND state='leaving'").run(p.user_id,p.team_id,p.member_id);
   this.db.prepare("UPDATE team_offboarding_plans SET state='completed',revision=revision+1,pending_stops=0,error=NULL WHERE user_id=? AND team_id=? AND id=?").run(p.user_id,p.team_id,p.id);
   this.db.prepare('UPDATE teams SET revision=revision+1,updated_at=? WHERE user_id=? AND id=?').run(Date.now(),p.user_id,p.team_id);
   this.db.prepare('INSERT INTO team_events(id,user_id,team_id,actor_id,kind,body_json,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),p.user_id,p.team_id,p.actor_id,'offboarding_completed',JSON.stringify({planId:p.id,memberId:p.member_id}),Date.now());
  })();
 }
 async sweep(){const plans=this.db.prepare("SELECT * FROM team_offboarding_plans WHERE state='stopping'").all() as OffboardingRow[];for(const p of plans)await this.attemptDrain(p);}
}
