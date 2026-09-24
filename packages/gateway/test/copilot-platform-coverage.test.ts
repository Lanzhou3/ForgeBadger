import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { createPlatformCommands } from '../src/services/platform-commands/catalog.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { createAgentToolRegistry, executeAgentTool, type AgentToolContext } from '../src/services/agent/tool-registry.js';
import { visibleToolSchemas } from '../src/services/agent/tool-availability.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import type { InMemorySessionManager } from '../src/services/session-manager.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';
const names=['pm_get_goal','pm_get_work_item','pm_list_ledger','pm_get_management','get_session_writer','takeover_session'];
function fixture(){
  const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
  const user=new UserRepository(db).create('coverage@test.dev','hash');
  const other=new UserRepository(db).create('other-coverage@test.dev','hash');
  const projects=new ProjectRepository(db,user.id);
  const project=projects.create({name:'scoped',path:'/tmp/scoped-coverage',aiTool:''});
  const outside=projects.create({name:'outside',path:'/tmp/outside-coverage',aiTool:''});
  const foreign=new ProjectRepository(db,other.id).create({name:'foreign',path:'/tmp/foreign-coverage',aiTool:''});
  const session=new SessionRepository(db,user.id).create({projectId:project.id,name:'session',aiTool:'claude',workingDir:project.path,credentialMode:'host_environment'});
  const pm=new ProjectManagerRepository(db,user.id);pm.upsertGoal(project.id,{summary:'Ship scoped task',constraints:['No deployment'],acceptanceCriteria:['Tests pass']});
  const item=pm.createWorkItem(project.id,{title:'Task',acceptanceCriteria:['Observable outcome']});
  const registry=createAgentToolRegistry(createPlatformTools());
  let takenOver=0;let automated=true;
  const manager={getSession:(id:string)=>id===session.id?{...session,attachToken:'NEVER_EXPOSE_ATTACH',leaseToken:'NEVER_EXPOSE_LEASE'}:undefined,
    assertManualInputAllowed:()=>{if(automated)throw new Error('SESSION_WRITER_BUSY');},
    takeoverSession:(uid:string,id:string)=>{assert.equal(uid,user.id);assert.equal(id,session.id);takenOver++;automated=false;}} as unknown as InMemorySessionManager;
  const ctx:AgentToolContext={db,userId:user.id,masterKey:'test',source:'user',sessionManager:manager};
  const call=(name:string,input:unknown,context=ctx)=>{const tool=registry.tools.get(name);assert.ok(tool,`registered ${name}`);return executeAgentTool(tool,input,context);};
  return {db,user,other,projects,project,outside,foreign,session,pm,item,registry,manager,ctx,call,takenOver:()=>takenOver};
}
it('registers bounded schemas and enforces owner/runtime/source visibility',()=>{
  const f=fixture();try{
    for(const name of names)assert.ok(f.registry.tools.has(name),name);
    const takeover=f.registry.tools.get('takeover_session')!;assert.equal(takeover.risk,'operate');assert.equal(takeover.requiresApproval,true);
    assert.equal(takeover.inputSchema,createPlatformCommands().get('session.takeover')!.inputSchema);
    for(const options of [{hasSessionManager:true,scheduled:true},{hasSessionManager:true,reactive:true},{hasSessionManager:false},{hasSessionManager:true,isToolDisabled:(name:string)=>name==='takeover_session'}]){
      assert.equal(visibleToolSchemas(f.registry,options).some(t=>t.name==='takeover_session'),false);
    }
    assert.equal(visibleToolSchemas(f.registry,{hasSessionManager:false}).some(t=>t.name==='get_session_writer'),false);
    for(const name of names.slice(0,5)){
      assert.equal(visibleToolSchemas(f.registry,{hasSessionManager:true,scheduled:true}).some(t=>t.name===name),true);
      assert.equal(visibleToolSchemas(f.registry,{hasSessionManager:true,isToolDisabled:t=>t===name}).some(t=>t.name===name),false);
    }
    assert.ok(f.registry.tools.get('pm_list_ledger')!.inputSchema.safeParse({projectId:f.project.id,limit:100}).success);
    assert.equal(f.registry.tools.get('pm_list_ledger')!.inputSchema.safeParse({projectId:f.project.id,limit:101}).success,false);
  }finally{f.db.close();}
});
it('reads complete goal/task/management/declared ledger within tenant scope',async()=>{
  const f=fixture();try{
    const goal=await f.call('pm_get_goal',{projectId:f.project.id});assert.match(JSON.stringify(goal.output),/No deployment/);
    const item=await f.call('pm_get_work_item',{projectId:f.project.id,workItemId:f.item.id});assert.match(JSON.stringify(item.output),/Observable outcome/);
    const management=await f.call('pm_get_management',{projectId:f.project.id});assert.match(JSON.stringify(management.output),/"revision":0/);
    const events=await f.call('pm_list_ledger',{projectId:f.project.id,limit:1});assert.match(JSON.stringify(events.output),/declared/);
    for(const name of names.slice(0,4)){
      const input={projectId:f.project.id,...(name==='pm_get_work_item'?{workItemId:f.item.id}:{})};
      assert.equal((await f.call(name,input)).ok,true);
      // Reads are tenant-scoped only: the owner reads any own project (grant project scoping is gone).
      assert.equal((await f.call(name,{...input,projectId:f.outside.id})).ok,true);
      assert.equal((await f.call(name,{...input,projectId:f.foreign.id})).ok,false);
    }
  }finally{f.db.close();}
});
it('projects writer status without secrets and rejects absent runtime/foreign session',async()=>{
  const f=fixture();try{
    const result=await f.call('get_session_writer',{sessionId:f.session.id});
    assert.deepEqual(result.output,{sessionId:f.session.id,mode:'automated',autonomy:'manual_only'});
    assert.doesNotMatch(JSON.stringify(result.output),/NEVER_EXPOSE|[Tt]oken/);
    assert.equal((await f.call('get_session_writer',{sessionId:f.session.id},{...f.ctx,sessionManager:undefined})).ok,false);
    assert.equal((await f.call('get_session_writer',{sessionId:f.session.id},{...f.ctx,userId:f.other.id})).ok,false);
    assert.equal((await f.call('get_session_writer',{sessionId:'missing'})).ok,false);
  }finally{f.db.close();}
});
async function takeoverRun(f:ReturnType<typeof fixture>,options:{source?:'user'|'scheduled'|'reactive';disabled?:()=>boolean}={}){
  const ledger=new CopilotRunLedger(f.db,f.user.id);const conversation=ledger.log.createConversation('fixed');let calls=0;
  const llm={async stream({onEvent}:Parameters<AgentLlmClient['stream']>[0]){if(calls++===0)onEvent({type:'tool_call',toolCall:{id:'takeover',name:'takeover_session',arguments:JSON.stringify({sessionId:f.session.id})}});return {message:'done'};},async summarize(){return '';},async generateTitle(){return '';}} as AgentLlmClient;
  const orchestrator=createCopilotOrchestrator({db:f.db,masterKey:'test',llm,toolRegistry:f.registry,eventBus:new ForgeBadgerEventBus(),sessionManager:f.manager,isToolDisabled:name=>name==='takeover_session'&&(options.disabled?.()??false)});
  const runId=await orchestrator.runTurn({userId:f.user.id,conversationId:conversation.id,userText:'Take over this session',...(options.source?{source:options.source}:{})});
  return {ledger,orchestrator,runId};
}
it('takeover executes through an exact persisted owner approval once when project autonomy is on',async()=>{
  const f=fixture();try{
    f.projects.setCopilotAutonomy(f.project.id,true);
    const r=await takeoverRun(f);assert.equal(r.ledger.get(r.runId)?.status,'awaiting_approval');assert.equal(f.takenOver(),0);
    const action=r.ledger.log.listPendingActions(r.runId)[0]!;
    await r.orchestrator.resumeAfterApproval({userId:f.user.id,runId:r.runId,actionId:action.id,approved:true});
    assert.equal(f.takenOver(),1);assert.equal(r.ledger.get(r.runId)?.status,'completed');
    await r.orchestrator.resumeAfterApproval({userId:f.user.id,runId:r.runId,actionId:action.id,approved:true});assert.equal(f.takenOver(),1);
    assert.deepEqual((await f.call('get_session_writer',{sessionId:f.session.id})).output,{sessionId:f.session.id,mode:'manual',autonomy:'manual_only'});
    const receipts=f.db.prepare('SELECT * FROM platform_action_receipts WHERE user_id=?').all(f.user.id);assert.equal(receipts.length,1);
  }finally{f.db.close();}
});
it('autonomy-off, scheduled, reactive, disabled takeover never creates approval or effects',async()=>{
  const f=fixture();try{
    const off=await takeoverRun(f);
    assert.equal(off.ledger.log.listPendingActions(off.runId).length,0);assert.equal(f.takenOver(),0);
    const offMessages=JSON.stringify(off.ledger.log.listMessages(off.ledger.get(off.runId)!.conversation_id));
    assert.match(offMessages,/COPILOT_PROJECT_AUTONOMY_OFF/);
    assert.match(offMessages,/请在 Web 控制台项目设置中开启后重试/);
    for(const options of [{source:'scheduled' as const},{source:'reactive' as const},{disabled:()=>true}]){
      const r=await takeoverRun(f,options);assert.equal(r.ledger.log.listPendingActions(r.runId).length,0);assert.equal(f.takenOver(),0);
      assert.match(JSON.stringify(r.ledger.log.listMessages(r.ledger.get(r.runId)!.conversation_id)),/Denied|denied/);
    }
    for(const context of [{...f.ctx,source:'scheduled'},{...f.ctx,source:'reactive'}])assert.equal((await f.call('takeover_session',{sessionId:f.session.id},context)).ok,false);
  }finally{f.db.close();}
});
it('disabled takeover after pending approval has no effect',async()=>{
  const f=fixture();try{
    f.projects.setCopilotAutonomy(f.project.id,true);
    let disabled=false;const r=await takeoverRun(f,{disabled:()=>disabled});const action=r.ledger.log.listPendingActions(r.runId)[0]!;
    assert.ok(action);disabled=true;
    await r.orchestrator.resumeAfterApproval({userId:f.user.id,runId:r.runId,actionId:action.id,approved:true});
    assert.equal(f.takenOver(),0);
  }finally{f.db.close();}
});

it('redacts historical metadata keys and secret-shaped text before returning reads',async()=>{
  const f=fixture();try{
    f.db.prepare('UPDATE project_manager_goals SET details_json=?,summary=? WHERE project_id=? AND user_id=?').run(JSON.stringify({nested:{attachToken:'HISTORICAL_ATTACH',api_key:'HISTORICAL_KEY',note:'Bearer OLD_PRIVATE_TOKEN'}}),'legacy sk-ABCDEFG123',f.project.id,f.user.id);
    const result=await f.call('pm_get_goal',{projectId:f.project.id});assert.equal(result.ok,true);
    assert.doesNotMatch(JSON.stringify(result.output),/HISTORICAL_ATTACH|HISTORICAL_KEY|OLD_PRIVATE_TOKEN|sk-ABCDEFG123/);
    assert.match(JSON.stringify(result.output),/REDACTED/);
  }finally{f.db.close();}
});
it('rejects cross-tenant writer and stale resources; unexpected writer errors fail closed',async()=>{
  const f=fixture();try{
    const outsideSession=new SessionRepository(f.db,f.user.id).create({projectId:f.outside.id,name:'outside',aiTool:'claude',workingDir:f.outside.path,credentialMode:'host_environment'});
    assert.equal((await f.call('get_session_writer',{sessionId:outsideSession.id})).ok,true,'same-tenant cross-project writer reads stay allowed');
    const foreignSession=new SessionRepository(f.db,f.other.id).create({projectId:f.foreign.id,name:'foreign',aiTool:'claude',workingDir:f.foreign.path,credentialMode:'host_environment'});
    assert.equal((await f.call('get_session_writer',{sessionId:foreignSession.id})).ok,false);
    const brokenManager={getSession:()=>({}),assertManualInputAllowed:()=>{throw new Error('storage unavailable');}};
    const result=await f.call('get_session_writer',{sessionId:f.session.id},{...f.ctx,sessionManager:brokenManager});assert.equal(result.ok,false);assert.match(result.error??'',/storage unavailable/);
    assert.equal((await f.call('takeover_session',{sessionId:f.session.id})).ok,false,'direct forged write without approved intent');
    const missing=await f.call('pm_get_work_item',{projectId:f.outside.id,workItemId:f.item.id});assert.deepEqual(missing.output,{found:false,workItem:null,evidenceSource:'declared'});
    new ProjectRepository(f.db,f.user.id).delete(f.outside.id);
    assert.equal((await f.call('pm_get_goal',{projectId:f.outside.id})).ok,false);
    assert.equal(f.takenOver(),0);
  }finally{f.db.close();}
});
