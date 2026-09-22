import assert from 'node:assert/strict';
import {it, type TestContext} from 'node:test';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {UserRepository} from '../src/db/repositories/user-repository.js';
import {ModelProviderRepository} from '../src/db/repositories/model-provider-repository.js';
import {createAgentLlmClient, type AgentLlmStreamEvent} from '../src/services/agent/llm-client.js';
const frame=(delta:unknown,reason:string|null=null)=>'data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:reason}]})+'\n\n';
const tool={index:0,id:'call_one',type:'function',function:{name:'list_projects',arguments:'{}'}};
const complete=frame({content:'Ready'})+frame({tool_calls:[tool]},'tool_calls');
function setup(t:TestContext,response:Response,baseUrl='https://api.minimaxi.com/v1'){
 const db=new Database(':memory:');t.after(()=>db.close());migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations',import.meta.url).pathname});
 const user=new UserRepository(db).create('minimax-stream@test.dev','hash');const repo=new ModelProviderRepository(db,user.id,'a'.repeat(32));
 const provider=repo.createProviderProfile({name:'fixture',providerKey:'fixture',baseUrl,apiFormat:'openai-compatible',allowPlaintextHttp:baseUrl.startsWith('http:'),authType:'api_key',supportedAdapters:['opencode']});
 repo.createModelProfile({providerProfileId:provider.id,name:'fixture',modelId:'MiniMax-M2',isDefault:true,capabilities:['chat']});repo.createCredential({providerProfileId:provider.id,label:'fixture',plaintextSecret:'fixture-secret'});
 const events:AgentLlmStreamEvent[]=[];
 const client=createAgentLlmClient({modelProviderRepository:repo,resolveHost:async()=>[{address:'8.8.8.8',family:4}],fetchImpl:async()=>response});
 return {events,run:()=>client.stream({messages:[{role:'user',content:'List projects once.'}],tools:[],onEvent:event=>events.push(event)})};
}
const sse=(body:string|ReadableStream<Uint8Array>)=>new Response(body,{headers:{'content-type':'text/event-stream'}});
for(const host of ['api.minimaxi.com','api.minimax.cn','api.minimax.io'])it(`accepts ${host} clean EOF with complete successful tool batch`,async t=>{
 const {events,run}=setup(t,sse(complete),'https://'+host+'/v1');const result=await run();assert.equal(result.finishReason,'tool_calls');assert.equal(events.filter(e=>e.type==='tool_call').length,1);
});
it('accepts official MiniMax text completion with explicit stop and clean EOF',async t=>{
 const {run}=setup(t,sse(frame({content:'Done'},'stop')));assert.equal((await run()).message,'Done');
});
for(const endpoint of ['https://api.example.com/v1','https://api.minimaxi.com.example.com/v1','http://api.minimaxi.com/v1'])it(`keeps DONE mandatory for ${endpoint}`,async t=>{
 const {run,events}=setup(t,sse(complete),endpoint);await assert.rejects(run(),/missing terminal marker/);assert.equal(events.some(e=>e.type==='tool_call'||e.type==='done'),false);
});
for(const [name,body] of [
 ['missing reason',frame({tool_calls:[tool]})],
 ['truncated',frame({tool_calls:[tool]},'length')],
 ['bad arguments',frame({tool_calls:[{...tool,function:{name:'list_projects',arguments:'{'}}]},'tool_calls')],
 ['duplicate IDs',frame({tool_calls:[tool,{...tool,index:1}]},'tool_calls')],
 ['trailing error',complete+'data: {"error":{"message":"fail"}}\n\n'],
 ['extra choice',complete+frame({content:'unexpected'})],
 ['half frame after termination',complete+'data: {"choices": [']
])it(`MiniMax rejects ${name} without publishing any tools`,async t=>{
 const {run,events}=setup(t,sse(body!));await assert.rejects(run());assert.equal(events.some(e=>e.type==='tool_call'||e.type==='done'),false);
});
it('waits for transport completion and rejects disconnect even after valid finish reason',async t=>{
 let source!:ReadableStreamDefaultController<Uint8Array>;
 const {run,events}=setup(t,sse(new ReadableStream({start(controller){source=controller}})));
 const pending=run();source.enqueue(new TextEncoder().encode(complete));await new Promise(r=>setTimeout(r,20));assert.equal(events.some(e=>e.type==='tool_call'||e.type==='done'),false);
 source.error(new Error('connection reset'));await assert.rejects(pending);assert.equal(events.some(e=>e.type==='tool_call'||e.type==='done'),false);
});
