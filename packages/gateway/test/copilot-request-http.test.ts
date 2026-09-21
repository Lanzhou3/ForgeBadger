import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createGatewayApp } from '../src/server.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { CopilotGrantRepository } from '../src/db/repositories/copilot-grant-repository.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { createPlatformCommands } from '../src/services/platform-commands/catalog.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { InMemoryApiKeyStore } from '../src/secrets/api-key-store.js';
import { signJwt } from '../src/auth/jwt.js';
import { MAX_CONTEXT_CHARS } from '../src/services/agent/context.js';
async function fixture(grantBound=false){
  const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations',import.meta.url).pathname});
  const masterKey='a'.repeat(32),jwtSecret='b'.repeat(32);
  const user=new UserRepository(db).create('request-http@test.dev','hash');
  const outsider=new UserRepository(db).create('request-outsider@test.dev','hash');
  const headers=(u=user)=>({Authorization:`Bearer ${signJwt({userId:u.id,email:u.email},jwtSecret)}`,'Content-Type':'application/json'});
  const ledger=new CopilotRunLedger(db,user.id);const c=ledger.log.createConversation('fixed title');
  const project=new ProjectRepository(db,user.id).create({name:'Selected project with no memory',path:'/tmp/copilot-request-project',aiTool:''});
  const grant=grantBound?new PlatformActions({db,userId:user.id},createPlatformCommands()).createGrant({name:'test scope',projectIds:[project.id],capabilities:['pm.work_item.create'],expiresAt:Date.now()+100000,maxActions:5}):undefined;
  const providerRepo=new ModelProviderRepository(db,user.id,masterKey);
  const provider=providerRepo.createProviderProfile({name:'fixture',providerKey:'fixture',baseUrl:'https://8.8.8.8',apiFormat:'openai',authType:'api_key',supportedAdapters:['opencode']});
  providerRepo.createCredential({providerProfileId:provider.id,label:'test',plaintextSecret:'fixture-key'});
  providerRepo.createModelProfile({providerProfileId:provider.id,name:'fixture',modelId:'fixture',capabilities:['chat'],isDefault:true});
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const requests:string[]=[];
  const app=createGatewayApp({db,masterKey,jwtSecret,sessionServerIpcPath:'/tmp/forgebadger-test-session-server.sock',
    sessionManager:new InMemorySessionManager({async listSessions(){return[];},async createSession(){},async killSession(){},async capturePane(){return '';}} as never),
    apiKeyStore:new InMemoryApiKeyStore({masterKey}),llmFetch:async(_url,init)=>{
      requests.push(String(init?.body));await gate;
      const message=requests.length===1?{content:'',tool_calls:[{id:'one-call',type:'function',function:{name:grantBound?'pm_create_work_item':'list_projects',arguments:JSON.stringify(grantBound?{projectId:project.id,title:'Exactly once'}:{})}}]}:{content:'done'};
      return new Response(JSON.stringify({choices:[{finish_reason:requests.length===1?'tool_calls':'stop',message}]}),{headers:{'Content-Type':'application/json'}});
    }});
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const address=app.server.address();assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}/api/v1/copilot`;
  const post=(body:unknown,u=user)=>fetch(`${base}/conversations/${c.id}/messages`,{method:'POST',headers:headers(u),body:JSON.stringify(body),signal:AbortSignal.timeout(4000)});
  return {db,user,outsider,ledger,c,project,grant,requests,release,app,post};
}
async function waitFor(check:()=>boolean){for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('condition did not become true');}
for(const grantBound of [false,true]) it(`HTTP deduplicates running/completed request and protects authority (Grant=${grantBound})`,async()=>{
  const f=await fixture(grantBound);try{
    const payload={content:'Inspect selected project',projectId:f.project.id,clientRequestId:'same-logical-submit',...(f.grant?{grantId:f.grant.id}:{})};
    const first=await f.post(payload);assert.equal(first.status,201);
    const runId=(await first.json() as {data:{runId:string}}).data.runId;
    await waitFor(()=>f.requests.length===1);
    const retry=await f.post(payload);assert.equal(retry.status,201);assert.equal((await retry.json() as {data:{runId:string}}).data.runId,runId);
    assert.equal((await f.post({...payload,content:'Different goal'})).status,409);
    assert.equal((await f.post(payload,f.outsider)).status,404);
    assert.equal(f.requests.length,1);assert.equal(f.ledger.log.listMessages(f.c.id).filter(m=>m.role==='user').length,1);
    f.release();await waitFor(()=>f.ledger.get(runId)?.status==='completed');
    const after=await f.post(payload);assert.equal(after.status,201);assert.equal((await after.json() as {data:{runId:string}}).data.runId,runId);
    assert.equal(f.requests.length,2);assert.equal(f.ledger.steps(runId).filter(s=>s.kind==='tool').length,1);
    assert.equal(f.ledger.log.listRuns(f.c.id).length,1);
    if(f.grant){
      assert.equal((f.db.prepare('SELECT count(*) n FROM platform_action_receipts WHERE user_id=?').get(f.user.id) as {n:number}).n,1);
      assert.equal((f.db.prepare('SELECT count(*) n FROM project_manager_work_items WHERE user_id=? AND project_id=?').get(f.user.id,f.project.id) as {n:number}).n,1,'one real work item effect');
      new CopilotGrantRepository(f.db,f.user.id).revoke(f.grant.id);
      assert.equal((await f.post(payload)).status,400);
    }
    const wire=JSON.parse(f.requests[0]!) as {messages:{content:string}[]};
    assert.ok(wire.messages.some(m=>m.content.includes(f.project.id)&&m.content.includes(f.project.name)),'selected project must exist without memories');
    for(const request of f.requests)assert.ok(request.length<=MAX_CONTEXT_CHARS,'complete provider JSON fits the application bound');
    f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id);
    assert.equal((await f.post(payload)).status,401);assert.equal(f.requests.length,2);
  }finally{f.release();await f.app.close();}
});
