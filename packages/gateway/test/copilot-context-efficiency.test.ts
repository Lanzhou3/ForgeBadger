import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';
import { AgentMemoryRepository } from '../src/services/agent/memory.js';
import { buildCompressedContext } from '../src/services/agent/context.js';
import { createAgentLlmClient } from '../src/services/agent/llm-client.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';

function fixture(t:TestContext) {
  const db=new Database(':memory:');
  migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations',import.meta.url).pathname});
  t.after(()=>db.close());
  const userId=new UserRepository(db).create('efficiency@test.invalid','hash').id;
  return {db,userId};
}
const llm:AgentLlmClient={async stream(){return {message:'done'};},async summarize(){throw new Error('summary unavailable');},async generateTitle(){return '';},async proposeMemory(){return [];}};

it('keeps old prompt prefix stable and recalls only complete identified memory entries',async t=>{
  const {db,userId}=fixture(t),log=new CopilotConversationLog(db,userId),memory=new AgentMemoryRepository(db,userId);
  const conv=log.createConversation();
  log.appendMessage(conv.id,{role:'user',kind:'text',content:'original goal'});
  log.appendMessage(conv.id,{role:'assistant',kind:'text',content:'original answer'});
  log.appendMessage(conv.id,{role:'user',kind:'text',content:'pnpm'});
  const small=memory.create({scope:'global',kind:'fact',text:'pnpm belongs to this project.'});
  const large=memory.create({scope:'global',kind:'fact',text:'pnpm '+ 'long fact '.repeat(100)});
  const context=await buildCompressedContext(log,conv.id,llm,undefined,{memory,memoryRecallBudget:220});
  assert.equal(context.messages[0]?.content,'original goal');
  const recall=context.messages.find(m=>m.content.includes('[相关记忆]'));
  assert.ok(recall?.content.includes(small.id));
  assert.ok(recall?.content.includes(small.text));
  assert.ok(!recall?.content.includes(large.id));
  assert.ok(!recall?.content.includes('long fact'));
  assert.equal(context.messages.at(-1)?.content,'pnpm');
});
it('strict overflow recovery does not silently discard history on failed summarization',async t=>{
  const {db,userId}=fixture(t),log=new CopilotConversationLog(db,userId),conv=log.createConversation();
  for(let i=0;i<12;i++)log.appendMessage(conv.id,{role:i%2?'assistant':'user',kind:'text',content:'history '.repeat(500)});
  log.appendMessage(conv.id,{role:'user',kind:'text',content:'keep exact current goal'});
  await assert.rejects(buildCompressedContext(log,conv.id,llm,undefined,{maxContextChars:16000,strictCompression:true}),/summary unavailable/);
  assert.equal(log.getConversation(conv.id)?.summary_covered_sequence ?? 0,0);
});
for(const strictCompression of [false,true])it(`lease takeover stops all subsequent summary calls, strict=${strictCompression}`,async t=>{
  const {db,userId}=fixture(t),ledger=new CopilotRunLedger(db,userId),conv=ledger.log.createConversation();
  for(let i=0;i<12;i++)ledger.log.appendMessage(conv.id,{role:i%2?'assistant':'user',kind:'text',content:'prior facts '.repeat(500)});
  const runId=ledger.admit({userId,conversationId:conv.id,userText:'retain goal'},16);
  const claim=ledger.claim(runId,'worker',60000)!;let calls=0;
  await assert.rejects(buildCompressedContext(ledger.log,conv.id,{...llm,async summarize(){
    calls++;db.prepare('UPDATE copilot_runs SET fence=fence+1 WHERE id=?').run(runId);return 'summary';
  }},undefined,{maxContextChars:16000,strictCompression,canCommit:()=>ledger.owns(claim)}),/COPILOT_LEASE_LOST/);
  assert.equal(calls,1);assert.equal(ledger.log.getConversation(conv.id)?.summary,null);
});
for(const apiFormat of ['anthropic','openai'] as const)it(`${apiFormat}: explicit cache only marks stable Anthropic system blocks`,async t=>{
  const {db,userId}=fixture(t),repo=new ModelProviderRepository(db,userId,'a'.repeat(64));
  const provider=repo.createProviderProfile({name:'fixture',providerKey:'fixture',baseUrl:'https://provider.example',authType:'api_key',apiFormat,supportedAdapters:['codex']});
  repo.createModelProfile({providerProfileId:provider.id,name:'M',modelId:'fixture',isDefault:true,capabilities:['chat']});
  repo.createCredential({providerProfileId:provider.id,label:'fixture',plaintextSecret:'fixture'});
  const bodies:Array<Record<string,unknown>>=[];
  const client=createAgentLlmClient({modelProviderRepository:repo,resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async(_url,init)=>{
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json(apiFormat==='anthropic'?{content:[{type:'text',text:'done'}],stop_reason:'end_turn'}:{choices:[{message:{content:'done'},finish_reason:'stop'}]});
  }});
  for(const content of ['first user goal','different user goal'])await client.stream({messages:[{role:'user',content}],tools:[],onEvent(){}});
  if(apiFormat==='anthropic'){
    assert.deepEqual(bodies[0]!.system,bodies[1]!.system);
    assert.ok(Array.isArray(bodies[0]!.system));
    assert.deepEqual((bodies[0]!.system as Array<{cache_control:unknown}>)[0]?.cache_control,{type:'ephemeral'});
    assert.doesNotMatch(JSON.stringify(bodies[0]!.messages),/cache_control/);
  }else assert.doesNotMatch(JSON.stringify(bodies),/cache_control/);
});
