import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from "node:url";
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';

it('runs at most three real Git reads, serializes intervening writes and preserves result order', async () => {
 const root=mkdtempSync(join(tmpdir(),'fb-parallel-')),db=new Database(':memory:');
 let timer:ReturnType<typeof setInterval>|undefined;
 try {
  execFileSync('git',['init','-q',root]);writeFileSync(join(root,'a.ts'),'export const a=1;\n');
  migrate(drizzle(db),{migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
  const userId=new UserRepository(db).create('parallel@test.dev','hash').id;
  const project=new ProjectRepository(db,userId).create({name:'P',path:root,aiTool:'codex'});
  const ledger=new CopilotRunLedger(db,userId),conversationId=ledger.log.createConversation('Parallel').id;
  const runId=ledger.admit({userId,conversationId,userText:'Inspect'},3);
  db.exec(`CREATE TRIGGER assert_serial_write BEFORE UPDATE OF status ON copilot_run_steps
    WHEN NEW.status='running' AND NEW.tool_name='pm_create_work_item'
    BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM copilot_run_steps WHERE run_id=NEW.run_id AND kind='tool' AND status='running') THEN RAISE(ABORT,'write crossed reads') END; END;
    CREATE TRIGGER assert_read_barrier BEFORE UPDATE OF status ON copilot_run_steps
    WHEN NEW.status='running' AND NEW.tool_call_id IN ('git3','git4')
    BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM copilot_run_steps WHERE run_id=NEW.run_id AND tool_name='pm_create_work_item' AND status='completed') THEN RAISE(ABORT,'read crossed write') END; END;`);
  let peak=0,calls=0;
  timer=setInterval(()=>{peak=Math.max(peak,ledger.steps(runId).filter(s=>s.kind==='tool'&&s.status==='running').length);},1);
  const orchestrator=createCopilotOrchestrator({db,masterKey:'a'.repeat(64),eventBus:new ForgeBadgerEventBus(),toolRegistry:createAgentToolRegistry(createPlatformTools()),llm:{
   async stream(request){
    if(++calls===1) for(let i=0;i<5;i++) {
     if(i===3)request.onEvent({type:'tool_call',toolCall:{id:'write',name:'pm_create_work_item',arguments:JSON.stringify({projectId:project.id,title:'Barrier task'})}});
     request.onEvent({type:'tool_call',toolCall:{id:`git${i}`,name:'read_project_diff',arguments:JSON.stringify({projectId:project.id,includeUntracked:true})}});
    }
    else assert.deepEqual(request.messages.filter(m=>m.role==='tool').map(m=>m.toolCallId),['git0','git1','git2','write','git3','git4']);
    return {message:'done',usage:{totalTokens:10}};
   },async summarize(){return '';},async generateTitle(){return '';},async proposeMemory(){return [];}
  }});
  await orchestrator.executeRun(userId,runId);
  assert.equal(ledger.get(runId)?.status,'completed');assert.equal(peak,3);
  assert.equal((db.prepare('SELECT count(*) n FROM project_manager_work_items WHERE user_id=?').get(userId) as {n:number}).n,1);
 }finally{if(timer)clearInterval(timer);db.close();rmSync(root,{recursive:true,force:true});}
});

for(const interruption of ['cancel','fence','read-error'] as const) it(`settles concurrent real reads safely after ${interruption}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'fb-read-boundary-')),db=new Database(':memory:');
 let timer:ReturnType<typeof setInterval>|undefined;
 try {
  execFileSync('git',['init','-q',root]);writeFileSync(join(root,'a.ts'),'export const a=1;\n');
  migrate(drizzle(db),{migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
  const userId=new UserRepository(db).create('boundary@test.dev','hash').id;
  const project=new ProjectRepository(db,userId).create({name:'P',path:root,aiTool:'codex'});
  const ledger=new CopilotRunLedger(db,userId),conversationId=ledger.log.createConversation().id;
  const runId=ledger.admit({userId,conversationId,userText:'Inspect'},3);let calls=0,interrupted=false;
  const orchestrator=createCopilotOrchestrator({db,masterKey:'a'.repeat(64),eventBus:new ForgeBadgerEventBus(),toolRegistry:createAgentToolRegistry(createPlatformTools()),llm:{
   async stream(request){
    if(++calls===1)for(let i=0;i<5;i++)request.onEvent({type:'tool_call',toolCall:{id:`read${i}`,name:'read_project_diff',arguments:JSON.stringify({projectId:interruption==='read-error'&&i===1?'missing':project.id,includeUntracked:true})}});
    else {const receipts=request.messages.filter(m=>m.role==='tool');assert.deepEqual(receipts.map(m=>m.toolCallId),['read0','read1','read2','read3','read4']);assert.match(receipts[1]!.content,/Denied|not found|error/i);}
    return {message:'done',usage:{totalTokens:10}};
   },async summarize(){return '';},async generateTitle(){return '';},async proposeMemory(){return [];}
  }});
  if(interruption!=='read-error')timer=setInterval(()=>{
   if(interrupted||ledger.steps(runId).filter(s=>s.kind==='tool'&&s.status==='running').length!==3)return;
   interrupted=true;
   if(interruption==='cancel')ledger.cancel(runId);
   else {db.prepare('UPDATE copilot_runs SET lease_expires_at=0 WHERE id=?').run(runId);assert.ok(ledger.claim(runId,'successor',120000));}
  },1);
  await orchestrator.executeRun(userId,runId);
  if(interruption==='read-error'){assert.equal(ledger.get(runId)!.status,'completed');assert.equal(calls,2);}
  else {
   assert.equal(interrupted,true);assert.equal(calls,1,'old worker must not advance the model');
   assert.equal(ledger.log.listMessages(conversationId).filter(m=>m.role==='tool').length,0,'late receipts must not enter the transcript');
   assert.equal(ledger.steps(runId).filter(s=>s.tool_call_id==='read3'||s.tool_call_id==='read4').every(s=>s.status==='pending'),true);
   assert.equal(ledger.get(runId)!.status,interruption==='cancel'?'cancelled':'running');
   if(interruption==='fence')assert.equal(ledger.get(runId)!.lease_owner,'successor');
  }
 }finally{if(timer)clearInterval(timer);db.close();rmSync(root,{recursive:true,force:true});}
});
