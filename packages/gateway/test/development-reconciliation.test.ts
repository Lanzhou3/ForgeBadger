import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { PlatformActionRepository } from '../src/db/repositories/platform-action-repository.js';
import { DevelopmentTaskRepository } from '../src/db/repositories/development-task-repository.js';
import { reconcileDevelopmentTask } from '../src/services/development/reconciliation.js';

function fixture(t:TestContext,migrationsFolder=new URL('../src/db/migrations',import.meta.url).pathname) {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'fb-reconciliation-'))),db=new Database(path.join(root,'fixture.db'));
 db.pragma('foreign_keys=ON');migrate(drizzle(db),{migrationsFolder});
 const userId=new UserRepository(db).create('reconcile@test.local','hash').id,otherId=new UserRepository(db).create('other@test.local','hash').id;
 const project=new ProjectRepository(db,userId).create({name:'P',path:root,aiTool:'codex'}),intents=new PlatformActionRepository(db,userId);
 const intent=intents.create({actor_user_id:userId,authority:'owner_action',command_id:'development.task.submit',input_json:'{}',digest:'test',resources_json:'{}',policy_version:1,expires_at:1,idempotency_key:'fixture',status:'approved'},{kind:'owner_api'});
 const tasks=new DevelopmentTaskRepository(db,userId),task=tasks.create({project_id:project.id,goal:'Fixture',plan_json:'{}',recipe_digest:'recipe',source_digest:'source',output_digest:'output',intent_id:intent.id,origin_run_id:null,origin_step_id:null,project_root:root});
 tasks.claim('worker');tasks.recover(Date.now()+30000);const row=tasks.get(task.id)!;
 t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
 return {root,db,userId,otherId,project,tasks,row,input:{taskId:row.id,projectId:project.id,expectedRevision:row.revision}};
}
it('forward migration adds nullable execution identity and reconciliation without altering unknown historical tasks',t=>{
 const f=fixture(t);assert.equal(f.row.execution_identity_json,null);assert.equal(f.row.reconciliation_json,null);
 assert.equal(f.db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
});
it('legacy unknown execution remains fenced with a concrete identity remedy',t=>{
 const f=fixture(t);assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,f.input),/IDENTITY_MISSING/);
 assert.equal(f.tasks.get(f.row.id)!.status,'indeterminate');assert.equal(f.tasks.get(f.row.id)!.revision,f.row.revision);
});
it('cross-tenant and stale revision cannot reconcile another execution',t=>{
 const f=fixture(t);assert.throws(()=>reconcileDevelopmentTask(f.db,f.otherId,f.input),/NOT_FOUND/);
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,{...f.input,expectedRevision:f.row.revision-1}),/STALE/);
});

const boot='00000000-0000-4000-8000-000000000001';
function ended(f:ReturnType<typeof fixture>,write=true) {
 const nonce='00000000-0000-4000-8000-000000000002',directory=path.join(f.root,'development-workspaces','.execution-evidence');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const identity={version:1,phase:'ready',userId:f.userId,taskId:f.row.id,owner:f.row.owner,nonce,bootIdentity:boot,supervisorPid:654321,processGroup:654321,startIdentity:'Sun Oct  4 12:00:00 2026',evidencePath:path.join(directory,nonce+'.json')};
 f.db.prepare('UPDATE copilot_development_tasks SET execution_identity_json=? WHERE id=?').run(JSON.stringify(identity),f.row.id);
 if(write)fs.writeFileSync(identity.evidencePath,JSON.stringify({version:1,identity,stopped:true,finishedAt:Date.now()}),{mode:0o600});
 return identity;
}
const noProcesses={bootIdentity:()=>boot,groupHasProcesses:()=>false};
function reserved(f:ReturnType<typeof fixture>) {
 const {supervisorPid,processGroup,startIdentity,...reservation}=ended(f,false);
 const identity={...reservation,phase:'reserved'};
 f.db.prepare('UPDATE copilot_development_tasks SET execution_identity_json=? WHERE id=?').run(JSON.stringify(identity),f.row.id);
 return identity;
}
it('releases a reserved execution after a trusted host reboot without addressing an old process group',t=>{
 const f=fixture(t);reserved(f);
 const result=reconcileDevelopmentTask(f.db,f.userId,f.input,{bootIdentity:()=> '00000000-0000-4000-8000-000000000003',groupHasProcesses:()=>{throw Error('Reservation has no process group');}});
 assert.equal(result.status,'failed');assert.equal(result.owner,null);
 assert.equal(JSON.parse(result.reconciliation_json!).basis,'host_reboot');
});
it('keeps a reserved execution fenced on the same boot',t=>{
 const f=fixture(t),identity=reserved(f);
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,f.input,{bootIdentity:()=>identity.bootIdentity,groupHasProcesses:()=>{throw Error('Reservation has no process group');}}),/RESERVATION_UNCONFIRMED/);
 assert.equal(f.tasks.get(f.row.id)!.status,'indeterminate');
});
it('cannot treat an unavailable boot identity as evidence of a host reboot',t=>{
 const f=fixture(t);reserved(f);
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,f.input,{...noProcesses,bootIdentity:()=>''}),/BOOT_IDENTITY_UNAVAILABLE/);
 assert.equal(f.tasks.get(f.row.id)!.status,'indeterminate');
});
it('compares boot UUIDs case-insensitively and preserves reserved tenant and revision fences',t=>{
 const f=fixture(t),identity={...reserved(f),bootIdentity:'AAAAAAAA-0000-4000-8000-000000000001'};
 f.db.prepare('UPDATE copilot_development_tasks SET execution_identity_json=? WHERE id=?').run(JSON.stringify(identity),f.row.id);
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.otherId,f.input,noProcesses),/NOT_FOUND/);
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,f.input,{...noProcesses,bootIdentity:()=>identity.bootIdentity.toLowerCase()}),/RESERVATION_UNCONFIRMED/);
 const observer={...noProcesses,bootIdentity:()=>{f.db.prepare('UPDATE copilot_development_tasks SET revision=revision+1 WHERE id=?').run(f.row.id);return boot;}};
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,f.input,observer),/STALE/);
 assert.equal(f.tasks.get(f.row.id)!.status,'indeterminate');
});
for(const field of ['userId','taskId','owner','evidencePath'] as const)it(`rejects a reserved execution with mismatched ${field}`,t=>{
 const f=fixture(t),identity=reserved(f);
 f.db.prepare('UPDATE copilot_development_tasks SET execution_identity_json=? WHERE id=?').run(JSON.stringify({...identity,[field]:'mismatched'}),f.row.id);
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,f.input,noProcesses),/IDENTITY_MISMATCH/);
 assert.equal(f.tasks.get(f.row.id)!.status,'indeterminate');
});
it('trusted stopped evidence plus absent private group releases the slot while outcome stays unknown',t=>{
 const f=fixture(t);ended(f);
 const result=reconcileDevelopmentTask(f.db,f.userId,f.input,noProcesses);
 assert.equal(result.status,'failed');assert.equal(result.owner,null);assert.equal(result.revision,f.row.revision+1);
 const evidence=JSON.parse(result.reconciliation_json!);assert.equal(evidence.outcome,'unknown');assert.equal(evidence.basis,'supervisor_stopped');
 assert.match(result.error!,/unknown|Unknown/);assert.ok(f.tasks.pendingEvents().some(e=>e.status==='failed'));
});
it('PID absence and lease expiry alone cannot release a task without independent stopped evidence',t=>{
 const f=fixture(t);ended(f,false);
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,f.input,noProcesses),/EVIDENCE_UNAVAILABLE/);
 assert.equal(f.tasks.get(f.row.id)!.status,'indeterminate');
});
it('stopped evidence cannot release a still occupied private process group',t=>{
 const f=fixture(t);ended(f);
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,f.input,{...noProcesses,groupHasProcesses:()=>true}),/STILL_ACTIVE/);
 assert.equal(f.tasks.get(f.row.id)!.status,'indeterminate');
});
it('a trusted different host boot proves the old fully identified execution has ended',t=>{
 const f=fixture(t);ended(f,false);
 const result=reconcileDevelopmentTask(f.db,f.userId,f.input,{bootIdentity:()=> '00000000-0000-4000-8000-000000000003',groupHasProcesses:()=>{throw Error('Old group must never be addressed on a new boot');}});
 assert.equal(result.status,'failed');assert.equal(JSON.parse(result.reconciliation_json!).basis,'host_reboot');
});
for(const variant of ['nonce','symlink','oversize','permissions'] as const)it(`rejects ${variant} stopped file evidence`,t=>{
 const f=fixture(t),identity=ended(f);
 if(variant==='nonce')fs.writeFileSync(identity.evidencePath,JSON.stringify({version:1,identity:{...identity,nonce:'different'},stopped:true,finishedAt:Date.now()}));
 if(variant==='symlink'){fs.renameSync(identity.evidencePath,identity.evidencePath+'.real');fs.symlinkSync(identity.evidencePath+'.real',identity.evidencePath);}
 if(variant==='oversize')fs.writeFileSync(identity.evidencePath,'x'.repeat(32768));
 if(variant==='permissions')fs.chmodSync(identity.evidencePath,0o644);
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,f.input,noProcesses),/EVIDENCE/);
 assert.equal(f.tasks.get(f.row.id)!.status,'indeterminate');
});
it('revision and execution owner are fenced again after the OS observation',t=>{
 const f=fixture(t);ended(f);
 const observer={...noProcesses,groupHasProcesses:()=>{f.db.prepare('UPDATE copilot_development_tasks SET revision=revision+1 WHERE id=?').run(f.row.id);return false;}};
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,f.input,observer),/STALE/);
 assert.equal(f.tasks.get(f.row.id)!.status,'indeterminate');assert.equal(f.tasks.get(f.row.id)!.reconciliation_json,null);
});
it('disabled actors cannot release executions',t=>{
 const f=fixture(t);ended(f);f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.userId);
 assert.throws(()=>reconcileDevelopmentTask(f.db,f.userId,f.input,noProcesses),/ACTOR_REVOKED/);
});

it('owner Web reconcile API enforces JWT, tenant scope, revision and rejects caller supplied stopped evidence',async t=>{
 const f=fixture(t),{default:express}=await import('express'),{authenticate}=await import('../src/auth/middleware.js'),{signJwt}=await import('../src/auth/jwt.js'),{createCopilotDevelopmentRoutes}=await import('../src/routes/copilot-development.js');
 const app=express();app.locals.db=f.db;app.locals.jwtSecret='fixture-jwt-secret-long-enough-32-chars';app.use(express.json());app.use(authenticate);app.use('/api/v1/copilot',createCopilotDevelopmentRoutes(f.db));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const base='http://127.0.0.1:'+ (server.address() as {port:number}).port+'/api/v1/copilot/development/tasks/'+f.row.id+'/reconcile';
 const token=signJwt({userId:f.userId,email:'reconcile@test.local'},app.locals.jwtSecret),other=signJwt({userId:f.otherId,email:'other@test.local'},app.locals.jwtSecret);
 const post=(body:unknown,jwt?:string)=>fetch(base,{method:'POST',headers:{'content-type':'application/json',...(jwt?{authorization:'Bearer '+jwt}:{})},body:JSON.stringify(body)});
 const input={projectId:f.input.projectId,expectedRevision:f.input.expectedRevision};
 assert.equal((await post(input)).status,401);assert.equal((await post(input,other)).status,404);
 assert.equal((await post({...input,stopped:true},token)).status,400);
 const response=await post(input,token);assert.equal(response.status,409);const body=await response.json() as {details:{code:string;remedy:string}};
 assert.equal(body.details.code,'DEVELOPMENT_RECONCILIATION_IDENTITY_MISSING');assert.match(body.details.remedy,/Legacy/);
 assert.equal(f.tasks.get(f.row.id)!.status,'indeterminate');
});


it('0126 preserves a populated 0125 indeterminate task and host fence across DB reopen',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fb-0126-migration-')),root=new URL('../src/db/migrations',import.meta.url).pathname;
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));fs.mkdirSync(path.join(directory,'meta'));
 const journal=JSON.parse(fs.readFileSync(path.join(root,'meta/_journal.json'),'utf8')) as {entries:Array<{idx:number;tag:string}>};journal.entries=journal.entries.filter(e=>e.idx<=124);
 fs.writeFileSync(path.join(directory,'meta/_journal.json'),JSON.stringify(journal));for(const entry of journal.entries)fs.copyFileSync(path.join(root,entry.tag+'.sql'),path.join(directory,entry.tag+'.sql'));
 const f=fixture(t,directory),before=f.tasks.get(f.row.id)!;migrate(drizzle(f.db),{migrationsFolder:root});
 const after=f.tasks.get(f.row.id)!;const {execution_identity_json,reconciliation_json,...remaining}=after;
 assert.deepEqual(remaining,before);assert.equal(execution_identity_json,null);assert.equal(reconciliation_json,null);
 const reopened=new Database(f.db.name);try{const repo=new DevelopmentTaskRepository(reopened,f.userId);assert.equal(repo.get(f.row.id)!.status,'indeterminate');assert.equal(repo.claim('must-not-replay'),undefined);assert.deepEqual(reopened.pragma('foreign_key_check'),[]);assert.equal(reopened.pragma('integrity_check',{simple:true}),'ok');}finally{reopened.close();}
});
