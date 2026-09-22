import {seedLegacyPolicy,seedLegacyReceipt} from './fixtures/legacy-delivery.js';
import {createDeliveryActionsRoutes} from '../src/routes/collaboration-delivery-actions.js';
import {DeliveryActions} from '../src/services/collaboration/delivery-actions.js';
import type {GithubTransport,DraftPullRequestInput} from '../src/services/collaboration/github-pull-requests.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import express from 'express';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { signJwt } from '../src/auth/jwt.js';
import { createCollaborationRoutes } from '../src/routes/collaboration.js';
import { DeliveryService } from '../src/services/collaboration/delivery-service.js';
import { validateTerminalRuntimeAuthorization } from '../src/websocket/terminal-runtime-authorization.js';

import {InMemorySessionManager} from '../src/services/session-manager.js';
import type {TerminalBackendClient} from '../src/services/terminal-backend.js';

interface RunDto {id:string;sessionId:string|null;state:string;baseCommit:string;error:string|null}
interface ReceiptDto {id:string;commit:string;status:string;current:boolean}
interface TaskDto {id:string;revision:number}
async function fixture() {
 const root=mkdtempSync(path.join(tmpdir(),'fb-collaboration-')),source=path.join(root,'source');mkdirSync(source);
 const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(source,'init','-b','main');git(source,'config','user.email','fixture@example.invalid');git(source,'config','user.name','Fixture');
 writeFileSync(path.join(source,'check.cjs'),'process.exit(0)\n');writeFileSync(path.join(source,'README.md'),'baseline\n');git(source,'add','.');git(source,'commit','-m','initial');
 const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});db.pragma('foreign_keys=ON');
 const users=new UserRepository(db),owner=users.create('owner@example.invalid','fixture'),developer=users.create('developer@example.invalid','fixture'),reviewer=users.create('reviewer@example.invalid','fixture'),viewer=users.create('viewer@example.invalid','fixture'),outsider=users.create('outsider@example.invalid','fixture');
 const project=new ProjectRepository(db,owner.id).create({name:'Shared project',path:source,aiTool:'codex'});
 const backend:TerminalBackendClient={supportsConfirmedSessionStop:()=>true,confirmedStopAuthority:async()=>({pid:12345,startedAt:'2026-09-20T00:00:00.000Z'}),async createSession(){throw new Error('Fixture does not launch terminals');},async killSession(){},async capturePane(){return '';},async listSessions(){return [];},async hasSession(){return false;}};
 const sessionManager=new InMemorySessionManager(backend,undefined,undefined,{db});
 const options={db,sessionManager,workspacesRoot:path.join(root,'workspaces')},service=new DeliveryService(options),app=express(),secret=randomBytes(32).toString('hex');app.locals.jwtSecret=secret;app.use(express.json());app.use('/api/v1/collaboration',createCollaborationRoutes(options,service));app.use('/api/v1/collaboration',createDeliveryActionsRoutes(service));app.use((_req,res)=>{res.status(404).json({code:1,message:'NOT_FOUND'});});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
 const url=`http://127.0.0.1:${address.port}/api/v1/collaboration`,base=`/projects/${project.id}`;
 async function request<T=Record<string,unknown>>(user:typeof owner,method:string,route:string,input?:unknown) {
  const res=await fetch(url+route,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${signJwt({userId:user.id,email:user.email},secret)}`},...(input===undefined?{}:{body:JSON.stringify(input)})});
  return {status:res.status,body:await res.json() as {code:number;data:T;message:string;details?:{code:string}}};
 }
 seedLegacyPolicy(db,owner.id,project.id,source);
 function historicalReceipt(user:typeof owner,id:string,commit:string) {return {status:200,body:{data:seedLegacyReceipt(service,user.id,project.id,id,commit)}};}
 async function members() {for(const [user,role] of [[developer,'developer'],[reviewer,'reviewer'],[viewer,'viewer']] as const) assert.equal((await request(owner,'PUT',base+'/members',{email:user.email,role})).status,200);}
 async function task(user=owner) {const r=await request<{task:TaskDto}>(user,'POST',base+'/tasks',{title:'A real change',acceptanceCriteria:['Verification passes'],assigneeId:user.id});assert.equal(r.status,201);return r.body.data.task;}
 async function run(user:typeof owner,taskId:string,key=randomUUID()) {const r=await request<{run:RunDto}>(user,'POST',base+`/tasks/${taskId}/runs`,{aiTool:'codex',idempotencyKey:key});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.data.run;}
 function workspace(id:string) {return (db.prepare('SELECT workspace_path FROM delivery_runs WHERE id=?').get(id) as {workspace_path:string}).workspace_path;}
 function change(id:string){const cwd=workspace(id);writeFileSync(path.join(cwd,'README.md'),'implemented\n');git(cwd,'add','.');git(cwd,'commit','-m','task change');return git(cwd,'rev-parse','HEAD');}
 async function close() {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();rmSync(root,{recursive:true,force:true});}
 return {root,source,db,git,server,secret,owner,developer,reviewer,viewer,outsider,project,base,request,historicalReceipt,members,task,run,workspace,change,service,close};
}

test('historical personal receipt still requires exact-commit acceptance before real Git integration',async()=>{
 const f=await fixture();try {
  const task=await f.task(),run=await f.run(f.owner,task.id),commit=f.change(run.id);
  assert.equal(readFileSync(path.join(f.source,'README.md'),'utf8'),'baseline\n');
  const check=f.historicalReceipt(f.owner,run.id,commit);assert.equal(check.status,200,JSON.stringify(check.body));assert.equal(check.body.data.receipt.status,'passed');
  const review=await f.request(f.owner,'POST',f.base+`/runs/${run.id}/review`,{expectedCommit:commit,verificationId:check.body.data.receipt.id,decision:'accepted',note:'Inspected the implementation'});assert.equal(review.status,200);
  const integrated=await f.request<{run:RunDto}>(f.owner,'POST',f.base+`/runs/${run.id}/integrate`,{expectedCommit:commit});assert.equal(integrated.status,200,JSON.stringify(integrated.body));assert.equal(integrated.body.data.run.state,'integrated');
  assert.equal(readFileSync(path.join(f.source,'README.md'),'utf8'),'implemented\n');assert.equal(f.git(f.source,'rev-parse','HEAD'),commit);
 }finally{await f.close();}
});

test('team HTTP roles, actual actor audit, private tokens, outsider denial and independent review',async()=>{
 const f=await fixture();try {
  await f.members();const task=await f.task(f.developer),run=await f.run(f.developer,task.id),commit=f.change(run.id);
  assert.equal((await f.request(f.outsider,'GET',f.base)).status,404);
  assert.equal((await f.request(f.viewer,'POST',f.base+'/tasks',{title:'No',acceptanceCriteria:[]})).status,403);
  const shared=await f.request<{run:RunDto}>(f.viewer,'GET',f.base+`/runs/${run.id}`);assert.equal(shared.status,200);assert.equal(shared.body.data.run.sessionId,null);assert.ok(!JSON.stringify(shared.body).includes(f.root));assert.ok(!JSON.stringify(shared.body).includes('attachToken'));
  const check=f.historicalReceipt(f.developer,run.id,commit);assert.equal(check.status,200);
  const payload={expectedCommit:commit,verificationId:check.body.data.receipt.id,decision:'accepted',note:'Reviewed'};
  assert.equal((await f.request(f.developer,'POST',f.base+`/runs/${run.id}/review`,payload)).status,403);
  assert.equal((await f.request(f.reviewer,'POST',f.base+`/runs/${run.id}/review`,payload)).status,200);
  const audit=f.db.prepare("SELECT actor_id FROM collaboration_events WHERE task_id=? AND kind='task_created'").get(task.id) as {actor_id:string};assert.equal(audit.actor_id,f.developer.id);
  assert.equal((await f.request(f.reviewer,'POST',f.base+`/runs/${run.id}/integrate`,{expectedCommit:commit})).status,403);
 }finally{await f.close();}
});

test('membership revocation blocks legacy project/session/terminal access and rejoining cannot revive old execution',async()=>{
 const f=await fixture();try {
  await f.members();const task=await f.task(f.developer),run=await f.run(f.developer,task.id);assert.ok(run.sessionId);
  assert.equal(validateTerminalRuntimeAuthorization(f.db,f.developer.id,run.sessionId),true);
  assert.equal((await f.request(f.owner,'DELETE',f.base+`/members/${f.developer.id}`)).status,200);
  assert.equal(new SessionRepository(f.db,f.developer.id).getById(run.sessionId),undefined);
  assert.equal(validateTerminalRuntimeAuthorization(f.db,f.developer.id,run.sessionId),false);
  assert.throws(()=>new ProjectRepository(f.db,f.developer.id).import({name:'bypass',path:f.workspace(run.id),aiTool:'codex'}),/MANAGED_PROJECT_ACCESS_DENIED/);
  await f.request(f.owner,'PUT',f.base+'/members',{email:f.developer.email,role:'developer'});
  assert.equal(validateTerminalRuntimeAuthorization(f.db,f.developer.id,run.sessionId),false);
 }finally{await f.close();}
});

test('legacy acceptance edits invalidate receipts, idempotent keys cannot cross tasks and dirty recovery preserves work',async()=>{
 const f=await fixture();try {
  const task=await f.task(),key=randomUUID(),run=await f.run(f.owner,task.id,key),same=await f.run(f.owner,task.id,key);assert.equal(run.id,same.id);
  const another=await f.task();assert.equal((await f.request(f.owner,'POST',f.base+`/tasks/${another.id}/runs`,{aiTool:'codex',idempotencyKey:key})).status,409);
  const commit=f.change(run.id),check=f.historicalReceipt(f.owner,run.id,commit);assert.equal(check.body.data.receipt.status,'passed');
  new ProjectManagerRepository(f.db,f.owner.id).updateWorkItem(f.project.id,task.id,{acceptanceCriteria:['New acceptance conditions']});
  const review=await f.request(f.owner,'POST',f.base+`/runs/${run.id}/review`,{expectedCommit:commit,verificationId:check.body.data.receipt.id,decision:'accepted',note:'Old receipt'});assert.equal(review.status,409);
  writeFileSync(path.join(f.workspace(run.id),'uncommitted.txt'),'preserve me');
  const recovered=await f.request<{run:RunDto}>(f.owner,'POST',f.base+`/runs/${run.id}/recover`,{idempotencyKey:randomUUID()});assert.equal(recovered.status,200,JSON.stringify(recovered.body));assert.notEqual(recovered.body.data.run.id,run.id);assert.equal(readFileSync(path.join(f.workspace(run.id),'uncommitted.txt'),'utf8'),'preserve me');
 }finally{await f.close();}
});

test('metadata-only assignment is versioned without requiring unrelated content changes',async()=>{
 const f=await fixture();try {
  await f.members();const task=await f.task();
  const changed=await f.request<{task:TaskDto&{assigneeId:string;reviewerId:string}}>(f.owner,'PATCH',f.base+`/tasks/${task.id}`,{expectedRevision:task.revision,assigneeId:f.developer.id,reviewerId:f.reviewer.id});
  assert.equal(changed.status,200,JSON.stringify(changed.body));assert.equal(changed.body.data.task.assigneeId,f.developer.id);assert.equal(changed.body.data.task.revision,2);
  const stale=await f.request(f.owner,'PATCH',f.base+`/tasks/${task.id}`,{expectedRevision:1,assigneeId:f.owner.id});assert.equal(stale.status,409);
  const unchangedTitle=await f.request(f.owner,'PATCH',f.base+`/tasks/${task.id}`,{expectedRevision:2,title:'A real change',reviewerId:f.owner.id});assert.equal(unchangedTitle.status,200);
 }finally{await f.close();}
});

test('managed execution rejects legacy extra sessions, alias projects and direct manager bypass',async()=>{
 const {InMemorySessionManager,createFallbackLaunchPlan}=await import('../src/services/session-manager.js');
 const f=await fixture();try {
  await f.members();const task=await f.task(f.developer),run=await f.run(f.developer,task.id),cwd=f.workspace(run.id);
  const projectId=(f.db.prepare('SELECT workspace_project_id AS id FROM delivery_runs WHERE id=?').get(run.id) as {id:string}).id;
  assert.throws(()=>new SessionRepository(f.db,f.developer.id).create({projectId,name:'bypass',aiTool:'codex',workingDir:cwd}),/MANAGED_WORKSPACE_REQUIRES_TASK_WORKFLOW/);
  assert.throws(()=>new ProjectRepository(f.db,f.developer.id).create({name:'alias',path:cwd,aiTool:'codex'}),/MANAGED_WORKSPACE_REQUIRES_TASK_WORKFLOW/);
  let spawned=0;
  const manager=new InMemorySessionManager({async createSession(){spawned++;}} as unknown as import('../src/services/terminal-backend.js').TerminalBackendClient,undefined,undefined,{db:f.db});
  await assert.rejects(manager.createSession({userId:f.outsider.id,sessionId:randomUUID(),launchPlan:createFallbackLaunchPlan(f.source,'unsafe')}),/MANAGED_PROJECT_ACCESS_DENIED/);
  await assert.rejects(manager.createSession({userId:f.developer.id,sessionId:randomUUID(),launchPlan:createFallbackLaunchPlan(cwd,'unsafe')}),/MANAGED_SESSION_IDENTITY_REQUIRED/);
  assert.equal(spawned,0);
 }finally{await f.close();}
});


test('applying integration freezes legacy task edits and restart reconciles real Git without replay',async()=>{
 const f=await fixture();try {
  const task=await f.task(),run=await f.run(f.owner,task.id),commit=f.change(run.id);
  f.db.prepare("INSERT INTO delivery_operations(run_id,user_id,project_id,kind,phase,expected_commit,created_at) VALUES(?,?,?,'integrate','applying',?,?)").run(run.id,f.owner.id,f.project.id,commit,Date.now());
  assert.throws(()=>new ProjectManagerRepository(f.db,f.owner.id).updateWorkItem(f.project.id,task.id,{acceptanceCriteria:['mutated']}),/DELIVERY_INTEGRATION_IN_PROGRESS/);
  const joining=await f.request(f.owner,'PUT',f.base+'/members',{email:f.reviewer.email,role:'reviewer'});assert.equal(joining.status,409);
  f.git(f.source,'merge','--ff-only',commit);f.service.recoverInterrupted();await f.service.sweep();
  assert.equal((f.db.prepare('SELECT state FROM delivery_runs WHERE id=?').get(run.id) as {state:string}).state,'integrated');
  assert.equal(f.db.prepare('SELECT 1 FROM delivery_operations WHERE run_id=?').get(run.id),undefined);
  assert.equal(new ProjectManagerRepository(f.db,f.owner.id).getWorkItem(f.project.id,task.id)?.status,'done');
 }finally{await f.close();}
});

test('missing worktree remains reviewable and recovers into a fresh checkpoint without deleting history',async()=>{
 const f=await fixture();try {
  const task=await f.task(),run=await f.run(f.owner,task.id);rmSync(f.workspace(run.id),{recursive:true,force:true});
  const details=await f.request<{git:{error:string}}>(f.owner,'GET',f.base+`/runs/${run.id}`);assert.equal(details.status,200);assert.equal(details.body.data.git.error,'WORKSPACE_UNAVAILABLE');
  const next=await f.request<{run:RunDto}>(f.owner,'POST',f.base+`/runs/${run.id}/recover`,{idempotencyKey:randomUUID()});assert.equal(next.status,200,JSON.stringify(next.body));assert.notEqual(next.body.data.run.id,run.id);
  assert.throws(()=>new ProjectRepository(f.db,f.owner.id).delete(f.project.id),/DELIVERY_HISTORY_REQUIRES_ARCHIVE/);
 }finally{await f.close();}
});

test('post-merge database failure retains unknown intent and reconciliation does not repeat merge',async()=>{
 const f=await fixture();try {
  const task=await f.task(),run=await f.run(f.owner,task.id),commit=f.change(run.id);
  const check=f.historicalReceipt(f.owner,run.id,commit);assert.equal(check.status,200);
  assert.equal((await f.request(f.owner,'POST',f.base+`/runs/${run.id}/review`,{expectedCommit:commit,verificationId:check.body.data.receipt.id,decision:'accepted',note:'Reviewed'})).status,200);
  f.db.exec("CREATE TRIGGER test_fail_delivery_finalize BEFORE UPDATE OF state ON delivery_runs WHEN NEW.state='integrated' BEGIN SELECT RAISE(ABORT,'simulated disk write failure'); END;");
  const failed=await f.request(f.owner,'POST',f.base+`/runs/${run.id}/integrate`,{expectedCommit:commit});assert.equal(failed.status,409);
  assert.equal(f.git(f.source,'rev-parse','HEAD'),commit);
  assert.equal((f.db.prepare('SELECT phase FROM delivery_operations WHERE run_id=?').get(run.id) as {phase:string}).phase,'interrupted');
  const reflog=f.git(f.source,'reflog','--format=%H');f.db.exec('DROP TRIGGER test_fail_delivery_finalize');await f.service.sweep();
  assert.equal(f.git(f.source,'reflog','--format=%H'),reflog);
  assert.equal((f.db.prepare('SELECT state FROM delivery_runs WHERE id=?').get(run.id) as {state:string}).state,'integrated');
  assert.equal(f.db.prepare('SELECT 1 FROM delivery_operations WHERE run_id=?').get(run.id),undefined);
 }finally{await f.close();}
});

test('real source PTY blocks integration until stopped; revocation closes actual managed WebSocket and process', {timeout:30000,skip:process.platform==='win32'},async()=>{
 const {startAndConnectSessionServer}=await import('../src/services/session-server-integration.js');
 const {InMemorySessionManager}=await import('../src/services/session-manager.js');
 const {RuntimeAuthorizationInvalidator}=await import('../src/services/runtime-authorization-invalidation.js');
 const {attachTerminalWebSocket}=await import('../src/websocket/terminal.js');
 const {resolveSessionServerTokenPath}=await import('../src/services/session-server/auth-token.js');
 const {default:WebSocket}=await import('ws');
 const stateDir=mkdtempSync(path.join(tmpdir(),'fb-team-pty-')),integration=await startAndConnectSessionServer({stateDir,ipcPath:path.join(stateDir,'server.sock')});
 const f=await fixture();let socket:InstanceType<typeof WebSocket>|undefined;
 const manager=new InMemorySessionManager(integration.client,undefined,undefined,{db:f.db});f.service.options.sessionManager=manager;
 const invalidator=new RuntimeAuthorizationInvalidator();f.service.options.invalidator=invalidator;
 const launch=(cwd:string)=>({command:process.execPath,args:['-e',"console.log('PTY_READY');setInterval(()=>{},1000)"],cwd,env:{},secretEnvNames:[],credentialMode:'host_environment' as const});
 try {
  const task=await f.task(),run=await f.run(f.owner,task.id),commit=f.change(run.id);
  const check=f.historicalReceipt(f.owner,run.id,commit);assert.equal(check.status,200);
  assert.equal((await f.request(f.owner,'POST',f.base+`/runs/${run.id}/review`,{expectedCommit:commit,verificationId:check.body.data.receipt.id,decision:'accepted',note:'Reviewed'})).status,200);
  const sourceSession=new SessionRepository(f.db,f.owner.id).create({projectId:f.project.id,name:'Source terminal',workingDir:f.source,aiTool:'codex'});
  await manager.createSession({userId:f.owner.id,sessionId:sourceSession.id,launchPlan:launch(f.source)});
  const blocked=await f.request(f.owner,'POST',f.base+`/runs/${run.id}/integrate`,{expectedCommit:commit});assert.equal(blocked.status,409);assert.equal(blocked.body.details?.code,'STOP_SOURCE_CLI_BEFORE_DELIVERY');
  await manager.stopSession(sourceSession.id);
  assert.equal((await f.request(f.owner,'POST',f.base+`/runs/${run.id}/integrate`,{expectedCommit:commit})).status,200);
  await f.members();const memberTask=await f.task(f.developer),memberRun=await f.run(f.developer,memberTask.id),attachToken=randomUUID();
  const runtime=await manager.createSession({userId:f.developer.id,sessionId:memberRun.sessionId!,launchPlan:launch(f.workspace(memberRun.id)),attachToken});
  new SessionRepository(f.db,f.developer.id).update(memberRun.sessionId!,{status:'running',attachToken,runtimeSessionName:runtime.runtimeSessionName});
  attachTerminalWebSocket({server:f.server,sessionManager:manager,jwtSecret:f.secret,db:f.db,sessionServerIpcPath:integration.ipcPath,sessionServerTokenPath:resolveSessionServerTokenPath(stateDir),runtimeAuthorizationInvalidator:invalidator});
  const address=f.server.address();assert.ok(address&&typeof address!=='string');
  socket=new WebSocket(`ws://127.0.0.1:${address.port}/ws/terminal/${memberRun.sessionId}`,['forgebadger-terminal',signJwt({userId:f.developer.id,email:f.developer.email},f.secret),attachToken]);
  let output='';socket.on('message',raw=>{const message=JSON.parse(String(raw));if(message.type==='terminal_history'||message.type==='terminal_output'){output+=message.payload.data;socket!.send(JSON.stringify({type:'terminal_ack',payload:{sequence:message.payload.sequence}}));}});
  await once(socket,'open');
  for(let i=0;i<150&&!output.includes('PTY_READY');i++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(output.includes('PTY_READY'),'terminal must really attach and replay the running PTY before revocation');
  const closed=once(socket,'close');
  assert.equal((await f.request(f.owner,'DELETE',f.base+`/members/${f.developer.id}`)).status,200);
  const [code]=await closed;assert.equal(code,4403);assert.equal(await integration.client.hasSession(runtime.runtimeSessionName),false);
 }finally{socket?.terminate();await integration.stop();await f.close();rmSync(stateDir,{recursive:true,force:true});}
});


test('reconcile HTTP preserves dirty old work, exposes resolvable conflict and requires fresh verification',async()=>{
 const f=await fixture();try {
  const task=await f.task(),run=await f.run(f.owner,task.id),commit=f.change(run.id),oldPath=f.workspace(run.id);
  writeFileSync(path.join(oldPath,'uncommitted.txt'),'preserve old work');
  writeFileSync(path.join(f.source,'README.md'),'new source\n');f.git(f.source,'add','.');f.git(f.source,'commit','-m','source advanced');const sourceHead=f.git(f.source,'rev-parse','HEAD');
  const idempotencyKey=randomUUID(),route=f.base+`/runs/${run.id}/reconcile`,input={expectedCommit:commit,idempotencyKey};
  const response=await f.request<{run:RunDto}>(f.owner,'POST',route,input);assert.equal(response.status,200,JSON.stringify(response.body));const fresh=response.body.data.run;
  assert.equal(fresh.state,'ready');assert.notEqual(fresh.id,run.id);assert.equal(fresh.baseCommit,sourceHead);assert.ok(fresh.sessionId);
  const detail=await f.request<{git:{conflicts:string[]};verifications:unknown[]}>(f.owner,'GET',f.base+`/runs/${fresh.id}`);assert.deepEqual(detail.body.data.git.conflicts,['README.md']);assert.equal(detail.body.data.verifications.length,0);
  assert.equal(readFileSync(path.join(oldPath,'uncommitted.txt'),'utf8'),'preserve old work');assert.equal(f.git(oldPath,'rev-parse','HEAD'),commit);assert.equal(f.git(f.source,'rev-parse','HEAD'),sourceHead);
  const repeat=await f.request<{run:RunDto}>(f.owner,'POST',route,input);assert.equal(repeat.status,200);assert.equal(repeat.body.data.run.id,fresh.id);
  writeFileSync(path.join(f.workspace(fresh.id),'README.md'),'resolved\n');f.git(f.workspace(fresh.id),'add','.');f.git(f.workspace(fresh.id),'commit','-m','resolve conflict');
  const resolved=f.git(f.workspace(fresh.id),'rev-parse','HEAD');const verified=f.historicalReceipt(f.owner,fresh.id,resolved);assert.equal(verified.status,200);assert.equal(verified.body.data.receipt.status,'passed');
 }finally{await f.close();}
});

async function prFixture(f:Awaited<ReturnType<typeof fixture>>) {
 const task=await f.task(),run=await f.run(f.owner,task.id),commit=f.change(run.id);
 const checked=f.historicalReceipt(f.owner,run.id,commit);assert.equal(checked.status,200);
 const input:DraftPullRequestInput={repository:'sample/project',headBranch:`codex/task-${run.id}`,baseBranch:'main',title:'Verified task',body:'A draft for review',token:'fixture_transient_token',expectedCommit:commit,verificationId:checked.body.data.receipt.id};
 const pr={number:42,html_url:'https://github.com/sample/project/pull/42',state:'open',draft:true,head:{ref:input.headBranch,sha:commit,repo:{full_name:input.repository}},base:{ref:'main',repo:{full_name:input.repository}}};
 return {run,input,pr};
}

test('draft PR records verified exact SHA once and never persists transient credentials',async()=>{
 const f=await fixture();try {
  const {run,input,pr}=await prFixture(f);let posts=0;
  const io:GithubTransport=async(url,init,authorize)=>{
   authorize();assert.equal(validateTerminalRuntimeAuthorization(f.db,f.owner.id,run.sessionId!),false);
   if(url.includes('/git/ref/heads/'))return Response.json({object:{type:'commit',sha:url.endsWith('/main')?run.baseCommit:input.expectedCommit}});
   if(init.method==='POST'){posts++;return Response.json(pr);}return Response.json([]);
  };
  const actions=new DeliveryActions(f.service,io),result=await actions.pullRequest(f.owner.id,f.project.id,run.id,input);
  assert.equal(result.pullRequest.url,pr.html_url);assert.equal(result.run.prUrl,pr.html_url);
  assert.equal((await actions.pullRequest(f.owner.id,f.project.id,run.id,input)).pullRequest.number,42);assert.equal(posts,1);
  const rows=f.db.prepare('SELECT * FROM delivery_pull_requests').all();assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes(input.token));assert.equal(f.db.prepare('SELECT 1 FROM delivery_operations').get(),undefined);
 }finally{await f.close();}
});

test('uncertain GitHub POST is lookup-only after restart and can recover the original remote draft',async()=>{
 const f=await fixture();try {
  const {run,input,pr}=await prFixture(f);let posts=0,visible=false;
  const io:GithubTransport=async(url,init,authorize)=>{
   authorize();if(url.includes('/git/ref/heads/'))return Response.json({object:{type:'commit',sha:url.endsWith('/main')?run.baseCommit:input.expectedCommit}});
   if(init.method==='POST'){posts++;throw new Error('socket disconnected '+input.token);}return Response.json(visible?[pr]:[]);
  };
  await assert.rejects(new DeliveryActions(f.service,io).pullRequest(f.owner.id,f.project.id,run.id,input),/GITHUB_RESPONSE_UNCERTAIN/);
  f.service.recoverInterrupted();const restored=new DeliveryActions(new DeliveryService(f.service.options),io);
  await assert.rejects(restored.pullRequest(f.owner.id,f.project.id,run.id,input),/GITHUB_REQUEST_PENDING/);assert.equal(posts,1);
  visible=true;assert.equal((await restored.pullRequest(f.owner.id,f.project.id,run.id,input)).pullRequest.number,42);assert.equal(posts,1);
 }finally{await f.close();}
});

test('remote PR failures and concurrent revocation cannot accept stale authority',async()=>{
 const f=await fixture();try {
  const {run,input,pr}=await prFixture(f);let posts=0;
  const wrong:GithubTransport=async()=>Response.json({object:{type:'commit',sha:'0'.repeat(40)}});
  await assert.rejects(new DeliveryActions(f.service,wrong).pullRequest(f.owner.id,f.project.id,run.id,input),/REMOTE_HEAD_MISMATCH/);
  assert.equal(f.db.prepare('SELECT 1 FROM delivery_pull_requests').get(),undefined);
  const revoked:GithubTransport=async(url,init,authorize)=>{
   authorize();if(url.includes('/git/ref/heads/'))return Response.json({object:{type:'commit',sha:url.endsWith('/main')?run.baseCommit:input.expectedCommit}});
   if(init.method==='POST'){posts++;f.db.prepare("UPDATE delivery_runs SET state='revoking' WHERE id=?").run(run.id);return Response.json(pr);}return Response.json([]);
  };
  await assert.rejects(new DeliveryActions(f.service,revoked).pullRequest(f.owner.id,f.project.id,run.id,input),/EXECUTION_REVOKED/);assert.equal(posts,1);
  assert.equal((f.db.prepare('SELECT state FROM delivery_pull_requests').get() as {state:string}).state,'unknown');
  assert.equal((f.db.prepare('SELECT pr_url FROM delivery_runs WHERE id=?').get(run.id) as {pr_url:string|null}).pr_url,null);
 }finally{await f.close();}
});

test('retired verification and policy endpoints cannot change configuration or create evidence',async()=>{
 const f=await fixture();try {
  await f.members();const task=await f.task(),run=await f.run(f.owner,task.id),commit=f.change(run.id);
  const before=f.db.prepare('SELECT * FROM collaboration_projects').all();
  for(const user of [f.owner,f.developer,f.outsider]) {
   assert.equal((await f.request(user,'PUT',f.base+'/policy',{expectedRevision:1,executionEnabled:true,verification:{command:'node',args:['check.cjs'],timeoutSeconds:5}})).status,404);
   assert.equal((await f.request(user,'POST',f.base+`/runs/${run.id}/verify`,{expectedCommit:commit})).status,404);
  }
  assert.deepEqual(f.db.prepare('SELECT * FROM collaboration_projects').all(),before);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM delivery_verifications').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM delivery_operations').get().n,0);
  const old=f.historicalReceipt(f.owner,run.id,commit).body.data.receipt;
  const detail=await f.request<{verifications:ReceiptDto[]}>(f.owner,'GET',f.base+`/runs/${run.id}`);
  assert.equal(detail.status,200);assert.equal(detail.body.data.verifications[0].id,old.id);
  assert.equal((await f.request(f.outsider,'GET',f.base+`/runs/${run.id}`)).status,404);
 }finally{await f.close();}
});
