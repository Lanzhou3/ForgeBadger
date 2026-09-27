import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { ForgeBadgerEventBus, type CopilotRunUpdatedEvent } from '../src/services/event-bus.js';

for(const prefix of ['Normal progress is visible.\n','正在读取项目文件。']) it(`streams ${prefix.trim()} before completion without leaking split credentials`, async () => {
 const db=new Database(':memory:');
 migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations',import.meta.url).pathname});
 try {
  const userId=new UserRepository(db).create('stream@test.dev','hash').id;
  const ledger=new CopilotRunLedger(db,userId),conversationId=ledger.log.createConversation('Stream').id;
  const eventBus=new ForgeBadgerEventBus(),events:CopilotRunUpdatedEvent[]=[];
  eventBus.on('event',event=>{if(event.type==='copilot_run_updated')events.push(event);});
  const text=prefix+'"customApiKey":\n"ordinary-fixture-value"\nBearer\nfixtureBearerValue\n';
  const orchestrator=createCopilotOrchestrator({db,masterKey:'a'.repeat(64),eventBus,toolRegistry:createAgentToolRegistry([]),llm:{
   async stream({onEvent}) {
    onEvent({type:'text_delta',text:prefix});
    assert.equal(events.map(e=>e.textDelta??'').join(''),prefix,'must stream before completion');
    for (const char of text.slice(prefix.length)) onEvent({type:'text_delta',text:char});
    onEvent({type:'thinking_delta',text:'PRIVATE_THINKING'});
    assert.doesNotMatch(JSON.stringify(events),/ordinary-fixture|fixtureBearer|PRIVATE_THINKING/);
    return {message:text};
   },async summarize(){return '';},async generateTitle(){return '';},async proposeMemory(){return [];}
  }});
  await orchestrator.runTurn({userId,conversationId,userText:'Inspect'});
  const streamed=events.map(e=>e.textDelta??'').join('');
  assert.match(streamed,/REDACTED/);assert.doesNotMatch(JSON.stringify(events),/ordinary-fixture|fixtureBearer|PRIVATE_THINKING/);
  assert.equal(streamed,ledger.log.listMessages(conversationId).filter(m=>m.role==='assistant').at(-1)?.content);
 } finally {db.close();}
});
