import { getVerificationProcessState, recoverVerificationProcess } from './legacy-verification-recovery.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { CollaborationRepository } from '../../db/repositories/collaboration-repository.js';
import { DeliveryRepository } from '../../db/repositories/delivery-repository.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { SessionRepository } from '../../db/repositories/session-repository.js';
import { canUseProjectPath } from '../../db/repositories/managed-project-access.js';
import { CollaborationTasks } from './tasks.js';
import { CollaborationError, type CollaborationAccess, type CollaborationOptions, type DeliveryRun } from './types.js';
import { provisionWorktree, inspectWorktree, readDeliveryDiff, closeWorktree, reconcileIntegration, isRepositoryGitIdle } from './git-workspaces.js';
import { redactSensitiveErrorMessage } from '../../lib/redaction.js';

export class DeliveryService {
 readonly options:CollaborationOptions;
 private sweeping=false;
 afterSweep:(()=>Promise<void>)|undefined;
 constructor(options:CollaborationOptions) { this.options=options; }
 authority(actorId:string) { return new CollaborationRepository(this.options.db,actorId); }
 tasks(actorId:string) { return new CollaborationTasks(this.options.db,actorId); }
 repository(access:CollaborationAccess) { return new DeliveryRepository(this.options.db,access.userId); }
 context(actorId:string,projectId:string,runId:string,capability:'read'|'develop'|'review'|'manage'='read') {
  const access=this.authority(actorId).access(projectId,capability);
  return {access,repo:this.repository(access),run:this.repository(access).get(projectId,runId)};
 }
 assertExecutor(run:DeliveryRun,actorId=run.actor_id) {
  if(actorId!==run.actor_id) throw new CollaborationError(403,'PRIVATE_EXECUTION_OWNER_REQUIRED');
  const access=this.authority(actorId).access(run.project_id,'develop');
  if(access.authorityEpoch!==run.authority_epoch || access.membershipRevision!==run.membership_revision || !['ready','provisioning'].includes(run.state)) throw new CollaborationError(403,'EXECUTION_REVOKED');
  if(!canUseProjectPath(this.options.db,actorId,run.workspace_path,run.state==='provisioning',true)) throw new CollaborationError(403,'EXECUTION_REVOKED');
  return access;
 }
 managedExecution(){return {supported:this.options.sessionManager?.supportsConfirmedSessionStop()===true,reason:this.options.sessionManager?.supportsConfirmedSessionStop()===true?null:'SESSION_SERVER_UPGRADE_REQUIRED'};}
 async prepare(actorId:string,projectId:string,taskId:string,input:{aiTool:string;idempotencyKey:string},baseCommit?:string,mergeCommit?:string) {
  if(!this.managedExecution().supported)throw new CollaborationError(409,'SESSION_SERVER_UPGRADE_REQUIRED');
  const authority=this.authority(actorId),access=authority.access(projectId,'develop'),repo=this.repository(access);
  const task=this.tasks(actorId).get(access,taskId);
  if(['done','cancelled'].includes(task.status)) throw new CollaborationError(409,'TASK_ALREADY_FINISHED');
  if(task.assigneeId && task.assigneeId!==actorId) throw new CollaborationError(403,'TASK_ASSIGNED_TO_ANOTHER_MEMBER');
  if(!authority.policy(access).executionEnabled) throw new CollaborationError(409,'HOST_EXECUTION_NOT_ENABLED');
  mkdirSync(this.options.workspacesRoot,{recursive:true,mode:0o700});
  if(lstatSync(this.options.workspacesRoot).isSymbolicLink()) throw new CollaborationError(409,'WORKSPACE_ROOT_SYMLINK');
  const root=realpathSync(this.options.workspacesRoot),id=randomUUID(),now=Date.now();
  const digest=createHash('sha256').update(JSON.stringify({projectId,taskId,adapter:input.aiTool,baseCommit:baseCommit??null,epoch:access.membershipRevision,...(mergeCommit?{mergeCommit}:{}),...(access.authorityEpoch?{authorityEpoch:access.authorityEpoch}:{})})).digest('hex');
  const existing=repo.byKey(actorId,input.idempotencyKey);
  if(existing) { if(existing.input_digest!==digest) throw new CollaborationError(409,'IDEMPOTENCY_KEY_CONFLICT');return {run:repo.dto(existing,actorId)}; }
  const run:DeliveryRun={id,user_id:access.userId,project_id:projectId,work_item_id:taskId,actor_id:actorId,idempotency_key:input.idempotencyKey,input_digest:digest,adapter:input.aiTool,
   membership_revision:access.membershipRevision,authority_epoch:access.authorityEpoch,state:'provisioning',workspace_project_id:null,session_id:null,workspace_path:path.join(root,id),branch:`codex/task-${id}`,
   base_commit:baseCommit??'',target_branch:'',preview_url:null,pr_url:null,error_code:null,created_at:now,updated_at:now};
  try { repo.insert(run); } catch { throw new CollaborationError(409,'TASK_EXECUTION_ALREADY_ACTIVE'); }
  try {
   this.assertExecutor(run);
   const worktree=await provisionWorktree({sourcePath:access.path,workspacesRoot:root,runId:id,...(baseCommit?{baseCommit}:{}),...(mergeCommit?{mergeCommit}:{}),authorize:()=>this.assertExecutor(repo.get(projectId,id))});
   if(worktree.path!==run.workspace_path || worktree.branch!==run.branch) throw new Error('WORKSPACE_IDENTITY_CHANGED');
   this.options.db.transaction(()=>{
    this.assertExecutor(repo.get(projectId,id));
    const project=new ProjectRepository(this.options.db,actorId).create({name:`${access.name} · ${task.title}`.slice(0,180),path:worktree.path,aiTool:input.aiTool},id);
    const session=new SessionRepository(this.options.db,actorId).create({projectId:project.id,name:task.title.slice(0,180),aiTool:input.aiTool,workingDir:worktree.path,credentialMode:'host_environment'},id);
    repo.ready(run,project.id,session.id,worktree.baseCommit,worktree.targetBranch);
    this.tasks(actorId).progress(access,taskId,'in_progress');
    authority.event(access,taskId,'workspace_prepared',{runId:id,actorId,baseCommit:worktree.baseCommit});
   })();
  } catch(error) {
   repo.state(run,'failed','WORKSPACE_PREPARATION_FAILED');
   console.error('[collaboration] workspace preparation failed',{action:'workspace.prepare',userId:actorId,runId:id,code:'WORKSPACE_PREPARATION_FAILED',timestamp:Date.now()});
   throw new CollaborationError(409,'WORKSPACE_PREPARATION_FAILED',redactSensitiveErrorMessage(error instanceof Error?error.message:'Workspace preparation failed'));
  }
  return {run:repo.dto(repo.get(projectId,id),actorId)};
 }
 async details(actorId:string,projectId:string,runId:string) {
  const {access,repo,run}=this.context(actorId,projectId,runId);
  let git:{commit:string;dirty:boolean;conflicts:string[];files:Array<{path:string;status:string}>;error?:string}={commit:run.base_commit,dirty:false,conflicts:[],files:[]};
  if(run.base_commit && !['closed','failed','provisioning'].includes(run.state)) {
   try { git=await inspectWorktree({path:run.workspace_path,baseCommit:run.base_commit}); }
   catch { git={commit:'',dirty:true,conflicts:[],files:[],error:'WORKSPACE_UNAVAILABLE'}; }
  }
  this.authority(actorId).access(projectId);
  const digest=this.tasks(actorId).digest(access,run.work_item_id),policyRevision=this.authority(actorId).policy(access).verificationRevision;
  return {run:repo.dto(run,actorId),git,verifications:repo.receipts(run).map(r=>({...repo.receiptDto(r),current:run.state==='ready'&&!git.dirty&&git.commit===r.commit_sha&&r.task_digest===digest&&r.policy_revision===policyRevision})),reviews:repo.reviews(run)};
 }
 async diff(actorId:string,projectId:string,runId:string,filePath:string) {
  const {run}=this.context(actorId,projectId,runId);
  if(!['ready','integrated'].includes(run.state)) throw new CollaborationError(409,'WORKSPACE_NOT_READABLE');
  const diff=await readDeliveryDiff({path:run.workspace_path,baseCommit:run.base_commit,filePath});
  this.authority(actorId).access(projectId);return {diff};
 }
 links(actorId:string,projectId:string,runId:string,previewUrl:string|null,prUrl:string|null) {
  const {access,repo,run}=this.context(actorId,projectId,runId,'develop');this.assertExecutor(run,actorId);
  repo.links(run,previewUrl,prUrl);this.authority(actorId).event(access,run.work_item_id,'delivery_links_updated',{runId});
  return {run:repo.dto(repo.get(projectId,runId),actorId)};
 }
 async stop(run:DeliveryRun):Promise<boolean> {
  // Revoke every known process first. An unresolved Git lease blocks handoff,
  // but must never prevent cancelling an independently known verifier or PTY.
  let stopped=true;
  if(!(await recoverVerificationProcess({cwd:run.workspace_path})).safeToProceed)stopped=false;
  if(run.session_id){
   const session=this.options.db.prepare('SELECT runtime_session_name FROM sessions WHERE id=? AND user_id=?').get(run.session_id,run.actor_id) as {runtime_session_name:string|null}|undefined;
   const manager=this.options.sessionManager;
   if(!manager){if(session?.runtime_session_name||this.options.db.prepare('SELECT 1 FROM session_runtime_confirmations WHERE user_id=? AND session_id=?').get(run.actor_id,run.session_id))stopped=false;}
   else try{
    const confirmed=await manager.runExclusive(run.session_id,async()=>await manager.isSessionExecutionStopped(run.actor_id,run.session_id!,session?.runtime_session_name??undefined)||await manager.confirmSessionExecutionStopped(run.actor_id,run.session_id!,true));
    if(confirmed)new SessionRepository(this.options.db,run.actor_id).update(run.session_id,{status:'stopped',attachToken:''});else stopped=false;
   }catch{stopped=false;}
  }
  if(this.options.db.prepare('SELECT 1 FROM delivery_operations WHERE run_id=?').get(run.id))stopped=false;
  const source=this.options.db.prepare('SELECT p.path,c.protected_root FROM projects p JOIN collaboration_projects c ON c.user_id=p.user_id AND c.project_id=p.id WHERE p.user_id=? AND p.id=?').get(run.user_id,run.project_id) as {path:string;protected_root:string}|undefined;
  try {if(!source||realpathSync(source.path)!==source.protected_root||!await isRepositoryGitIdle(source.protected_root))stopped=false;}catch{stopped=false;}
  return stopped;
 }
 async revoke(actorId:string,projectId:string,memberId:string) {
  const authority=this.authority(actorId),access=authority.beginRevocation(projectId,memberId);
  const runs=this.options.db.prepare("SELECT * FROM delivery_runs WHERE user_id=? AND project_id=? AND actor_id=? AND state='revoking'").all(access.userId,projectId,memberId) as DeliveryRun[];
  let pendingStops=0;
  for(const run of runs) {
   if(run.session_id) this.options.invalidator?.invalidate({scope:'session',userId:run.actor_id,sessionId:run.session_id});
   if(await this.stop(run)) this.repository(access).state(run,'closed','MEMBERSHIP_REVOKED');else pendingStops++;
  }
  if(!pendingStops) authority.finishRevocation(access,memberId);
  return {revoked:true,pendingStops};
 }
 async close(actorId:string,projectId:string,runId:string) {
  const {access,repo,run}=this.context(actorId,projectId,runId);
  if(!access.capabilities.includes('manage')&&run.actor_id!==actorId) throw new CollaborationError(403,'EXECUTOR_OR_OWNER_REQUIRED');
  repo.state(run,'revoking');
  if(run.session_id) this.options.invalidator?.invalidate({scope:'session',userId:run.actor_id,sessionId:run.session_id});
  if(!await this.stop(run)) throw new CollaborationError(409,'EXECUTION_STOP_PENDING');
  if(run.base_commit) {
   try { await closeWorktree({sourcePath:access.path,path:run.workspace_path,branch:run.branch}); }
   catch { repo.state(run,'closed','WORKTREE_RETAINED');return {run:repo.dto(repo.get(projectId,runId),actorId)}; }
  }
  repo.state(run,'closed');this.authority(actorId).event(access,run.work_item_id,'workspace_closed',{runId});
  return {run:repo.dto(repo.get(projectId,runId),actorId)};
 }
 async recover(actorId:string,projectId:string,runId:string,idempotencyKey:string) {
  const {access,repo,run}=this.context(actorId,projectId,runId,'develop');
  if(actorId!==run.actor_id) throw new CollaborationError(403,'PRIVATE_EXECUTION_OWNER_REQUIRED');
  if(!run.base_commit) throw new CollaborationError(409,'NO_RECORDED_CHECKPOINT');
  repo.state(run,'revoking');
  if(!await this.stop(run)) throw new CollaborationError(409,'EXECUTION_STOP_PENDING');
  repo.state(run,'closed','RECOVERED_TO_NEW_WORKSPACE');
  if(run.session_id) this.options.invalidator?.invalidate({scope:'session',userId:actorId,sessionId:run.session_id});
  return this.prepare(actorId,projectId,run.work_item_id,{aiTool:run.adapter,idempotencyKey},run.base_commit);
 }
 async archive(actorId:string,projectId:string) {
  const authority=this.authority(actorId),access=authority.access(projectId,'manage'),policy=authority.policy(access);
  authority.disableExecution(projectId,policy.revision);
  await this.sweep();
  if(this.options.db.prepare("SELECT 1 FROM delivery_runs WHERE user_id=? AND project_id=? AND state IN ('provisioning','ready','revoking')").get(access.userId,projectId))
   throw new CollaborationError(409,'EXECUTION_STOP_PENDING');
  this.options.db.prepare("UPDATE projects SET status='archived' WHERE user_id=? AND id=?").run(access.userId,projectId);
  authority.event(access,null,'project_archived',{});return {archived:true};
 }
 async sweep() {
  if(this.sweeping) return;this.sweeping=true;
  try {
   await this.reconcileInterruptedOperations();
   const runs=this.options.db.prepare("SELECT * FROM delivery_runs WHERE state IN ('ready','revoking')").all() as DeliveryRun[];
   for(const run of runs) {
    try { this.assertExecutor(run); } catch {
     const repo=new DeliveryRepository(this.options.db,run.user_id);repo.state(run,'revoking','EXECUTION_AUTHORITY_REVOKED');
     if(run.session_id) this.options.invalidator?.invalidate({scope:'session',userId:run.actor_id,sessionId:run.session_id});
     if(await this.stop(run)) repo.state(run,'closed','EXECUTION_AUTHORITY_REVOKED');
    }
   }
   this.options.db.prepare("UPDATE collaboration_members SET state='revoked' WHERE state='revoking' AND NOT EXISTS(SELECT 1 FROM delivery_runs r WHERE r.user_id=collaboration_members.user_id AND r.project_id=collaboration_members.project_id AND r.actor_id=collaboration_members.member_id AND r.state IN ('provisioning','ready','revoking'))").run();
   await this.afterSweep?.();
  } finally { this.sweeping=false; }
 }
 private reconciliationAccess(run:DeliveryRun):CollaborationAccess {
  const team=this.options.db.prepare('SELECT p.team_id,p.logical_owner_id,t.owner_id FROM team_projects p JOIN teams t ON t.id=p.team_id WHERE p.project_id=?').get(run.project_id) as {team_id:string;logical_owner_id:string;owner_id:string}|undefined;
  if(!team)return this.authority(run.user_id).access(run.project_id,'manage');
  const admins=this.options.db.prepare("SELECT m.member_id FROM team_members m JOIN users u ON u.id=m.member_id WHERE m.team_id=? AND m.state='active' AND m.role='admin' AND u.status='active' ORDER BY m.member_id").all(team.team_id) as {member_id:string}[];
  for(const actor of new Set([team.logical_owner_id,team.owner_id,...admins.map(m=>m.member_id)])){
   try{return this.authority(actor).access(run.project_id,'manage');}catch{/* Only a currently provable manager can reconcile. */}
  }
  throw new CollaborationError(403,'TEAM_RECOVERY_MANAGER_REQUIRED');
 }
 private async reconcileInterruptedOperations() {
  const operations=this.options.db.prepare("SELECT r.*,o.kind,o.expected_commit FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.phase='interrupted'").all() as Array<DeliveryRun&{kind:string;expected_commit:string}>;
  for(const run of operations) {
   if(run.kind==='verify') {
    const state=await recoverVerificationProcess({cwd:run.workspace_path});
    const receipt=this.options.db.prepare('SELECT 1 FROM delivery_verifications WHERE run_id=?').get(run.id);
    if(state.status==='stopped'||(state.status==='none'&&!receipt)) this.options.db.prepare('DELETE FROM delivery_operations WHERE run_id=?').run(run.id);
    continue;
   }
   if(run.kind!=='integrate') continue;
   try {
    const access=this.reconciliationAccess(run);
    const outcome=await reconcileIntegration({sourcePath:access.path,path:run.workspace_path,baseCommit:run.base_commit,expectedCommit:run.expected_commit,targetBranch:run.target_branch});
    this.options.db.transaction(()=>{
     this.options.db.prepare('DELETE FROM delivery_operations WHERE run_id=?').run(run.id);
     this.repository(access).state(run,outcome==='integrated'?'integrated':'ready',outcome==='not_applied'?'INTERRUPTED_INTEGRATION_NOT_APPLIED':null);
     if(outcome==='integrated') this.tasks(access.actorId).progress(access,run.work_item_id,'done',{runId:run.id,commit:run.expected_commit});
     this.authority(access.actorId).event(access,run.work_item_id,'integration_reconciled',{runId:run.id,outcome,commit:run.expected_commit,systemRecovery:true,authorityActorId:access.actorId});
    })();
   } catch { /* Unknown effects stay fenced; never replay a merge. */ }
  }
 }
 async shutdown() {
  const deadline=Date.now()+15000;
  while((this.sweeping)&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,25));
  if(this.sweeping) throw new Error('DELIVERY_SHUTDOWN_PENDING');
 }
 recoverInterrupted() {
  this.options.db.prepare("DELETE FROM delivery_operations WHERE phase='active' AND kind IN ('review','integrate','pull_request')").run();
  this.options.db.prepare("UPDATE delivery_operations SET phase='interrupted'").run();
  this.options.db.prepare("UPDATE delivery_verifications SET status='unknown',summary='Gateway restarted; verification was not replayed',finished_at=? WHERE status='running'").run(Date.now());
  this.options.db.prepare("UPDATE delivery_runs SET state='failed',error_code='PREPARATION_INTERRUPTED',updated_at=? WHERE state='provisioning'").run(Date.now());
 }
}
