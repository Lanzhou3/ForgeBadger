import assert from 'node:assert/strict';
import { it } from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { RunGovernance } from '../src/services/agent/run-governance.js';
import { createCopilotRoutes } from '../src/routes/copilot.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { signJwt } from '../src/auth/jwt.js';
it('enforces authenticated owner scope, rate validation and unknown cost over real HTTP',async()=>{
 const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations',import.meta.url).pathname});
 const masterKey='a'.repeat(64),jwtSecret='b'.repeat(32),users=new UserRepository(db);
 const owner=users.create('meter-owner@test.dev','hash'),other=users.create('meter-other@test.dev','hash');
 const repo=new ModelProviderRepository(db,owner.id,masterKey),provider=repo.createProviderProfile({name:'P',providerKey:'test',baseUrl:'https://api.example.com',apiFormat:'openai-compatible',authType:'api_key',supportedAdapters:['codex']});
 const model=repo.createModelProfile({providerProfileId:provider.id,name:'M',modelId:'fixture',capabilities:['chat']});
 const ledger=new CopilotRunLedger(db,owner.id),run=ledger.admit({userId:owner.id,conversationId:ledger.log.createConversation().id,userText:'hello'},3);
 const claim=ledger.claim(run,'fixture',120000)!;
 await new RunGovernance(db,owner.id,run).measure('main','fixture',async()=>({usage:{inputTokens:5,outputTokens:2,totalTokens:7}}),r=>r.usage);
 ledger.finish(claim,'completed');
 const app=express();app.locals.db=db;app.locals.jwtSecret=jwtSecret;app.use(express.json());
 app.use('/api/v1/copilot',createCopilotRoutes({db,masterKey,eventBus:new ForgeBadgerEventBus()}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const request=(path:string,method='GET',body?:unknown,user:typeof owner|null=owner)=>fetch(`http://127.0.0.1:${address.port}/api/v1/copilot${path}`,{
  method,headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${signJwt({userId:user.id,email:user.email},jwtSecret)}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try {
  assert.equal((await request(`/runs/${run}/usage`,'GET',undefined,null)).status,401);
  for(const path of [`/runs/${run}/usage`,`/token-rates/${model.id}`])assert.equal((await request(path,'GET',undefined,other)).status,404);
  assert.equal((await request(`/runs/${run}/repairs`,'DELETE',undefined,other)).status,404);
  assert.equal((await request(`/token-rates/${model.id}`,'PUT',{inputUsdPerMillion:-1,outputUsdPerMillion:2})).status,400);
  assert.equal((await request(`/token-rates/${model.id}`,'PUT',{inputUsdPerMillion:0,outputUsdPerMillion:0})).status,200);
  const body=await (await request(`/runs/${run}/usage`)).json() as {data:{usage:{costUsd:number|null;reportedTokens:number};calls:Array<{measurement:string}>}};
  assert.equal(body.data.usage.costUsd,null,'new rates must not reprice past unpriced calls');assert.equal(body.data.usage.reportedTokens,7);assert.equal(body.data.calls[0]!.measurement,'provider_reported');
  assert.equal((await request(`/runs/${run}/repairs`,'DELETE')).status,200);
  db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(owner.id);
  assert.equal((await request(`/runs/${run}/usage`)).status,401);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();}
});
