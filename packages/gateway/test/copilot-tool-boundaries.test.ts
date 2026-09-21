import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { TOOL_COMMANDS } from '../src/services/platform-commands/tool-commands.js';

describe('Copilot active tool boundaries', () => {
  it('exposes task preparation and does not advertise retired dispatch or CLI skill tools', () => {
    const tools = createPlatformTools();
    const names = tools.map(tool => tool.name);
    assert.ok(names.includes('pm_prepare_task_packet'));
    assert.ok(names.includes('list_playbooks'));
    assert.ok(names.includes('load_playbook'));
    for (const retired of ['pm_start_task_packet', 'dispatch_task_to_session', 'list_skills', 'load_skill']) {
      assert.equal(names.includes(retired), false, retired);
    }
    assert.equal(TOOL_COMMANDS.pm_prepare_task_packet, 'pm.task.prepare');
    assert.match(tools.find(tool => tool.name === 'pm_prepare_task_packet')!.description, /does not start the CLI/i);
  });
});

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { createPlatformCommands } from '../src/services/platform-commands/catalog.js';
import { visibleToolSchemas } from '../src/services/agent/tool-availability.js';

function fixture() {
  const db = new Database(':memory:');
  migrate(drizzle(db), {migrationsFolder:new URL('../src/db/migrations/', import.meta.url).pathname});
  const user = new UserRepository(db).create('tool-boundary@test.dev', 'hash');
  const ledger = new CopilotRunLedger(db, user.id);
  const registry = createAgentToolRegistry(createPlatformTools());
  const orchestrator = createCopilotOrchestrator({db, masterKey:'test', toolRegistry:registry,
    eventBus:new ForgeBadgerEventBus(), llm:{
      async stream({onEvent}) {onEvent({type:'text_delta',text:'No action executed.'});return {message:'No action executed.'};},
      async summarize() {return '';}, async generateTitle() {return '';}
    }});
  return {db,user,ledger,registry,orchestrator};
}

it('filters model schemas for owner switches, runtime availability and scheduled source', () => {
  const {db,registry} = fixture();
  try {
    const visible = visibleToolSchemas(registry, {hasSessionManager:false, scheduled:true, isToolDisabled:name=>name==='list_projects'}).map(t=>t.name);
    assert.equal(visible.includes('list_projects'),false);
    assert.equal(visible.includes('get_session_output'),false);
    assert.equal(visible.includes('pm_prepare_task_packet'),false);
    assert.ok(visible.includes('list_playbooks'));
  } finally {db.close();}
});

for (const approvedBeforeUpgrade of [false,true]) it(`fails closed for an old task-start step (${approvedBeforeUpgrade?'already approved':'awaiting approval'})`, async () => {
  const {db,user,ledger,orchestrator} = fixture();
  try {
    const project = new ProjectRepository(db,user.id).create({name:'upgrade',path:'/tmp',aiTool:'codex'});
    const item = new ProjectManagerRepository(db,user.id).createWorkItem(project.id,{title:'Prepared once'});
    const conversation = ledger.log.createConversation();
    const runId = ledger.admit({userId:user.id,conversationId:conversation.id,userText:'Prepare a task'},4);
    const claim = ledger.claim(runId,'old-runtime',30000)!;
    const input = {projectId:project.id,workItemId:item.id,aiTool:'codex'};
    const step = ledger.addStep(runId,{kind:'tool',toolCallId:'legacy',toolName:'pm_start_task_packet',inputJson:JSON.stringify(input),effect:'write'});
    ledger.append(runId,{role:'assistant',kind:'tool_call',content:'pm_start_task_packet',toolName:'pm_start_task_packet',toolInputJson:JSON.stringify(input),toolCallId:'legacy'},step.id);
    const actions = new PlatformActions({db,userId:user.id},createPlatformCommands());
    const intent = actions.preview({commandId:'pm.task.prepare',input,authority:'owner_action',idempotencyKey:step.id});
    ledger.waitApproval(claim,step);
    const pending = ledger.log.listPendingActions(runId)[0]!;
    if (approvedBeforeUpgrade) {
      ledger.decide(runId,pending.id,true);
      actions.decide(intent.id,intent.digest,true);
      await orchestrator.executeRun(user.id,runId);
      assert.match(ledger.log.listMessages(conversation.id).find(m=>m.kind==='tool_result')?.content??'',/Unknown tool/);
    } else {
      await assert.rejects(orchestrator.resumeAfterApproval({userId:user.id,runId,actionId:pending.id,approved:true}),/no longer available/);
      assert.equal(ledger.log.getPendingAction(pending.id)?.status,'pending');
      assert.equal(actions.intents.get(intent.id)?.status,'pending');
      await orchestrator.resumeAfterApproval({userId:user.id,runId,actionId:pending.id,approved:false});
    }
    assert.equal((db.prepare('SELECT count(*) n FROM sessions').get() as {n:number}).n,0);
    assert.equal(actions.intents.receipt(intent.id),undefined);
    assert.equal(actions.intents.get(intent.id)?.digest,intent.digest);
    assert.equal(ledger.steps(runId).find(s=>s.id===step.id)?.tool_name,'pm_start_task_packet');
    assert.equal(ledger.steps(runId).find(s=>s.id===step.id)?.input_digest,step.input_digest);
  } finally {db.close();}
});
