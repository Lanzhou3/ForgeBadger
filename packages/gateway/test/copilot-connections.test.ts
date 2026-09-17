import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotConnections } from '../src/services/extensions/connections.js';
import { createConnectionToolRegistry } from '../src/services/extensions/connection-tools.js';
import { remoteInputSchema } from '../src/services/extensions/remote-schema.js';
import { discoverMcpTools } from '../src/services/extensions/mcp-client.js';
import { publicFetch } from '../src/services/extensions/public-fetch.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { visibleToolSchemas } from '../src/services/agent/tool-availability.js';
import { executeAgentTool } from '../src/services/agent/tool-registry.js';
import { createCopilotConnectionRoutes } from '../src/routes/copilot-connections.js';
import { signJwt } from '../src/auth/jwt.js';

async function fixture(mode: 'success'|'error'|'disconnect'|'duplicate'='success') {
 const db=new Database(':memory:'); migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations/',import.meta.url).pathname});
 const user=new UserRepository(db).create(`${randomBytes(4).toString('hex')}@test.dev`,'hash');
 const masterKey=randomBytes(32).toString('hex'), secret=randomBytes(24).toString('base64url');
 let calls=0;
 const app=express();app.use(express.json());
 app.post('/mcp',async(req,res)=>{
  if(req.body.method==='tools/call'&&mode==='disconnect'){calls++;res.destroy();return;}
  const server=new Server({name:'fixture',version:'1'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'echo',description:'Echo a message',inputSchema:{type:'object' as const,properties:{message:{type:'string'}},required:['message'],additionalProperties:false}},...(mode==='duplicate'?[{name:'echo',inputSchema:{type:'object' as const}}]:[])]}));
  server.setRequestHandler(CallToolRequestSchema,async()=>{calls++;return{isError:mode==='error',content:[{type:'text' as const,text:`done ${secret}`}]};});
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined} as unknown as import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransportOptions);
  res.on('close',()=>{void transport.close();void server.close();});
  await server.connect(transport as import('@modelcontextprotocol/sdk/shared/transport.js').Transport);await transport.handleRequest(req,res,req.body);
 });
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const fetcher:typeof fetch=async(_url,init)=>fetch(`${base}/mcp`,init);
 const svc=new CopilotConnections(db,user.id,masterKey,{fetch:fetcher});
 const created=svc.create({name:'Fixture',endpoint:'https://example.com/mcp',bearerToken:secret});
 const registry=createConnectionToolRegistry([],db,user.id,masterKey,{fetch:fetcher});
 return{db,user,masterKey,secret,svc,created,registry,calls:()=>calls,fetcher,
  async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();}};
}

it('discovers real SDK tools, scopes credentials, and requires explicit tool enablement',async()=>{
 const f=await fixture();try{
  assert.equal(f.registry.tools.size,0);
  const discovered=await f.svc.discover(f.created.id,1);assert.equal(discovered.tools.length,1);assert.equal(discovered.tools[0]!.enabled,false);
  const ready=f.svc.update(discovered.id,{revision:discovered.revision,enabled:true,enabledTools:['echo']});
  assert.equal(f.registry.tools.size,1);assert.equal(ready.hasCredential,true);assert.ok(!JSON.stringify(ready).includes(f.secret));
  assert.ok(!f.svc.repo.get(ready.id)!.credential_encrypted!.includes(f.secret));
  const stranger=new CopilotConnections(f.db,'foreign',f.masterKey);assert.equal(stranger.repo.get(ready.id),undefined);
  for(const visibility of [{grantBound:true},{scheduled:true},{reactive:true}])assert.equal(visibleToolSchemas(f.registry,{hasSessionManager:false,...visibility}).length,0);
  const tool=[...f.registry.tools.values()][0]!;assert.equal((await executeAgentTool(tool,{message:'hello'},{db:f.db,userId:f.user.id,masterKey:f.masterKey})).ok,false);assert.equal(f.calls(),0);
  assert.throws(()=>f.svc.update(ready.id,{revision:1,enabled:false}),/changed/);
  f.svc.update(ready.id,{revision:ready.revision,enabled:false});assert.equal(f.registry.tools.size,0);
 }finally{await f.close();}
});

for(const mode of ['success','error','disconnect'] as const)it(`MCP ${mode}: exact approval, single call, redacted receipt and no replay`,async()=>{
 const f=await fixture(mode);try{
  let c=await f.svc.discover(f.created.id,1);c=f.svc.update(c.id,{revision:c.revision,enabled:true,enabledTools:['echo']});
  const name=[...f.registry.tools.keys()][0]!;const ledger=new CopilotRunLedger(f.db,f.user.id);let turns=0;
  const orchestrator=createCopilotOrchestrator({db:f.db,masterKey:f.masterKey,toolRegistry:f.registry,eventBus:new ForgeBadgerEventBus(),llm:{
   async stream({onEvent}){if(turns++===0)onEvent({type:'tool_call',toolCall:{id:'remote-call',name,arguments:JSON.stringify({message:'hello'})}});else onEvent({type:'text_delta',text:'Finished'});return{message:''};},async summarize(){return'';},async generateTitle(){return'';}
  }});
  const conversation=ledger.log.createConversation();const runId=await orchestrator.runTurn({userId:f.user.id,conversationId:conversation.id,userText:'Use remote echo'});
  assert.equal(ledger.get(runId)?.status,'awaiting_approval');assert.equal(f.calls(),0);
  const action=ledger.log.listPendingActions(runId)[0]!;
  await orchestrator.resumeAfterApproval({userId:f.user.id,runId,actionId:action.id,approved:true});
  assert.equal(f.calls(),1);assert.equal(ledger.get(runId)?.status,mode==='success'?'completed':'indeterminate');
  assert.ok(!JSON.stringify(ledger.log.listMessages(conversation.id)).includes(f.secret));
  await orchestrator.executeRun(f.user.id,runId);assert.equal(f.calls(),1);
 }finally{await f.close();}
});

it('configuration changes invalidate a pending approved target and preserve approval history',async()=>{
 const f=await fixture();try{
  let c=await f.svc.discover(f.created.id,1);c=f.svc.update(c.id,{revision:c.revision,enabled:true,enabledTools:['echo']});
  const name=[...f.registry.tools.keys()][0]!;const ledger=new CopilotRunLedger(f.db,f.user.id);const conv=ledger.log.createConversation();
  const runId=ledger.admit({userId:f.user.id,conversationId:conv.id,userText:'test'},3),claim=ledger.claim(runId,'fixture',30000)!;
  const step=ledger.addStep(runId,{kind:'tool',toolCallId:'a',toolName:name,inputJson:'{"message":"hello"}',effect:'write'});ledger.waitApproval(claim,step);
  const action=ledger.log.listPendingActions(runId)[0]!;
  f.svc.update(c.id,{revision:c.revision,bearerToken:null});
  const orchestrator=createCopilotOrchestrator({db:f.db,masterKey:f.masterKey,toolRegistry:f.registry,eventBus:new ForgeBadgerEventBus(),llm:{async stream(){return{message:''};},async summarize(){return'';},async generateTitle(){return'';}}});
  await assert.rejects(orchestrator.resumeAfterApproval({userId:f.user.id,runId,actionId:action.id,approved:true}),/no longer available/);
  assert.equal(ledger.log.getPendingAction(action.id)?.status,'pending');assert.equal(f.calls(),0);
 }finally{await f.close();}
});

it('rejects unsupported schemas, references, duplicate catalog names and private endpoints',async()=>{
 assert.throws(()=>remoteInputSchema({type:'object',properties:{x:{$ref:'https://evil.example/schema'}}}),/Unsupported/);
 assert.throws(()=>remoteInputSchema({type:'object',properties:{x:{type:'string',pattern:'(a+)+$'}}}),/Unsupported/);
 const schema=remoteInputSchema({type:'object',properties:{count:{type:'integer',minimum:1}},required:['count'],additionalProperties:false});
 assert.equal(schema.safeParse({count:0}).success,false);assert.equal(schema.safeParse({count:2}).success,true);assert.equal(schema.safeParse({count:2,extra:true}).success,false);
 for(const url of ['https://127.0.0.1/mcp','https://[::1]/mcp','http://example.com/mcp','https://metadata.google.internal/mcp'])await assert.rejects(publicFetch(url));
 const f=await fixture('duplicate');try{await assert.rejects(discoverMcpTools({endpoint:'https://example.com/mcp'},{fetch:f.fetcher}),/catalog/);assert.equal(f.svc.repo.get(f.created.id)?.revision,1);}finally{await f.close();}
});

it('connection API authenticates, isolates tenants, returns no credentials, and handles CAS',async()=>{
 const f=await fixture();const jwtSecret=randomBytes(32).toString('hex');process.env.FORGEBADGER_JWT_SECRET=jwtSecret;
 const other=new UserRepository(f.db).create('other@test.dev','hash');const token=signJwt({userId:f.user.id,email:f.user.email},jwtSecret);const otherToken=signJwt({userId:other.id,email:other.email},jwtSecret);
 const app=express();app.locals.db=f.db;app.locals.jwtSecret=jwtSecret;app.use(express.json());app.use('/api/v1/copilot',createCopilotConnectionRoutes(f.db,f.masterKey,{fetch:f.fetcher}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/v1/copilot/connections`;
 try{
  assert.equal((await fetch(base)).status,401);
  const list=await fetch(base,{headers:{authorization:`Bearer ${token}`}});const text=await list.text();assert.ok(text.includes('forgebadger'));assert.ok(!text.includes(f.secret));
  const foreign=await fetch(`${base}/${f.created.id}`,{method:'PUT',headers:{authorization:`Bearer ${otherToken}`,'content-type':'application/json'},body:JSON.stringify({revision:1,enabled:true})});assert.equal(foreign.status,404);
  const bad=await fetch(base,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({name:'local',endpoint:'http://127.0.0.1/mcp'})});assert.equal(bad.status,400);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.close();}
});

it('discovery stops sending after credentials change while initialization was in flight',async()=>{
 const f=await fixture();try{
  let requests=0;
  const fetcher:typeof fetch=async(url,init)=>{
   requests++;const response=await f.fetcher(url,init);
   if(requests===1)f.svc.update(f.created.id,{revision:1,bearerToken:null});
   return response;
  };
  const svc=new CopilotConnections(f.db,f.user.id,f.masterKey,{fetch:fetcher});
  await assert.rejects(svc.discover(f.created.id,1));assert.equal(requests,1);
  assert.equal(svc.repo.get(f.created.id)?.last_discovered_at,null);assert.equal(svc.repo.get(f.created.id)?.credential_encrypted,null);
 }finally{await f.close();}
});

it('reopening persisted running external write marks indeterminate without replay',async()=>{
 const f=await fixture();try{
  let c=await f.svc.discover(f.created.id,1);c=f.svc.update(c.id,{revision:c.revision,enabled:true,enabledTools:['echo']});
  const name=[...f.registry.tools.keys()][0]!;const ledger=new CopilotRunLedger(f.db,f.user.id),conversation=ledger.log.createConversation();
  const runId=ledger.admit({userId:f.user.id,conversationId:conversation.id,userText:'persist'},3),claim=ledger.claim(runId,'old-process',30000)!;
  const step=ledger.addStep(runId,{kind:'tool',toolCallId:'persist',toolName:name,inputJson:'{"message":"hello"}',effect:'write'});
  assert.ok(ledger.startStep(claim,step));
  const reopened=new Database(f.db.serialize());try{
   reopened.prepare('UPDATE copilot_runs SET lease_expires_at=0 WHERE id=?').run(runId);
   const recovered=new CopilotRunLedger(reopened,f.user.id);assert.equal(recovered.claim(runId,'new-process',30000),undefined);
   assert.equal(recovered.get(runId)?.status,'indeterminate');assert.equal(recovered.steps(runId).find(s=>s.id===step.id)?.status,'indeterminate');assert.equal(f.calls(),0);
  }finally{reopened.close();}
 }finally{await f.close();}
});
