import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { CopilotGrantRepository } from '../src/db/repositories/copilot-grant-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { createPlatformCommands } from '../src/services/platform-commands/catalog.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { executeAgentTool, type AgentToolContext } from '../src/services/agent/tool-registry.js';
function fixture(grantBound=false) {
  const db=new Database(':memory:');
  migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
  const user=new UserRepository(db).create('readback@test.dev','hash');
  const ledger=new CopilotRunLedger(db,user.id);const conversation=ledger.log.createConversation();
  const project = new ProjectRepository(db,user.id).create({name:'project',path:'/tmp/readback-scope',aiTool:''});
  const grant = grantBound ? new PlatformActions({db,userId:user.id},createPlatformCommands()).createGrant({name:'readback',projectIds:[project.id],capabilities:['memory.write'],expiresAt:Date.now()+100000,maxActions:10}) : undefined;
  const runId=ledger.admit({userId:user.id,conversationId:conversation.id,userText:'inspect',...(grant?{grantId:grant.id}:{})},5);
  const step=ledger.addStep(runId,{kind:'tool',toolCallId:'call',toolName:'list_projects',inputJson:'{}'});
  const content=JSON.stringify({ok:true,output:{truncated:true,preview:'retained only'}});
  ledger.completeStep(step.id,content);
  ledger.append(runId,{role:'tool',kind:'tool_result',toolCallId:'call',toolName:'list_projects',content},step.id);
  const messageId=ledger.log.listMessages(conversation.id).at(-1)!.id;
  const tool=createPlatformTools().find(t=>t.name==='read_tool_result')!;
  const context:AgentToolContext={db,userId:user.id,masterKey:'test',conversationId:conversation.id,runId,availableToolNames:['list_projects','read_tool_result'],checkExecutionAuthority:()=>true,...(grant?{grantId:grant.id}:{})};
  return {db,user,ledger,conversation,runId,step,tool,messageId,context,content,grant,project};
}
it('reads paginated persisted receipts and reports original truncation',async()=>{
  const f=fixture();try{
    assert.ok(f.tool,'readback must be registered');
    const first=await executeAgentTool(f.tool,{messageId:f.messageId,offset:0,length:20},f.context);
    assert.equal(first.ok,true);const page=first.output as {content:string;nextOffset:number;originalOutputTruncated:boolean};
    assert.equal(page.content,f.content.slice(0,20));assert.equal(page.nextOffset,20);assert.equal(page.originalOutputTruncated,true);
  }finally{f.db.close();}
});
it('denies guessed cross-conversation/tenant ids, invisible tools and deleted histories',async()=>{
  const f=fixture();try{
    assert.ok(f.tool);
    const other=f.ledger.log.createConversation();
    const outsider=new UserRepository(f.db).create('other@test.dev','hash');
    for(const context of [{...f.context,conversationId:other.id},{...f.context,userId:outsider.id},{...f.context,availableToolNames:['read_tool_result']},{...f.context,checkExecutionAuthority:()=>false}])
      assert.equal((await executeAgentTool(f.tool,{messageId:f.messageId},context)).ok,false);
    f.db.prepare("UPDATE copilot_conversations SET status='deleted' WHERE id=?").run(f.conversation.id);
    assert.equal((await executeAgentTool(f.tool,{messageId:f.messageId},f.context)).ok,false);
  }finally{f.db.close();}
});
it('rejects unassociated legacy messages and mismatched step receipts',async()=>{
  const f=fixture();try{
    assert.ok(f.tool);
    f.db.prepare("UPDATE copilot_messages SET step_id=NULL WHERE id=?").run(f.messageId);
    assert.equal((await executeAgentTool(f.tool,{messageId:f.messageId},f.context)).ok,false);
    f.db.prepare("UPDATE copilot_messages SET step_id=?,content='changed' WHERE id=?").run(f.step.id,f.messageId);
    assert.equal((await executeAgentTool(f.tool,{messageId:f.messageId},f.context)).ok,false);
  }finally{f.db.close();}
});

it('revalidates original/current Grant and channel authority before readback',async()=>{
  const f=fixture(true);try{
    assert.equal((await executeAgentTool(f.tool,{messageId:f.messageId},f.context)).ok,true);
    assert.equal((await executeAgentTool(f.tool,{messageId:f.messageId},{...f.context,grantId:'different'})).ok,false);
    f.db.prepare('UPDATE copilot_conversations SET channel_owned=1 WHERE id=?').run(f.conversation.id);
    assert.equal((await executeAgentTool(f.tool,{messageId:f.messageId},f.context)).ok,false);
    f.db.prepare('UPDATE copilot_conversations SET channel_owned=0 WHERE id=?').run(f.conversation.id);
    new CopilotGrantRepository(f.db,f.user.id).revoke(f.grant!.id);
    assert.equal((await executeAgentTool(f.tool,{messageId:f.messageId},f.context)).ok,false);
  }finally{f.db.close();}
});
it('revalidates source resource scope and rejects nested or external readbacks',async()=>{
  const f=fixture(true);try{
    const outside=new ProjectRepository(f.db,f.user.id).create({name:'outside',path:'/tmp/readback-outside',aiTool:''});
    f.db.prepare('UPDATE copilot_run_steps SET input_json=? WHERE id=?').run(JSON.stringify({projectId:outside.id}),f.step.id);
    assert.equal((await executeAgentTool(f.tool,{messageId:f.messageId},f.context)).ok,false);
    f.db.prepare('UPDATE copilot_run_steps SET input_json=? WHERE id=?').run('{}',f.step.id);
    for(const name of ['read_tool_result','mcp_external']){
      f.db.prepare('UPDATE copilot_run_steps SET tool_name=? WHERE id=?').run(name,f.step.id);
      f.db.prepare('UPDATE copilot_messages SET tool_name=? WHERE id=?').run(name,f.messageId);
      assert.equal((await executeAgentTool(f.tool,{messageId:f.messageId},{...f.context,availableToolNames:[name,'read_tool_result']})).ok,false);
    }
  }finally{f.db.close();}
});
