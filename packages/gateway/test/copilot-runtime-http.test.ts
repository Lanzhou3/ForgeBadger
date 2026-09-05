import assert from "node:assert/strict";
import { it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createGatewayApp } from "../src/server.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { signJwt } from "../src/auth/jwt.js";

it("HTTP accepts before model completion, restores durable runs, rejects busy edits and awaits cancellation", async()=>{
  const db=new Database(":memory:");
  migrate(drizzle(db),{migrationsFolder:new URL("../src/db/migrations",import.meta.url).pathname});
  const masterKey="a".repeat(32),jwtSecret="b".repeat(32);
  const user=new UserRepository(db).create("http-runtime@example.com","hash");
  const headers={Authorization:`Bearer ${signJwt({userId:user.id,email:user.email},jwtSecret)}`,"Content-Type":"application/json"};
  const log=new CopilotConversationLog(db,user.id);const c=log.createConversation();
  const other=log.createConversation();const foreign=log.appendMessage(other.id,{role:"user",kind:"text",content:"original"});
  const repo=new ModelProviderRepository(db,user.id,masterKey);
  const provider=repo.createProviderProfile({name:"fixture",providerKey:"fixture",baseUrl:"https://8.8.8.8",apiFormat:"openai",authType:"api_key",supportedAdapters:["opencode"]});
  repo.createCredential({providerProfileId:provider.id,label:"test",plaintextSecret:"fixture-key"});
  repo.createModelProfile({providerProfileId:provider.id,name:"fixture",modelId:"fixture",capabilities:["chat"],isDefault:true});
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const app=createGatewayApp({db,masterKey,jwtSecret,
    sessionManager:new InMemorySessionManager({async listSessions(){return[];},async createSession(){},async killSession(){},async capturePane(){return "";}} as never),
    apiKeyStore:new InMemoryApiKeyStore({masterKey}),llmFetch:async()=>{await gate;return new Response(JSON.stringify({choices:[{message:{content:"late"}}]}));}});
  await new Promise<void>(resolve=>app.server.listen(0,"127.0.0.1",resolve));
  const address=app.server.address();assert.ok(address && typeof address!=="string");
  const base=`http://127.0.0.1:${address.port}/api/v1/copilot`;
  async function post(path:string,body:unknown={}) {return fetch(base+path,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(2000)});}
  try {
    assert.equal((await post(`/conversations/${c.id}/edit-message`,{messageId:foreign.id,content:"attack"})).status,404);
    assert.equal(log.listMessages(other.id)[0]?.content,"original");
    const accepted=await post(`/conversations/${c.id}/messages`,{content:"slow"});assert.equal(accepted.status,201);
    const {data:{runId}}=await accepted.json() as {data:{runId:string}};
    const busy=await post(`/conversations/${c.id}/messages`,{content:"duplicate"});assert.equal(busy.status,409);
    assert.equal(log.listMessages(c.id).filter(m=>m.role==="user").length,1);
    const snapshot=await fetch(base+`/conversations/${c.id}/runs`,{headers});
    const state=await snapshot.json() as {data:{activeRun:{id:string}}};assert.equal(state.data.activeRun.id,runId);
    const target=log.listMessages(c.id)[0]!;
    assert.equal((await post(`/conversations/${c.id}/edit-message`,{messageId:target.id,content:"edited"})).status,409);
    const cancelled=await post(`/runs/${runId}/cancel`);
    assert.deepEqual((await cancelled.json() as {data:unknown}).data,{cancelled:true,runId});
    release();await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(log.getRun(runId)?.status,"cancelled");
    assert.equal(log.listMessages(c.id).some(m=>m.content==="late"),false);
  } finally {release();await app.close();}
});
