import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { createAgentLlmClient } from '../src/services/agent/llm-client.js';
import { providerRejection } from '../src/services/agent/provider-error.js';

for(const scenario of [
  {status:400,error:{code:'context_length_exceeded',message:'secret-fixture'},expected:'AGENT_CONTEXT_OVERFLOW'},
  {status:413,error:{type:'invalid_request_error',message:'prompt is too long: 50000 tokens > 32000 maximum'},expected:'AGENT_CONTEXT_OVERFLOW'},
  {status:413,error:{message:'upload too large'},expected:'AGENT_HTTP_ERROR'},
  {status:401,error:{code:'context_length_exceeded'},expected:'AGENT_HTTP_ERROR'},
  {status:400,error:{message:'context parameter invalid'},expected:'AGENT_HTTP_ERROR'},
])it(`classifies ${scenario.status}/${JSON.stringify(scenario.error)} without leaking body`,async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations',import.meta.url).pathname});
  const userId=new UserRepository(db).create('overflow@test.invalid','hash').id;
  const repo=new ModelProviderRepository(db,userId,'a'.repeat(64));
  const p=repo.createProviderProfile({name:'P',providerKey:'fixture',baseUrl:'https://provider.example',authType:'api_key',apiFormat:'openai',supportedAdapters:['codex']});
  repo.createModelProfile({providerProfileId:p.id,name:'M',modelId:'fixture',isDefault:true,capabilities:['chat']});
  repo.createCredential({providerProfileId:p.id,label:'fixture',plaintextSecret:'fixture'});
  const client=createAgentLlmClient({modelProviderRepository:repo,resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async()=>Response.json({error:scenario.error},{status:scenario.status})});
  await assert.rejects(client.stream({messages:[{role:'user',content:'goal'}],tools:[],onEvent(){}}),error=>{
    assert.equal((error as {code:string}).code,scenario.expected);
    assert.doesNotMatch(String(error),/secret-fixture/);return true;
  });
});
it('bounds error-body classification and aborts a stalled rejection body',async()=>{
  const large=Response.json({error:{code:'context_length_exceeded',message:'x'.repeat(9000)}},{status:400});
  assert.equal((await providerRejection(large,new AbortController().signal)).code,'AGENT_HTTP_ERROR');
  let cancelled=false;
  const stalled=new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:400});
  await assert.rejects(providerRejection(stalled,AbortSignal.timeout(25)),/abort|timeout/i);
  assert.equal(cancelled,true);
});
