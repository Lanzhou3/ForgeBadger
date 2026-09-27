import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { createAgentLlmClient } from '../src/services/agent/llm-client.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { CopilotPreferencesRepository } from '../src/db/repositories/copilot-preferences-repository.js';

interface WireRequest { model:string; messages:Array<{role:string;content:unknown}> }
function fixture(t:TestContext, fetchReply:(body:WireRequest)=>Response) {
  const root=mkdtempSync(join(tmpdir(),'fb-efficiency-'));
  const db=new Database(join(root,'test.sqlite'));
  t.after(()=>{if(db.open)db.close();rmSync(root,{recursive:true,force:true});});
  migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations',import.meta.url).pathname});
  const userId=new UserRepository(db).create('runtime-efficiency@test.invalid','hash').id;
  const project=new ProjectRepository(db,userId).create({name:'fixture',path:root,aiTool:'codex'});
  writeFileSync(join(root,'a.ts'),'export const a = 1;');writeFileSync(join(root,'b.ts'),'export const b = 2;');
  const repo=new ModelProviderRepository(db,userId,'a'.repeat(64));
  const provider=repo.createProviderProfile({name:'P',providerKey:'fixture',baseUrl:'https://provider.example',authType:'api_key',apiFormat:'openai',supportedAdapters:['codex']});
  const model=repo.createModelProfile({providerProfileId:provider.id,name:'M',modelId:'fixture',isDefault:true,capabilities:['chat']});
  repo.createCredential({providerProfileId:provider.id,label:'fixture',plaintextSecret:'fixture'});
  const preferences=new CopilotPreferencesRepository(db,userId,'a'.repeat(64));
  const client=createAgentLlmClient({modelProviderRepository:repo,preferences,resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async(_url,init)=>fetchReply(JSON.parse(String(init?.body)))});
  const ledger=new CopilotRunLedger(db,userId),conv=ledger.log.createConversation('Quality fixture');
  const orchestrator=createCopilotOrchestrator({db,masterKey:'a'.repeat(64),eventBus:new ForgeBadgerEventBus(),llm:client,maxSteps:12,
    toolRegistry:createAgentToolRegistry(createPlatformTools().filter(tool=>['read_project_file'].includes(tool.name)))});
  const read=(id:string,path='a.ts')=>({id,type:'function',function:{name:'read_project_file',arguments:JSON.stringify({projectId:project.id,path})}});
  const admit=()=>ledger.admit({userId,conversationId:conv.id,projectId:project.id,userText:'Read both files, preserve exact current goal.'},12);
  return {root,db,userId,project,model,repo,provider,preferences,client,ledger,conv,orchestrator,read,admit};
}
function reply(content:string,toolCalls:unknown[]=[]) {
  return Response.json({choices:[{message:{content,tool_calls:toolCalls},finish_reason:toolCalls.length?'tool_calls':'stop'}],usage:{prompt_tokens:200,completion_tokens:20,total_tokens:220}});
}
const overflow=()=>Response.json({error:{code:'context_length_exceeded'}},{status:400});

it('recovers one rejected context without replaying real reads across multiple files',async t=>{
  let calls=0,summaries=0;const bodies:WireRequest[]=[];
  const f=fixture(t,body=>{
    if(String(body.messages[0]?.content).includes('conversation summarizer')){summaries++;return reply('Keep the original constraint. Source evidence remains in tool receipts.');}
    bodies.push(body);calls++;
    if(calls===1)return reply('',[f.read('a'),f.read('b','b.ts')]);
    if(calls===2)return overflow();
    assert.equal(body.messages.filter(m=>m.role==='tool').length,2);
    assert.match(JSON.stringify(body),/preserve exact current goal/);
    return reply('Both files verified.');
  });
  for(let i=0;i<8;i++)f.ledger.log.appendMessage(f.conv.id,{role:i%2?'assistant':'user',kind:'text',content:'old conversation '.repeat(400)});
  const runId=f.admit();await f.orchestrator.executeRun(f.userId,runId);
  assert.equal(f.ledger.get(runId)?.status,'completed');assert.equal(calls,3);assert.ok(summaries>0);
  assert.ok(JSON.stringify(bodies[2]).length<JSON.stringify(bodies[1]).length);
  const reads=f.ledger.steps(runId).filter(step=>step.kind==='tool');
  assert.equal(reads.length,2);assert.ok(reads.every(step=>step.attempt===1));
  assert.equal(f.ledger.steps(runId).filter(step=>step.kind==='model').at(-1)?.attempt,2);
});

it('stops repeated unchanged file reads before spending the entire step budget',async t=>{
  let calls=0;const f=fixture(t,()=>reply('',[f.read(`call-${++calls}`)]));
  const runId=f.admit();await f.orchestrator.executeRun(f.userId,runId);
  assert.equal(f.ledger.get(runId)?.status,'stopped');
  assert.equal(f.ledger.get(runId)?.stop_reason,'COPILOT_NO_PROGRESS');
  assert.equal(calls,3);
});
it('does not mistake changed file content for a no-progress loop',async t=>{
  let calls=0;const f=fixture(t,()=>{
    calls++;if(calls===5)return reply('done');
    writeFileSync(join(f.root,'a.ts'),`export const a = ${calls};`);
    return reply('',[f.read(`call-${calls}`)]);
  });
  const runId=f.admit();await f.orchestrator.executeRun(f.userId,runId);
  assert.equal(f.ledger.get(runId)?.status,'completed');assert.equal(calls,5);
});
it('does not retry an overflow when the immutable current goal cannot shrink',async t=>{
  let calls=0;const f=fixture(t,()=>{calls++;return overflow();});
  const runId=f.admit();await f.orchestrator.executeRun(f.userId,runId);
  assert.equal(f.ledger.get(runId)?.status,'failed');assert.equal(calls,1);
});

function history(f:ReturnType<typeof fixture>) {
  for(let i=0;i<8;i++)f.ledger.log.appendMessage(f.conv.id,{role:i%2?'assistant':'user',kind:'text',content:'past evidence '.repeat(500)});
}
it('pins the model during recovery even if preferences change at the rejected request',async t=>{
  let calls=0;const seen:string[]=[];
  const f=fixture(t,body=>{
    seen.push(body.model);
    if(String(body.messages[0]?.content).includes('conversation summarizer'))return reply('Preserved old constraint.');
    if(++calls===1){f.preferences.set({modelId:second.id});return overflow();}
    return reply('done');
  });
  const second=f.repo.createModelProfile({providerProfileId:f.provider.id,name:'other',modelId:'other',capabilities:['chat']});
  history(f);const runId=f.admit();await f.orchestrator.executeRun(f.userId,runId);
  assert.equal(f.ledger.get(runId)?.status,'completed');assert.equal(calls,2);
  assert.ok(seen.every(model=>model==='fixture'));
});
it('stops after a second overflow without another shrink or request',async t=>{
  let calls=0;const f=fixture(t,body=>{
    if(String(body.messages[0]?.content).includes('conversation summarizer'))return reply('old constraint');
    calls++;return overflow();
  });
  history(f);const runId=f.admit();await f.orchestrator.executeRun(f.userId,runId);
  assert.equal(f.ledger.get(runId)?.status,'failed');assert.equal(calls,2);
  assert.equal(f.ledger.get(runId)?.stop_reason,'AGENT_CONTEXT_OVERFLOW');
});
it('cancellation at rejection prevents both summary and recovery calls',async t=>{
  let calls=0,runId='';const f=fixture(t,()=>{calls++;f.ledger.cancel(runId);return overflow();});
  history(f);runId=f.admit();await f.orchestrator.executeRun(f.userId,runId);
  assert.equal(f.ledger.get(runId)?.status,'cancelled');assert.equal(calls,1);
});
it('an interrupted occupied recovery never issues another model call after file DB reopen',async t=>{
  let calls=0;const f=fixture(t,()=>{calls++;return reply('unexpected');});
  const runId=f.admit(),claim=f.ledger.claim(runId,'old-worker',1000)!;
  const step=f.ledger.modelStep(claim)!;f.ledger.startStep(claim,step);
  assert.equal(f.ledger.claimContextRecovery(claim,step.id,f.model.id,16000),true);
  f.db.prepare('UPDATE copilot_runs SET lease_expires_at=0 WHERE id=?').run(runId);
  f.db.close();
  const reopened=new Database(join(f.root,'test.sqlite'));
  try {
    const runtime=createCopilotOrchestrator({db:reopened,masterKey:'a'.repeat(64),eventBus:new ForgeBadgerEventBus(),llm:f.client,toolRegistry:createAgentToolRegistry([])});
    await runtime.executeRun(f.userId,runId);
    const restored=new CopilotRunLedger(reopened,f.userId);
    assert.equal(restored.get(runId)?.stop_reason,'COPILOT_CONTEXT_RECOVERY_INTERRUPTED');
    assert.equal(calls,0);
  }finally{reopened.close();}
});
