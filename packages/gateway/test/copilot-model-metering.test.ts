import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from "node:url";
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { RunGovernance, meteredLlm } from '../src/services/agent/run-governance.js';
import { createAgentLlmClient } from '../src/services/agent/llm-client.js';
import { CopilotTokenRates, modelCostNanoUsd } from '../src/services/agent/model-metering.js';
import { CopilotPreferencesRepository } from '../src/db/repositories/copilot-preferences-repository.js';
import { usage } from '../src/services/agent/llm-response.js';

it('meters real client main and auxiliary responses once with immutable pre-call prices',async()=>{
 const db=new Database(':memory:');
 try {
  migrate(drizzle(db),{migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
  const userId=new UserRepository(db).create('meter@test.dev','hash').id;
  const repo=new ModelProviderRepository(db,userId,'a'.repeat(64));
  const provider=repo.createProviderProfile({name:'P',providerKey:'test',baseUrl:'https://api.example.com',authType:'api_key',apiFormat:'openai-compatible',supportedAdapters:['codex']});
  const model=repo.createModelProfile({providerProfileId:provider.id,name:'M',modelId:'fixture',isDefault:true,capabilities:['chat']});
  repo.createCredential({providerProfileId:provider.id,label:'fixture',plaintextSecret:'fixture'});
  const rates=new CopilotTokenRates(db,userId);
  rates.set(model.id,{inputUsdPerMillion:2,outputUsdPerMillion:10,cachedInputUsdPerMillion:0.5});
  const ledger=new CopilotRunLedger(db,userId),run=ledger.admit({userId,conversationId:ledger.log.createConversation().id,userText:'inspect'},2);ledger.claim(run,'worker',120000);
  const meter=new RunGovernance(db,userId,run);
  const llm=meteredLlm(createAgentLlmClient({modelProviderRepository:repo,resolveHost:async()=>[{address:'8.8.8.8',family:4}],fetchImpl:async(_url,init)=>{
    assert.deepEqual(JSON.parse(String(init?.body)).stream_options,{include_usage:true});
    rates.set(model.id,{inputUsdPerMillion:200,outputUsdPerMillion:1000,cachedInputUsdPerMillion:50});
    return Response.json({choices:[{message:{role:'assistant',content:'Summary'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:40},completion_tokens_details:{reasoning_tokens:5}}});
  }}),meter,()=>{});
  await llm.stream({messages:[{role:'user',content:'hello'}],tools:[],onEvent:()=>{}});
  assert.equal(meter.usage().costUsd,0.00034);
  await llm.summarize({messages:[{role:'user',content:'history'}]});
  assert.equal(meter.usage().reportedTokens,240);assert.equal(meter.usage().estimatedCalls,0);
  assert.equal(meter.usage().costUsd,0.03434);
  await meter.measure('missing','input',async()=>({}));
  assert.equal(meter.usage().costUsd,null);assert.equal(meter.usage().knownCostUsd,0.03434);
  const other=new UserRepository(db).create('other-meter@test.dev','hash').id;
  assert.throws(()=>new CopilotTokenRates(db,other).get(model.id),/MODEL_NOT_FOUND/);
 }finally{db.close();}
});

it('normalizes cache and reasoning without double counting, distinguishes free from unpriced',()=>{
 const value=usage({input_tokens:10,output_tokens:5,cache_read_input_tokens:20,cache_creation_input_tokens:30},'anthropic')!;
 assert.equal(value.inputTokens,60);
 assert.equal(modelCostNanoUsd(value,{inputUsdPerMillion:1,outputUsdPerMillion:2,cachedInputUsdPerMillion:0.1,cacheWriteUsdPerMillion:1.25}),59500);
 assert.equal(modelCostNanoUsd(value,{inputUsdPerMillion:1,outputUsdPerMillion:2}),null);
 assert.equal(modelCostNanoUsd(value,{inputUsdPerMillion:0,outputUsdPerMillion:0,cachedInputUsdPerMillion:0,cacheWriteUsdPerMillion:0}),0);
 assert.throws(()=>usage({prompt_tokens:1,prompt_tokens_details:{cached_tokens:2}},'openai'),/inconsistent/);
});

it('keeps a compatibility retry on its original model and price when preferences change in flight',async()=>{
 const db=new Database(':memory:');try{
  migrate(drizzle(db),{migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
  const userId=new UserRepository(db).create('retry-meter@example.invalid','hash').id;
  const repo=new ModelProviderRepository(db,userId,'a'.repeat(64));
  const provider=repo.createProviderProfile({name:'P',providerKey:'test',baseUrl:'https://api.example.com',authType:'api_key',apiFormat:'openai-compatible',supportedAdapters:['codex']});
  const first=repo.createModelProfile({providerProfileId:provider.id,name:'A',modelId:'model-a',isDefault:true,capabilities:['chat']});
  const second=repo.createModelProfile({providerProfileId:provider.id,name:'B',modelId:'model-b',capabilities:['chat']});
  repo.createCredential({providerProfileId:provider.id,label:'fixture',plaintextSecret:'fixture'});
  const preferences=new CopilotPreferencesRepository(db,userId,'a'.repeat(64));preferences.set({modelId:first.id,thinkingEffort:'high'});
  const rates=new CopilotTokenRates(db,userId);rates.set(first.id,{inputUsdPerMillion:1,outputUsdPerMillion:1});rates.set(second.id,{inputUsdPerMillion:100,outputUsdPerMillion:100});
  const ledger=new CopilotRunLedger(db,userId),run=ledger.admit({userId,conversationId:ledger.log.createConversation().id,userText:'hello'},3);ledger.claim(run,'worker',120000);
  const meter=new RunGovernance(db,userId,run),sent:string[]=[];let firstSignal:AbortSignal|undefined|null;
  const llm=meteredLlm(createAgentLlmClient({modelProviderRepository:repo,preferences,resolveHost:async()=>[{address:'8.8.8.8',family:4}],fetchImpl:async(_url,init)=>{
   const body=JSON.parse(String(init?.body));sent.push(body.model);
   if(sent.length===1){firstSignal=init?.signal;preferences.set({modelId:second.id});return Response.json({error:'reasoning_effort unsupported'},{status:400});}
   if(sent.length===2)assert.equal(init?.signal,firstSignal,'compatibility retry must share its original cancellation and deadline');
   return Response.json({choices:[{message:{content:'okay'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}});
  }}),meter,()=>{});
  await llm.stream({messages:[{role:'user',content:'hi'}],tools:[],onEvent:()=>{}});
  assert.deepEqual(sent,['model-a','model-a']);assert.equal(meter.usage().costUsd,0.00012);
  await llm.stream({messages:[{role:'user',content:'next'}],tools:[],onEvent:()=>{}});
  assert.deepEqual(sent,['model-a','model-a','model-b']);assert.equal(meter.usage().costUsd,0.01212);
  assert.equal(meter.usage().calls,2);assert.deepEqual(meter.calls().map(row=>JSON.parse(row.model_json!).modelId).sort(),['model-a','model-b']);
 }finally{db.close();}
});
