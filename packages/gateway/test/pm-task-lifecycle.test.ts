import { getTaskProgress } from '../src/services/project-manager/task-progress.js';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { createPlatformCommands } from '../src/services/platform-commands/catalog.js';
import { configureCliAutonomyAdapters } from '../src/services/adapter-autonomy.js';
import { readTaskPacketDetails, findWorkItemByTaskPacketSession, withTaskPacketSessionLink } from '../src/services/project-manager/task-packets.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { attachNotificationPersistence } from '../src/services/notification-events.js';
import { attachDispatchSupervisor } from '../src/services/agent/dispatch-supervisor.js';

const cleanups: Array<()=>void> = [];
afterEach(()=>{ for(const cleanup of cleanups.splice(0))cleanup(); configureCliAutonomyAdapters([]); });
function fixture(options: { ready?: boolean; fastHook?: boolean; stagingVisible?: boolean } = {}) {
 const root=mkdtempSync(join(tmpdir(),'fb-pm-lifecycle-'));
 const db=new Database(':memory:');
 migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const user=new UserRepository(db).create('lifecycle@test.dev','hash');
 const project=new ProjectRepository(db,user.id).create({name:'p',path:root,aiTool:'codex'});
 const pm=new ProjectManagerRepository(db,user.id);
 const eventBus=new ForgeBadgerEventBus();
 attachNotificationPersistence({db,eventBus});
 let pane=options.ready===false?'Loading...':'› Ask Codex to do anything\nmodel · cwd';
 const state={enters:0,staged:[] as string[],sessionId:'',onInspect:undefined as (()=>void)|undefined,backendAlive:true,starts:0,livenessProbes:0};
 const manager=new InMemorySessionManager({
  async createSession(){state.starts++;state.backendAlive=true;},async killSession(){},async sendInput(){},async listSessions(){return [];},async hasSession(){state.livenessProbes++;return state.backendAlive;},
  async capturePane(){return pane;},async inspectPane(){state.onInspect?.();return {content:pane,dead:false};},
  async stageProgrammaticInput(_name,data){state.staged.push(data);if(options.stagingVisible!==false)pane=`› ${data}\nmodel · cwd`;},
  async pressEnter(){state.enters++;pane='› Ask Codex to do anything\nmodel · cwd';if(options.fastHook)notify();}
 },undefined,undefined,{db,sleep:async()=>{}});
 const notify=()=>eventBus.emitEvent({type:'claude_notification',userId:user.id,projectId:project.id,sessionId:state.sessionId || (db.prepare('SELECT id FROM sessions LIMIT 1').get() as {id:string}).id,hookEventName:'Stop',notificationType:'task_completed',message:'Finished'});
 const actions=new PlatformActions({db,userId:user.id,sessionManager:manager,eventBus,adapterCommandRunner:async(command)=>({exitCode:0,stdout:`${command} 1.0.0`,stderr:''})},createPlatformCommands());
 const supervisor=attachDispatchSupervisor({db,eventBus});
 cleanups.push(()=>{supervisor.stop();db.close();rmSync(root,{recursive:true,force:true});});
 configureCliAutonomyAdapters(['codex']);
 return {db,user,project,pm,manager,actions,state,eventBus,notify,supervisor,setReady(){pane='› Ask Codex to do anything\nmodel · cwd';}};
}

describe('PM task lifecycle reliability',()=>{
 it('atomically creates and links a first session without invalidating its own execution authorization',async()=>{
  const f=fixture();const item=f.pm.createWorkItem(f.project.id,{title:'First dispatch',acceptanceCriteria:['verified']});
  const result=await f.actions.executeOwner('pm.task.execute',{projectId:f.project.id,workItemId:item.id},'first') as {dispatch:{dispatched:boolean}};
  assert.equal(result.dispatch.dispatched,true);assert.equal(f.state.enters,1);assert.equal(f.pm.getWorkItem(f.project.id,item.id)?.status,'in_progress');
 });
 it('reports partial progress for NOT_READY, reuses the session on a new intent and never repeats a completed attempt',async()=>{
  const f=fixture({ready:false});const item=f.pm.createWorkItem(f.project.id,{title:'Wait for CLI'});const input={projectId:f.project.id,workItemId:item.id};
  const first=await f.actions.executeOwner('pm.task.execute',input,'not-ready') as {executionStatus:string;dispatch:{status:string};sessionId:string};
  assert.equal(first.executionStatus,'incomplete');assert.equal(first.dispatch.status,'not_sent');assert.equal(f.state.enters,0);
  f.setReady();const replay=await f.actions.executeOwner('pm.task.execute',input,'not-ready') as {executionStatus:string};
  assert.equal(replay.executionStatus,'incomplete');assert.equal(f.state.enters,0);
  const second=await f.actions.executeOwner('pm.task.execute',input,'ready') as {session:{id:string}};
  assert.equal(second.session.id,first.sessionId);assert.equal(f.state.enters,1);
  await assert.rejects(f.actions.executeOwner('pm.task.execute',input,'duplicate'),/ALREADY_DISPATCHED/);assert.equal(f.state.enters,1);
 });
 it('rejects closed and paused task states before creating a session',async()=>{
  const f=fixture();for(const status of ['cancelled','blocked','ready_for_review','done']){
   const item=f.pm.createWorkItem(f.project.id,{title:status});f.db.prepare('UPDATE project_manager_work_items SET status=? WHERE id=?').run(status,item.id);
   await assert.rejects(f.actions.executeOwner('pm.task.execute',{projectId:f.project.id,workItemId:item.id},status),/TASK_NOT_DISPATCHABLE/);
  }
  assert.equal((f.db.prepare('SELECT count(*) n FROM sessions').get() as {n:number}).n,0);
 });
 it('recovers a completion hook emitted before dispatch returns and preserves evidence for review',async()=>{
  const f=fixture({fastHook:true});const item=f.pm.createWorkItem(f.project.id,{title:'Fast task'});
  await f.actions.executeOwner('pm.task.execute',{projectId:f.project.id,workItemId:item.id},'fast');
  // The supervisor also reconciles persisted notifications when reattached after a crash.
  f.supervisor.stop();const restored=attachDispatchSupervisor({db:f.db,eventBus:f.eventBus});restored.stop();
  const updated=f.pm.getWorkItem(f.project.id,item.id)!;assert.equal(updated.status,'ready_for_review');
  assert.equal(typeof (readTaskPacketDetails(updated.details).attempt as {consumedNotificationId?:string}).consumedNotificationId,'string');
 });
 it('finds exact linked tasks beyond the first 200 items and enforces tenant scope',()=>{
  const f=fixture();const item=f.pm.createWorkItem(f.project.id,{title:'zzzz'});const session=new SessionRepository(f.db,f.user.id).create({projectId:f.project.id,name:'s',aiTool:'codex',workingDir:f.project.path});
  f.pm.updateWorkItem(f.project.id,item.id,{details:withTaskPacketSessionLink(item.details,session,f.project)});
  for(let n=0;n<205;n++)f.pm.createWorkItem(f.project.id,{title:`a${n}`});
  assert.equal(findWorkItemByTaskPacketSession(f.db,f.user.id,f.project.id,session.id)?.id,item.id);
  assert.equal(findWorkItemByTaskPacketSession(f.db,'other',f.project.id,session.id),undefined);
 });
 it('uses a confirmed current receipt and persisted completion evidence to close only to review',async()=>{
  const f=fixture();const item=f.pm.createWorkItem(f.project.id,{title:'Close task'});
  const input={projectId:f.project.id,workItemId:item.id};
  const result=await f.actions.executeOwner('pm.task.execute',input,'close-dispatch') as {attemptId:string};
  f.notify();
  const progress=getTaskProgress({db:f.db,userId:f.user.id},f.project.id,item.id);
  assert.equal(progress.found,true);if(!progress.found)throw new Error('missing');
  const evidence=progress.notifications[0]!;assert.ok(evidence);
  const close={...input,attemptId:result.attemptId,notificationId:evidence.id,summary:'Implementation finished; verification awaits review.'};
  const closed=await f.actions.executeOwner('pm.task.close',close,'close') as {status:string;report:string;independentlyVerified:boolean};
  assert.equal(closed.status,'ready_for_review');assert.equal(closed.independentlyVerified,false);assert.match(closed.report,/not independently verified/);
  await assert.rejects(f.actions.executeOwner('pm.task.close',{...close,attemptId:'foreign'},'bad-close'),/EVIDENCE_MISMATCH/);
  await assert.rejects(f.actions.executeOwner('pm.task.close',{...close,notificationId:'foreign'},'bad-notice'),/EVIDENCE_MISMATCH/);
  assert.equal(f.pm.getWorkItem(f.project.id,item.id)?.status,'ready_for_review');
 });
 it('rejects forged receipt provenance and changed acceptance criteria for closeout',async()=>{
  const f=fixture();const item=f.pm.createWorkItem(f.project.id,{title:'Evidence'});const input={projectId:f.project.id,workItemId:item.id};
  const result=await f.actions.executeOwner('pm.task.execute',input,'evidence') as {attemptId:string};f.notify();
  const notification=(f.db.prepare('SELECT id FROM notifications LIMIT 1').get() as {id:string}).id;
  f.pm.updateWorkItem(f.project.id,item.id,{acceptanceCriteria:['new requirement']});
  await assert.rejects(f.actions.executeOwner('pm.task.close',{...input,attemptId:result.attemptId,notificationId:notification},'changed'),/EVIDENCE_MISMATCH/);
 });
 it('does not treat stale hooks or failed delivery as completion and read progress performs no writes',async()=>{
  const f=fixture({ready:false});const item=f.pm.createWorkItem(f.project.id,{title:'Stale'});const input={projectId:f.project.id,workItemId:item.id};
  await f.actions.executeOwner('pm.task.execute',input,'unready');f.notify();
  const before=(f.db.prepare('SELECT total_changes() AS n').get() as {n:number}).n;getTaskProgress({db:f.db,userId:f.user.id},f.project.id,item.id);assert.equal((f.db.prepare('SELECT total_changes() AS n').get() as {n:number}).n,before);
  f.setReady();await f.actions.executeOwner('pm.task.execute',input,'after-stale');
  f.supervisor.stop();const restored=attachDispatchSupervisor({db:f.db,eventBus:f.eventBus});restored.stop();
  assert.equal(f.pm.getWorkItem(f.project.id,item.id)?.status,'in_progress');
  f.notify();const next=attachDispatchSupervisor({db:f.db,eventBus:f.eventBus});next.stop();
  assert.equal(f.pm.getWorkItem(f.project.id,item.id)?.status,'ready_for_review');
 });
 it('persists failed CLI completion as blocked and forbids automatic redispatch',async()=>{
  const f=fixture();const item=f.pm.createWorkItem(f.project.id,{title:'Failure'});const input={projectId:f.project.id,workItemId:item.id};
  const result=await f.actions.executeOwner('pm.task.execute',input,'fail-dispatch') as {session:{id:string}};
  f.eventBus.emitEvent({type:'claude_notification',userId:f.user.id,sessionId:result.session.id,projectId:f.project.id,hookEventName:'StopFailure',notificationType:'task_failed',message:'Failed'});
  assert.equal(f.pm.getWorkItem(f.project.id,item.id)?.status,'blocked');
  await assert.rejects(f.actions.executeOwner('pm.task.execute',input,'fail-replay'),/TASK_NOT_DISPATCHABLE/);assert.equal(f.state.enters,1);
 });

 it('shows interrupted dispatch evidence without treating the task as completed or replayable',async()=>{
  const f=fixture();const item=f.pm.createWorkItem(f.project.id,{title:'Interrupted'});
  const input={projectId:f.project.id,workItemId:item.id};
  const result=await f.actions.executeOwner('pm.task.execute',input,'interrupt-dispatch') as {session:{id:string};attemptId:string};
  f.eventBus.emitEvent({type:'claude_notification',userId:f.user.id,sessionId:result.session.id,
   projectId:f.project.id,hookEventName:'Interrupt',notificationType:'task_interrupted',message:'Interrupted'});
  assert.equal(f.pm.getWorkItem(f.project.id,item.id)?.status,'in_progress');
  const progress=getTaskProgress({db:f.db,userId:f.user.id},f.project.id,item.id);
  assert.equal(progress.found,true);
  if(!progress.found)throw new Error('missing task');
  assert.equal(progress.notifications[0]?.notificationType,'task_interrupted');
  assert.equal(progress.evidenceStatus,'interrupted');
  assert.match(progress.nextAction,/interrupted/i);
  assert.match(progress.nextAction,/do not redispatch/i);
  assert.equal(progress.attempt?.consumedNotificationId,undefined);
  await assert.rejects(f.actions.executeOwner('pm.task.execute',input,'interrupt-replay'),/TASK_ALREADY_DISPATCHED/);
  assert.equal(f.state.enters,1);
 });

 it('fences unknown staging across new intents and never presses Enter on unverifiable staging',async()=>{
  const f=fixture({stagingVisible:false});const item=f.pm.createWorkItem(f.project.id,{title:'Unknown'});const input={projectId:f.project.id,workItemId:item.id};
  await assert.rejects(f.actions.executeOwner('pm.task.execute',input,'unknown'),/COPILOT_DELIVERY_UNCONFIRMED/);
  assert.equal(f.state.enters,0);assert.equal(f.state.staged.length,1);
  await assert.rejects(f.actions.executeOwner('pm.task.execute',input,'unknown-new-key'),/TASK_DISPATCH_UNCERTAIN/);
  assert.equal(f.state.staged.length,1);
 });
 it('revalidates task semantics during CLI readiness and sends nothing after a concurrent edit',async()=>{
  const f=fixture();const item=f.pm.createWorkItem(f.project.id,{title:'Original'});
  f.state.onInspect=()=>{f.state.onInspect=undefined;f.pm.updateWorkItem(f.project.id,item.id,{title:'Changed by user'});};
  await assert.rejects(f.actions.executeOwner('pm.task.execute',{projectId:f.project.id,workItemId:item.id},'edited'),/Stale resource revision/);
  assert.equal(f.state.staged.length,0);assert.equal(f.state.enters,0);
  assert.equal(f.pm.getWorkItem(f.project.id,item.id)?.title,'Changed by user');
 });
 it('fails closed when notification deletion/reuse destroys the attempt watermark anchor',async()=>{
  const f=fixture({ready:false});const item=f.pm.createWorkItem(f.project.id,{title:'Anchor'});const input={projectId:f.project.id,workItemId:item.id};
  await f.actions.executeOwner('pm.task.execute',input,'anchor-wait');f.notify();f.setReady();
  await f.actions.executeOwner('pm.task.execute',input,'anchor-send');
  f.db.prepare('DELETE FROM notifications').run();f.notify();f.notify();
  assert.equal(f.pm.getWorkItem(f.project.id,item.id)?.status,'in_progress');
  const progress=getTaskProgress({db:f.db,userId:f.user.id},f.project.id,item.id);
  assert.equal(progress.found&&progress.notifications.length,0);
 });
 it('rolls back session creation if linking the new session fails',async()=>{
  const f=fixture();const item=f.pm.createWorkItem(f.project.id,{title:'Atomic'});
  f.db.exec("CREATE TRIGGER fail_link BEFORE UPDATE ON project_manager_work_items BEGIN SELECT RAISE(ABORT,'link failed'); END;");
  await assert.rejects(f.actions.executeOwner('pm.task.execute',{projectId:f.project.id,workItemId:item.id},'atomic'),/link failed/);
  assert.equal((f.db.prepare('SELECT count(*) n FROM sessions').get() as {n:number}).n,0);
 });

 it('authorizes the linked adapter rather than the project default and rejects ambiguous session links',async()=>{
  const f=fixture();const item=f.pm.createWorkItem(f.project.id,{title:'Adapter'});
  const session=new SessionRepository(f.db,f.user.id).create({projectId:f.project.id,name:'s',aiTool:'claude',workingDir:f.project.path});
  f.pm.updateWorkItem(f.project.id,item.id,{details:withTaskPacketSessionLink(item.details,session,f.project)});
  await assert.rejects(f.actions.executeOwner('pm.task.execute',{projectId:f.project.id,workItemId:item.id},'linked-adapter'),/ADAPTER_AUTONOMY_UNVERIFIED/);
  configureCliAutonomyAdapters(['claude']);
  const other=f.pm.createWorkItem(f.project.id,{title:'Other'});
  f.pm.updateWorkItem(f.project.id,other.id,{details:withTaskPacketSessionLink(other.details,session,f.project)});
  await assert.rejects(f.actions.executeOwner('pm.task.execute',{projectId:f.project.id,workItemId:item.id},'ambiguous'),/TASK_SESSION_LINK_AMBIGUOUS/);
  assert.equal(f.state.enters,0);
 });

 it('rejects generic dispatch for linked and ambiguously multi-linked tasks before any write',async()=>{
  const f=fixture();const sessions=new SessionRepository(f.db,f.user.id);
  const session=sessions.create({projectId:f.project.id,name:'linked',aiTool:'codex',workingDir:f.project.path});
  for(let links=1;links<=2;links++){
   const item=f.pm.createWorkItem(f.project.id,{title:`Linked ${links}`});
   f.pm.updateWorkItem(f.project.id,item.id,{details:withTaskPacketSessionLink(item.details,session,f.project)});
   const before=(f.db.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
   await assert.rejects(f.actions.executeOwner('session.dispatch',{sessionId:session.id,message:'Bypass the task packet'},`generic-${links}`),/TASK_SESSION_REQUIRES_PACKET_EXECUTION/);
   assert.equal((f.db.prepare('SELECT total_changes() AS n').get() as {n:number}).n,before);
   assert.equal(f.state.staged.length,0);assert.equal(f.state.enters,0);assert.equal(f.state.starts,0);
  }
 });
 it('does not attribute a completion hook from a restarted session generation to the dispatched attempt',async()=>{
  const f=fixture();const item=f.pm.createWorkItem(f.project.id,{title:'Restarted'});
  const result=await f.actions.executeOwner('pm.task.execute',{projectId:f.project.id,workItemId:item.id},'before-restart') as {session:{id:string}};
  new SessionRepository(f.db,f.user.id).update(result.session.id,{attachToken:'replacement-test-session-generation'});
  f.notify();
  assert.equal(f.pm.getWorkItem(f.project.id,item.id)?.status,'in_progress');
  const progress=getTaskProgress({db:f.db,userId:f.user.id},f.project.id,item.id);
  assert.equal(progress.found&&progress.notifications.length,0);
  assert.equal(f.state.enters,1);
 });
 for(const intervention of ['noteManualInput','takeover','sendInput'] as const){
  it(`does not consume completion evidence after ${intervention} intervenes in the session`,async()=>{
   const f=fixture();const item=f.pm.createWorkItem(f.project.id,{title:intervention});
   const result=await f.actions.executeOwner('pm.task.execute',{projectId:f.project.id,workItemId:item.id},`before-${intervention}`) as {session:{id:string}};
   if(intervention==='noteManualInput')f.manager.noteManualInput(f.user.id,result.session.id);
   else if(intervention==='takeover')f.manager.takeoverSession(f.user.id,result.session.id);
   else await f.manager.sendInput(result.session.id,'operator follow-up');
   f.notify();
   const updated=f.pm.getWorkItem(f.project.id,item.id)!;
   assert.equal(updated.status,'in_progress');
   const attempt=readTaskPacketDetails(updated.details).attempt as {manualInterventionAt?:string;consumedNotificationId?:string};
   assert.equal(typeof attempt.manualInterventionAt,'string');assert.equal(attempt.consumedNotificationId,undefined);
   const progress=getTaskProgress({db:f.db,userId:f.user.id},f.project.id,item.id);
   assert.equal(progress.found&&progress.notifications.length,0);
  });
 }
 it('restarts a disappeared backend after NOT_READY even when its cached session still claims running',async()=>{
  const f=fixture({ready:false});const item=f.pm.createWorkItem(f.project.id,{title:'Recover runtime'});const input={projectId:f.project.id,workItemId:item.id};
  const first=await f.actions.executeOwner('pm.task.execute',input,'before-backend-loss') as {executionStatus:string;sessionId:string};
  assert.equal(first.executionStatus,'incomplete');assert.equal(f.state.starts,1);
  assert.equal(f.manager.getSession(first.sessionId)?.status,'running');
  const probes=f.state.livenessProbes;f.state.backendAlive=false;f.setReady();
  const result=await f.actions.executeOwner('pm.task.execute',input,'after-backend-loss') as {session:{id:string};dispatch:{dispatched:boolean}};
  assert.equal(result.session.id,first.sessionId);assert.equal(result.dispatch.dispatched,true);
  assert.ok(f.state.livenessProbes>probes);assert.equal(f.state.starts,2);assert.equal(f.state.enters,1);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM sessions').get() as {n:number}).n,1);
 });

});
