import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {it} from 'node:test';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {ProjectRepository} from '../src/db/repositories/project-repository.js';
import {DevelopmentTaskRepository} from '../src/db/repositories/development-task-repository.js';
import {PlatformActions} from '../src/services/platform-commands/actions.js';
import {createPlatformCommands} from '../src/services/platform-commands/catalog.js';
import {startDevelopmentRuntime} from '../src/services/development/runtime.js';
import {prepareSource,readSource,sourcePath,hashText,writeWorkspace,assertWorkspace} from '../src/services/development/workspace.js';
import {assertDevelopmentAuthority} from '../src/services/development/authority.js';
import {ForgeBadgerEventBus} from '../src/services/event-bus.js';
import {createSecurityPolicy} from '../src/services/agent/security-policy.js';
import {CopilotToolPreferenceRepository} from '../src/db/repositories/copilot-tool-preference-repository.js';
import {CopilotConversationLog} from '../src/services/agent/conversation-log.js';
import {createCopilotOrchestrator} from '../src/services/agent/orchestrator.js';
import {createAgentToolRegistry} from '../src/services/agent/tool-registry.js';
import {createPlatformTools} from '../src/services/agent/tools/index.js';
import type {DevelopmentEvidence} from '../src/services/development/contracts.js';
const migrations=fileURLToPath(new URL('../src/db/migrations',import.meta.url));
const mac=process.platform==='darwin';
function fixture(testContent="const {test}=require('node:test');const a=require('node:assert/strict');test('sum',()=>a.equal(require('./sum.cjs')(2,3),5));") {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'development-runtime-')),root=path.join(dir,'project');fs.mkdirSync(root);
 const db=new Database(path.join(dir,'test.db'));db.pragma('foreign_keys=ON');migrate(drizzle(db),{migrationsFolder:migrations});
 const user=new UserRepository(db).create('dev@test.local','hash'),other=new UserRepository(db).create('other@test.local','hash');
 const project=new ProjectRepository(db,user.id).create({name:'test',path:root,aiTool:'codex'});
 fs.writeFileSync(path.join(root,'sum.cjs'),'module.exports=(a,b)=>a-b;');fs.writeFileSync(path.join(root,'sum.test.cjs'),testContent);
 const plan={projectId:project.id,goal:'Fix sum using the approved check',sourceFiles:['sum.cjs','sum.test.cjs'],changes:[{path:'sum.cjs',beforeSha256:hashText('module.exports=(a,b)=>a-b;'),content:'module.exports=(a,b)=>a+b;'}],checks:[{path:'sum.test.cjs',sha256:hashText(testContent)}]};
 const actions=new PlatformActions({db,userId:user.id,actionOrigin:{kind:'owner_api'}},createPlatformCommands()),repo=new DevelopmentTaskRepository(db,user.id),eventBus=new ForgeBadgerEventBus();
 const submit=async()=>await actions.executeOwner('development.task.submit',plan,crypto.randomUUID()) as {taskId:string;recipeDigest:string};
 return {dir,root,db,user,other,project,plan,actions,repo,eventBus,submit,close(){db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
async function until(predicate:()=>boolean,timeout=10000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw new Error('Fixture deadline exceeded');await new Promise(r=>setTimeout(r,20));}}
it('strict code payload permits relative imports but preserves path and nested validation',()=>{const f=fixture();try{
 const policy=createSecurityPolicy();const input={...f.plan,changes:[{...f.plan.changes[0],content:"const a=require('../sum.cjs')"}]};
 assert.equal(policy.evaluate({userId:f.user.id,toolName:'submit_development_task',toolRisk:'operate',requiresApproval:true,input}).action,'require_approval');
 assert.throws(()=>f.actions.preview({commandId:'development.task.submit',input:{...input,changes:[{...input.changes[0],path:'../outside'}]},authority:'owner_action',idempotencyKey:'bad'}));
 assert.throws(()=>f.actions.preview({commandId:'development.task.submit',input:{...input,changes:[{...input.changes[0],execute:'rm -rf /'}]},authority:'owner_action',idempotencyKey:'nested'}));
}finally{f.close();}});
it('rejects symlink, hidden, secret, binary and oversized reads without changing source',()=>{const f=fixture();try{
 fs.symlinkSync(path.join(f.root,'sum.cjs'),path.join(f.root,'link.cjs'));assert.throws(()=>readSource(f.root,'link.cjs'),/SYMLINK/);
 fs.symlinkSync('/missing-target',path.join(f.root,'dangling.cjs'));assert.throws(()=>sourcePath(f.root,'dangling.cjs',false),/SYMLINK/);
 for(const name of ['../outside','.env','private.key','credentials.json'])assert.throws(()=>readSource(f.root,name));
 fs.writeFileSync(path.join(f.root,'binary.js'),Buffer.from([0,1]));assert.throws(()=>readSource(f.root,'binary.js'),/NOT_TEXT/);
 fs.writeFileSync(path.join(f.root,'large.js'),'x'.repeat(65537));assert.throws(()=>readSource(f.root,'large.js'),/TOO_LARGE/);
}finally{f.close();}});
it('binds source revision and immutable checks to exact owner approval; rejects grants and tenant escape',async()=>{const f=fixture();try{
 const intent=f.actions.preview({commandId:'development.task.submit',input:f.plan,authority:'owner_action',idempotencyKey:'preview'});
 await assert.rejects(f.actions.execute(intent.id),/approved/);
 fs.writeFileSync(path.join(f.root,'sum.cjs'),'changed');assert.throws(()=>f.actions.decide(intent.id,intent.digest,true),/DRIFT/);
 assert.throws(()=>new PlatformActions({db:f.db,userId:f.other.id,actionOrigin:{kind:'owner_api'}},createPlatformCommands()).preview({commandId:'development.task.submit',input:f.plan,authority:'owner_action',idempotencyKey:'escape'}),/PROJECT_NOT_FOUND/);
 assert.throws(()=>f.actions.createGrant({name:'no',projectIds:[f.project.id],capabilities:['development.task.submit'],expiresAt:null,maxActions:null}),/Unsupported/);
}finally{f.close();}});
it('queued task/receipt survive database reopen and admission deduplicates',async()=>{const f=fixture();try{
 const first=await f.submit();const row=f.repo.get(first.taskId)!;assert.equal(row.status,'queued');assertDevelopmentAuthority(f.db,row);
 const receipt=await f.actions.execute(row.intent_id);assert.equal((receipt.result as {taskId:string}).taskId,row.id);assert.equal(f.repo.list(f.project.id).length,1);
 const reopened=new Database(path.join(f.dir,'test.db'));try{assert.equal(new DevelopmentTaskRepository(reopened,f.user.id).get(row.id)?.status,'queued');}finally{reopened.close();}
 assert.equal(new DevelopmentTaskRepository(f.db,f.other.id).get(row.id),undefined);
}finally{f.close();}});
it('revoked actor, disabled tool, expired approval and tampered receipt cannot execute a queued job',async()=>{const f=fixture();try{
 const {taskId}=await f.submit(),row=f.repo.get(taskId)!;
 new CopilotToolPreferenceRepository(f.db,f.user.id).setEnabled('submit_development_task',false);assert.throws(()=>assertDevelopmentAuthority(f.db,row),/DISABLED/);
 new CopilotToolPreferenceRepository(f.db,f.user.id).setEnabled('submit_development_task',true);
 f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id);assert.throws(()=>assertDevelopmentAuthority(f.db,row),/ACTOR/);f.db.prepare("UPDATE users SET status='active' WHERE id=?").run(f.user.id);
 f.db.prepare('UPDATE platform_action_intents SET expires_at=0 WHERE id=?').run(row.intent_id);assert.throws(()=>assertDevelopmentAuthority(f.db,row),/EXPIRED/);
}finally{f.close();}});
it('lease recovery never repeats uncertain execution or releases its concurrency slot',async()=>{const f=fixture();try{
 const {taskId}=await f.submit();assert.equal(f.repo.claim('first')?.id,taskId);assert.equal(f.repo.claim('second'),undefined);
 f.repo.recover(Date.now()+30000);assert.equal(f.repo.get(taskId)?.status,'indeterminate');assert.equal(f.repo.claim('third'),undefined);
 assert.equal(f.repo.finish(taskId,'first','checks_passed'),false);assert.throws(()=>f.repo.cancel(taskId,f.project.id),/RECONCILIATION/);
}finally{f.close();}});
it('cancelled queued task produces durable outbox event without starting a worker',async()=>{const f=fixture();try{
 const {taskId}=await f.submit();await f.actions.executeOwner('development.task.cancel',{taskId,projectId:f.project.id},'cancel');assert.equal(f.repo.get(taskId)?.status,'cancelled');assert.equal(f.repo.claim('worker'),undefined);
 assert.ok(f.repo.pendingEvents().some(e=>e.status==='cancelled'));
}finally{f.close();}});
it('rejects mutated artifact and extra hidden files during acceptance checks',()=>{const f=fixture();try{
 const p=prepareSource(f.root,f.plan),output=path.join(f.dir,'output');writeWorkspace(output,p);assertWorkspace(output,p);
 fs.writeFileSync(path.join(output,'.env'),'bad');assert.throws(()=>assertWorkspace(output,p));
}finally{f.close();}});
it('real isolated fix produces checked diff and requires explicit immutable artifact acceptance',{skip:!mac},async()=>{const f=fixture();const events:string[]=[];f.eventBus.on('event',e=>events.push(e.status));let runtime:ReturnType<typeof startDevelopmentRuntime>|undefined;try{
 const {taskId}=await f.submit();runtime=startDevelopmentRuntime({db:f.db,eventBus:f.eventBus});await runtime.ready;
 await until(()=>!['queued','running'].includes(f.repo.get(taskId)!.status));const row=f.repo.get(taskId)!;assert.equal(row.status,'checks_passed',row.error??'');
 const evidence=JSON.parse(row.evidence_json!) as DevelopmentEvidence;assert.equal(evidence.checks[0]?.exitCode,0);assert.match(evidence.diff,/a\+b/);assert.equal(fs.readFileSync(path.join(f.root,'sum.cjs'),'utf8'),'module.exports=(a,b)=>a-b;');
 const accepted=await f.actions.executeOwner('development.task.accept',{taskId,projectId:f.project.id,artifactDigest:row.artifact_digest},'accept') as {status:string};assert.equal(accepted.status,'accepted');
 runtime.tick();assert.ok(events.includes('accepted'));assert.equal(f.repo.pendingEvents().length,0);
 assert.equal(f.db.pragma('foreign_key_check').length,0);
}finally{await runtime?.stop();f.close();}});
it('real failed checks never enable acceptance',{skip:!mac},async()=>{const f=fixture("const {test}=require('node:test');test('fail',()=>{throw Error('expected failure')});");let runtime:ReturnType<typeof startDevelopmentRuntime>|undefined;try{
 const {taskId}=await f.submit();runtime=startDevelopmentRuntime({db:f.db,eventBus:f.eventBus});await runtime.ready;await until(()=>!['queued','running'].includes(f.repo.get(taskId)!.status));const row=f.repo.get(taskId)!;assert.equal(row.status,'checks_failed',row.error??'');
 assert.throws(()=>f.actions.preview({commandId:'development.task.accept',input:{projectId:f.project.id,taskId,artifactDigest:row.artifact_digest},authority:'owner_action',idempotencyKey:'bad-accept'}),/STALE/);
}finally{await runtime?.stop();f.close();}});
it('real Copilot approval creates durable task whose completed origin remains valid',{skip:!mac},async()=>{const f=fixture();let runtime:ReturnType<typeof startDevelopmentRuntime>|undefined;try{
 const log=new CopilotConversationLog(f.db,f.user.id),conversation=log.createConversation('fixture');let models=0;
 const orchestrator=createCopilotOrchestrator({db:f.db,masterKey:'x'.repeat(32),eventBus:f.eventBus,toolRegistry:createAgentToolRegistry(createPlatformTools()),llm:{async stream(req){models++;if(models===1)req.onEvent({type:'tool_call',toolCall:{id:'submit-one',name:'submit_development_task',arguments:JSON.stringify(f.plan)}});else req.onEvent({type:'text_delta',text:'Task queued, not accepted.'});return {message:''};},async summarize(){return '';},async generateTitle(){return '';},async proposeMemory(){return [];}}});
 const runId=await orchestrator.runTurn({userId:f.user.id,conversationId:conversation.id,userText:'Create the reviewed task'});assert.equal(log.getRun(runId)?.status,'awaiting_approval');const pending=log.listPendingActions(runId)[0]!;
 await orchestrator.resumeAfterApproval({userId:f.user.id,runId,actionId:pending.id,approved:true});assert.equal(log.getRun(runId)?.status,'completed');const row=f.repo.list(f.project.id)[0]!;assert.ok(row);assert.equal(row.origin_run_id,runId);assertDevelopmentAuthority(f.db,row);
 runtime=startDevelopmentRuntime({db:f.db,eventBus:f.eventBus});await runtime.ready;await until(()=>f.repo.get(row.id)?.status!=='running');assert.equal(f.repo.get(row.id)?.status,'checks_passed',f.repo.get(row.id)?.error??'');
}finally{await runtime?.stop();f.close();}});
it('revocation during a real running check cancels the process and cannot publish passed evidence',{skip:!mac},async()=>{const f=fixture("const {test}=require('node:test');test('wait',async()=>{await new Promise(r=>setTimeout(r,20000));});");let runtime:ReturnType<typeof startDevelopmentRuntime>|undefined;try{
 const {taskId}=await f.submit();runtime=startDevelopmentRuntime({db:f.db,eventBus:f.eventBus});await runtime.ready;await until(()=>!!f.repo.get(taskId)?.workspace_path);
 new CopilotToolPreferenceRepository(f.db,f.user.id).setEnabled('submit_development_task',false);await until(()=>f.repo.get(taskId)?.status!=='running');const row=f.repo.get(taskId)!;assert.equal(row.status,'failed');assert.equal(row.evidence_json,null);assert.match(row.error!,/DISABLED/);
}finally{await runtime?.stop();f.close();}});
it('cancel request during running check records cancellation and never accepts late success',{skip:!mac},async()=>{const f=fixture("const {test}=require('node:test');test('wait',async()=>{await new Promise(r=>setTimeout(r,20000));});");let runtime:ReturnType<typeof startDevelopmentRuntime>|undefined;try{
 const {taskId}=await f.submit();runtime=startDevelopmentRuntime({db:f.db,eventBus:f.eventBus});await runtime.ready;await until(()=>!!f.repo.get(taskId)?.workspace_path);
 await f.actions.executeOwner('development.task.cancel',{taskId,projectId:f.project.id},'cancel-live');await until(()=>f.repo.get(taskId)?.status!=='running');assert.equal(f.repo.get(taskId)?.status,'cancelled');
}finally{await runtime?.stop();f.close();}});
it('completed task cannot be accepted after source or persisted workspace tampering',{skip:!mac},async()=>{const f=fixture();let runtime:ReturnType<typeof startDevelopmentRuntime>|undefined;try{
 const {taskId}=await f.submit();runtime=startDevelopmentRuntime({db:f.db,eventBus:f.eventBus});await runtime.ready;await until(()=>!['running','queued'].includes(f.repo.get(taskId)!.status));const row=f.repo.get(taskId)!;assert.equal(row.status,'checks_passed');
 const input={taskId,projectId:f.project.id,artifactDigest:row.artifact_digest};fs.writeFileSync(path.join(f.root,'sum.cjs'),'new source');assert.throws(()=>f.actions.preview({commandId:'development.task.accept',input,authority:'owner_action',idempotencyKey:'drift'}),/DRIFT/);
 fs.writeFileSync(path.join(f.root,'sum.cjs'),'module.exports=(a,b)=>a-b;');fs.chmodSync(path.join(row.workspace_path!,'sum.cjs'),0o600);fs.writeFileSync(path.join(row.workspace_path!,'sum.cjs'),'tampered');assert.throws(()=>f.actions.preview({commandId:'development.task.accept',input,authority:'owner_action',idempotencyKey:'artifact'}),/DRIFT/);
}finally{await runtime?.stop();f.close();}});
it('confirmed task provenance fails closed when its Copilot origin disappears',async()=>{const f=fixture();try{
 const {taskId}=await f.submit();const row=f.repo.get(taskId)!;
 f.db.prepare("UPDATE platform_action_intents SET origin_kind='copilot',origin_run_id='missing',origin_step_id='missing' WHERE id=?").run(row.intent_id);
 f.db.prepare("UPDATE copilot_development_tasks SET origin_run_id='missing',origin_step_id='missing' WHERE id=?").run(taskId);
 assert.throws(()=>assertDevelopmentAuthority(f.db,f.repo.get(taskId)!),/ORIGIN_REVOKED/);
}finally{f.close();}});
it('global host slot serializes two tenants without exposing or replaying another tenant task',async()=>{const f=fixture();try{
 const first=await f.submit();const project=new ProjectRepository(f.db,f.other.id).create({name:'other',path:f.root,aiTool:'codex'});const actions=new PlatformActions({db:f.db,userId:f.other.id,actionOrigin:{kind:'owner_api'}},createPlatformCommands());await actions.executeOwner('development.task.submit',{...f.plan,projectId:project.id},'other');
 assert.equal(f.repo.claim('first')?.id,first.taskId);assert.equal(new DevelopmentTaskRepository(f.db,f.other.id).claim('second'),undefined);
 assert.equal(new DevelopmentTaskRepository(f.db,f.other.id).get(first.taskId),undefined);
}finally{f.close();}});
it('source pagination uses fully redacted text before every arbitrary offset',async()=>{const f=fixture();try{
 const content='// Bearer FIXTURETOKEN123456789\nmodule.exports=1;';fs.writeFileSync(path.join(f.root,'redaction.cjs'),content);
 const tool=createPlatformTools().find(t=>t.name==='read_project_file')!;
 for(const offset of [0,10,content.indexOf('FIXTURE'),content.indexOf('TOKEN')]){const output=await tool.execute({projectId:f.project.id,path:'redaction.cjs',offset,length:12},{db:f.db,userId:f.user.id,masterKey:'x'.repeat(32)}) as {content:string;sha256:string;offsetSpace:string};assert.ok(!output.content.includes('FIXTURE')&&!output.content.includes('123456789'));assert.equal(output.sha256,hashText(content));assert.equal(output.offsetSpace,'redacted_text');}
}finally{f.close();}});
it('explicit Copilot origin with missing step cannot become owner API authority',()=>{const f=fixture();try{
 const actions=new PlatformActions({db:f.db,userId:f.user.id,actionOrigin:{kind:'copilot',runId:'missing',stepId:'missing'}},createPlatformCommands());
 assert.throws(()=>actions.preview({commandId:'development.task.submit',input:f.plan,authority:'owner_action',idempotencyKey:'missing'}),/origin missing/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM platform_action_intents').get().n,0);
}finally{f.close();}});
it('nonregular FIFO input is rejected without blocking a subprocess',async()=>{const {execFileSync,spawnSync}=await import('node:child_process');const f=fixture();try{
 execFileSync('mkfifo',[path.join(f.root,'fifo.js')]);const moduleUrl=new URL('../src/services/development/workspace.ts',import.meta.url).href;
 const code=`import {readSource} from ${JSON.stringify(moduleUrl)};try{readSource(process.argv[1],'fifo.js');process.exitCode=1;}catch(e){if(e.message!=='DEVELOPMENT_SOURCE_NOT_REGULAR')throw e;}`;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code,f.root],{cwd:process.cwd(),encoding:'utf8',timeout:3000});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
}finally{f.close();}});

it('queue persistence faults are contained and retry only unclaimed queued work',async()=>{const f=fixture();let runtime:ReturnType<typeof startDevelopmentRuntime>|undefined;const errors:unknown[]=[];const original=console.error;console.error=(...args)=>errors.push(args);try{
 const {taskId}=await f.submit();f.db.pragma('query_only=ON');runtime=startDevelopmentRuntime({db:f.db,eventBus:f.eventBus});await runtime.ready;assert.doesNotThrow(()=>runtime!.tick());assert.equal(f.repo.get(taskId)?.status,'queued');assert.ok(errors.length>0);
}finally{await runtime?.stop();console.error=original;f.db.pragma('query_only=OFF');f.close();}});
it('running persistence failure aborts the real worker without publishing success or replay',{skip:!mac},async()=>{const f=fixture("const {test}=require('node:test');test('wait',async()=>{await new Promise(r=>setTimeout(r,20000));});");let runtime:ReturnType<typeof startDevelopmentRuntime>|undefined;const errors:unknown[]=[];const original=console.error;console.error=(...args)=>errors.push(args);try{
 const {taskId}=await f.submit();runtime=startDevelopmentRuntime({db:f.db,eventBus:f.eventBus});await runtime.ready;await until(()=>!!f.repo.get(taskId)?.workspace_path);f.db.pragma('query_only=ON');await until(()=>errors.length>0);await runtime.stop();assert.equal(f.repo.get(taskId)?.status,'running');assert.equal(f.repo.get(taskId)?.evidence_json,null);
 f.db.pragma('query_only=OFF');f.repo.recover(Date.now()+30000);assert.equal(f.repo.get(taskId)?.status,'indeterminate');assert.equal(f.repo.claim('retry'),undefined);
}finally{await runtime?.stop();console.error=original;f.db.pragma('query_only=OFF');f.close();}});

it('source hashes and snapshots preserve original UTF-8 BOM bytes and reject BOM-only drift',async()=>{const f=fixture();try{
 const bytes=Buffer.from('\ufeffmodule.exports=(a,b)=>a-b;');fs.writeFileSync(path.join(f.root,'sum.cjs'),bytes);const source=readSource(f.root,'sum.cjs');assert.equal(source.content.charCodeAt(0),0xfeff);assert.equal(source.sha256,hashText(bytes.toString('utf8')));assert.deepEqual(Buffer.from(source.content),bytes);
 f.plan.changes[0]!.beforeSha256=source.sha256;f.plan.changes[0]!.content='\ufeffmodule.exports=(a,b)=>a+b;';const prepared=prepareSource(f.root,f.plan),workspace=path.join(f.dir,'bom-output');writeWorkspace(workspace,prepared);assert.deepEqual(fs.readFileSync(path.join(workspace,'sum.cjs')),Buffer.from(f.plan.changes[0]!.content));
 const intent=f.actions.preview({commandId:'development.task.submit',input:f.plan,authority:'owner_action',idempotencyKey:'bom'});f.actions.decide(intent.id,intent.digest,true);fs.writeFileSync(path.join(f.root,'sum.cjs'),'module.exports=(a,b)=>a-b;');await assert.rejects(f.actions.execute(intent.id),/DRIFT/);
}finally{f.close();}});
