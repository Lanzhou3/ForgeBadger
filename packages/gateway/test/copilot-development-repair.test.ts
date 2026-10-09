import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from "node:url";
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { PlatformActionRepository } from '../src/db/repositories/platform-action-repository.js';
import { DevelopmentTaskRepository } from '../src/db/repositories/development-task-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { admitDevelopmentRepair, revokeDevelopmentRepairs, recoverDevelopmentRepairs } from '../src/services/agent/development-repair.js';
import { assertRepairPlan, reserveRepairSubmission, repairJob, validateRepairJob } from '../src/services/development/repair-scope.js';
import { assertDevelopmentAuthority } from '../src/services/development/authority.js';
import { canonical } from '../src/services/platform-commands/actions.js';
import { prepareSource, hashText } from '../src/services/development/workspace.js';
import type { DevelopmentPlan } from '../src/services/development/contracts.js';
import { sandboxCapability, runSandboxChecks } from '../src/services/development/sandbox.js';
import { writeWorkspace } from '../src/services/development/workspace.js';
import { startDevelopmentRuntime } from '../src/services/development/runtime.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { TelegramChannelRepository } from '../src/db/repositories/telegram-channel-repository.js';
import { TelegramIntegrationRepository } from '../src/db/repositories/telegram-integration-repository.js';
import { ChannelIdentityService, type TrustedChannelPeer } from '../src/services/channels/channel-identity-service.js';
import { assertChannelToolScope } from '../src/services/channels/channel-run-scope.js';
import { agentActions } from '../src/services/platform-commands/agent-actions.js';

function fixture(t:TestContext) {
 const root=mkdtempSync(join(tmpdir(),'fb-repair-')),db=new Database(':memory:');db.pragma('foreign_keys=ON');
 migrate(drizzle(db),{migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
 const userId=new UserRepository(db).create('repair@test.dev','hash').id,projects=new ProjectRepository(db,userId);
 const project=projects.create({name:'P',path:root,aiTool:'codex'});projects.setCopilotAutonomy(project.id,true);
 writeFileSync(join(root,'sum.cjs'),'module.exports=(a,b)=>a-b;');
 const test="const a=require('node:assert/strict');a.equal(require('./sum.cjs')(2,3),5);";
 writeFileSync(join(root,'sum.test.cjs'),test);
 const plan:DevelopmentPlan={projectId:project.id,goal:'Repair sum',sourceFiles:['sum.cjs','sum.test.cjs'],
  changes:[{path:'sum.cjs',beforeSha256:hashText('module.exports=(a,b)=>a-b;'),content:'module.exports=(a,b)=>a*b;'}],checks:[{path:'sum.test.cjs',sha256:hashText(test)}]};
 const ledger=new CopilotRunLedger(db,userId),runId=ledger.admit({userId,conversationId:ledger.log.createConversation('Root').id,projectId:project.id,userText:'Fix',repairFailedChecks:true},6);
 // Exact post-submission/check-failure state fixture, not a claim of sandbox execution.
 function failed(runId:string,next=plan,importedHistory=false) {
  const claim=ledger.claim(runId,'worker',120000)!,step=ledger.addStep(runId,{kind:'tool',toolName:'submit_development_task',toolCallId:randomUUID(),inputJson:JSON.stringify(next),effect:'write'});
  ledger.startStep(claim,step);
  if(repairJob(db,userId,runId))reserveRepairSubmission(db,userId,runId,step.id,next);
  const prepared=prepareSource(root,next),actions=new PlatformActionRepository(db,userId),tasks=new DevelopmentTaskRepository(db,userId);
  const resources={projectIds:[next.projectId],rootPaths:[prepared.root],revision:hashText(JSON.stringify([prepared.root,prepared.sourceDigest,prepared.outputDigest,prepared.recipeDigest]))};
  const intent=actions.create({actor_user_id:userId,grant_id:null,grant_revision:null,authority:'owner_action',command_id:'development.task.submit',input_json:canonical(next),digest:hashText(canonical({commandId:'development.task.submit',input:next,resources,policyVersion:1})),resources_json:canonical(resources),policy_version:1,expires_at:Date.now()+900000,idempotency_key:step.id,status:'approved'},{kind:'copilot',runId,stepId:step.id});
  actions.start(intent.id,'worker',Date.now()+120000);
  const taskInput={project_id:project.id,goal:next.goal,plan_json:JSON.stringify(next),recipe_digest:prepared.recipeDigest,source_digest:prepared.sourceDigest,output_digest:prepared.outputDigest,intent_id:intent.id,origin_run_id:runId,origin_step_id:step.id,project_root:prepared.root};
  // Simulate an imported historical DB beyond today's 100-task create limit.
  const importedId=randomUUID();
  if(importedHistory)db.prepare(`INSERT INTO copilot_development_tasks(id,user_id,status,created_at,updated_at,${Object.keys(taskInput).join(',')}) VALUES(?,?,'queued',?,?,${Object.keys(taskInput).map(()=>'?').join(',')})`)
    .run(importedId,userId,Date.now(),Date.now(),...Object.values(taskInput));
  const task=importedHistory?tasks.get(importedId)!:tasks.create(taskInput);
  actions.finish(intent.id,'confirmed',{taskId:task.id,recipeDigest:task.recipe_digest});
  db.prepare('UPDATE copilot_repair_jobs SET submitted_task_id=? WHERE user_id=? AND child_run_id=?').run(task.id,userId,runId);
  ledger.receipt(claim,step,'submitted');ledger.finish(claim,'completed');
  const worker=tasks.claim('check-worker')!;
  tasks.finish(task.id,worker.owner!,'checks_failed',{sourceDigest:prepared.sourceDigest,outputDigest:prepared.outputDigest,recipeDigest:prepared.recipeDigest,files:[],diff:'fixture',checks:[{path:'sum.test.cjs',exitCode:1,stdout:'',stderr:'assertion failed',timedOut:false,cancelled:false,durationMs:1}],startedAt:Date.now(),finishedAt:Date.now()});
  return task.id;
 }
 t.after(()=>{db.close();rmSync(root,{recursive:true,force:true});});
 return {db,root,userId,project,projects,ledger,runId,plan,failed};
}
it('admits each failed task once, caps the entire chain at two and retains original model scope',t=>{
 const f=fixture(t),root=f.failed(f.runId),first=admitDevelopmentRepair(f.db,f.userId,root)!;
 assert.ok(first);assert.equal(admitDevelopmentRepair(f.db,f.userId,root),first);
 const second=admitDevelopmentRepair(f.db,f.userId,f.failed(first))!;assert.ok(second);
 assert.equal(admitDevelopmentRepair(f.db,f.userId,f.failed(second)),undefined);
 assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_repair_jobs').get() as {n:number}).n,2);
 assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
});
it('rejects changed tests, expanded files, duplicate submissions and revoked authority',t=>{
 const f=fixture(t),child=admitDevelopmentRepair(f.db,f.userId,f.failed(f.runId))!,stepId=randomUUID();
 assert.ok(assertRepairPlan(f.db,f.userId,child,stepId,f.plan));
 assert.throws(()=>assertRepairPlan(f.db,f.userId,child,stepId,{...f.plan,checks:[]}),/Zod|Array|minimum/);
 assert.throws(()=>assertRepairPlan(f.db,f.userId,child,stepId,{...f.plan,changes:[...f.plan.changes,{path:'sum.test.cjs',beforeSha256:f.plan.checks[0]!.sha256,content:'process.exit(0)'}]}),/SCOPE|TEST/);
 reserveRepairSubmission(f.db,f.userId,child,stepId,f.plan);
 assert.throws(()=>reserveRepairSubmission(f.db,f.userId,child,randomUUID(),f.plan),/SUBMISSION_LIMIT/);
 f.projects.setCopilotAutonomy(f.project.id,false);
 assert.throws(()=>assertRepairPlan(f.db,f.userId,child,stepId,f.plan),/AUTONOMY/);
 f.projects.setCopilotAutonomy(f.project.id,true);writeFileSync(join(f.root,'sum.cjs'),'changed source');
 assert.throws(()=>assertRepairPlan(f.db,f.userId,child,stepId,f.plan),/DRIFT|STALE|HASH/);
});

for(const fromChild of [false,true]) it(`revokes root repair authority from ${fromChild?'child':'root'} without changing the immutable request`,t=>{
 const f=fixture(t),task=f.failed(f.runId),child=admitDevelopmentRepair(f.db,f.userId,task)!;
 const original=f.ledger.get(f.runId)!.input_json;
 revokeDevelopmentRepairs(f.db,f.userId,fromChild?child:f.runId);
 assert.equal(f.ledger.get(child)?.status,'cancelled');assert.equal(f.ledger.get(f.runId)!.input_json,original);
 assert.throws(()=>f.ledger.validateScope(JSON.parse(f.ledger.get(child)!.input_json)),/REVOKED/);
 assert.throws(()=>assertRepairPlan(f.db,f.userId,child,randomUUID(),f.plan),/REVOKED/);
});

it('requires fresh patch approval then runs real sandbox checks for the repaired candidate',{skip:!sandboxCapability().available},async t=>{
 const f=fixture(t),prepared=prepareSource(f.root,f.plan),workspace=join(f.root,'baseline');
 writeWorkspace(workspace,prepared);
 const first=await runSandboxChecks({workspace,checks:['sum.test.cjs'],signal:new AbortController().signal});
 assert.equal(first.exitCode,1,'original candidate must actually fail its check');
 const child=admitDevelopmentRepair(f.db,f.userId,f.failed(f.runId))!,fixed={...f.plan,changes:[{...f.plan.changes[0]!,content:'module.exports=(a,b)=>a+b;'}]};
 const eventBus=new ForgeBadgerEventBus();let calls=0;
 const orchestrator=createCopilotOrchestrator({db:f.db,masterKey:'a'.repeat(64),eventBus,toolRegistry:createAgentToolRegistry(createPlatformTools()),llm:{
  async stream(request){if(++calls===1)request.onEvent({type:'tool_call',toolCall:{id:'repair',name:'submit_development_task',arguments:JSON.stringify(fixed)}});return {message:'candidate ready',usage:{totalTokens:10}};},
  async summarize(){return '';},async generateTitle(){return '';},async proposeMemory(){return [];}
 }});
 await orchestrator.executeRun(f.userId,child);
 assert.equal(f.ledger.get(child)?.status,'awaiting_approval');
 assert.equal(repairJob(f.db,f.userId,child)?.submitted_task_id,null);
 const action=f.ledger.log.listPendingActions(child).find(a=>a.status==='pending')!;assert.ok(action);
 await orchestrator.resumeAfterApproval({userId:f.userId,runId:child,actionId:action.id,approved:true});
 const taskId=repairJob(f.db,f.userId,child)?.submitted_task_id;assert.ok(taskId);
 const runtime=startDevelopmentRuntime({db:f.db,eventBus});
 try {
  await runtime.ready;const deadline=Date.now()+15000,tasks=new DevelopmentTaskRepository(f.db,f.userId);
  while(['queued','running'].includes(tasks.get(taskId)!.status)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
  const task=tasks.get(taskId)!;assert.equal(task.status,'checks_passed');
  assert.equal(JSON.parse(task.evidence_json!).checks[0].exitCode,0);
  assert.equal(prepareSource(f.root,f.plan).sourceDigest,prepared.sourceDigest,'original source remains unchanged');
 }finally{await runtime.stop();}
});

for (const operation of ['delete', 'edit', 'truncate', 'same-content-edit'] as const) it(`revokes repair submission and sandbox authority after parent ${operation}`,t=>{
 const f=fixture(t),child=admitDevelopmentRepair(f.db,f.userId,f.failed(f.runId))!;
 const submitted=f.failed(child),parent=f.ledger.get(f.runId)!;
 const message=f.ledger.log.listMessages(parent.conversation_id).find(m=>m.role==='user')!;
 if(operation==='delete')f.ledger.log.deleteConversation(parent.conversation_id);
 else f.ledger.log.truncateAfterMessage(message.id,operation==='truncate'?undefined:operation==='edit'?'Changed request':'Fix');
 assert.throws(()=>assertRepairPlan(f.db,f.userId,child,randomUUID(),f.plan),/REVOKED/);
 assert.throws(()=>assertDevelopmentAuthority(f.db,new DevelopmentTaskRepository(f.db,f.userId).get(submitted)!),/REVOKED/);
});
it('rotates past 100 unreportable jobs to publish later terminal results',t=>{
 const f=fixture(t);
 for(let i=0;i<101;i++) {
  const run=i===0?f.runId:f.ledger.admit({userId:f.userId,conversationId:f.ledger.log.createConversation().id,projectId:f.project.id,userText:'Fix',repairFailedChecks:true},6);
  const child=admitDevelopmentRepair(f.db,f.userId,f.failed(run,f.plan,i===100))!;
  if(i===100){const claim=f.ledger.claim(child,'report',120000)!;f.ledger.finish(claim,'completed');assert.equal(f.ledger.get(child)!.status,'completed');validateRepairJob(f.db,f.userId,repairJob(f.db,f.userId,child)!);}
 }
 recoverDevelopmentRepairs(f.db,f.userId);recoverDevelopmentRepairs(f.db,f.userId);
 assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_repair_jobs WHERE report_message_id IS NOT NULL').get() as {n:number}).n,1);
});

it('confirmed root remains repairable after admission expiry while live autonomy is still required',t=>{
 const f=fixture(t),task=f.failed(f.runId),row=new DevelopmentTaskRepository(f.db,f.userId).get(task)!;
 f.db.prepare('UPDATE platform_action_intents SET expires_at=0 WHERE id=?').run(row.intent_id);
 const child=admitDevelopmentRepair(f.db,f.userId,task)!;assert.ok(child);assertRepairPlan(f.db,f.userId,child,randomUUID(),f.plan);
 f.projects.setCopilotAutonomy(f.project.id,false);assert.throws(()=>assertRepairPlan(f.db,f.userId,child,randomUUID(),f.plan),/AUTONOMY/);
});

it('inherits the durable channel repair mode through PlatformActions preview', { skip: !sandboxCapability().available }, t => {
 const f = fixture(t), key = 'a'.repeat(64);
 const account = new TelegramChannelRepository(f.db, f.userId, key).upsertAccount({ name: 'repair', botToken: '123:synthetic', enabled: true });
 new TelegramIntegrationRepository(f.db, f.userId).upsertConfig({ enabled: true, allowedChatIds: ['123'] });
 const identityService = new ChannelIdentityService(f.db, f.userId, key);
 const peer: TrustedChannelPeer = { channel: 'telegram', accountId: account.id, accountRevision: account.configRevision,
  externalUserId: '123', chatId: '123', chatType: 'p2p' };
 const pairing = identityService.createPairing({ channel: 'telegram', accountId: account.id });
 const claimed = identityService.claimPairing(pairing.token, peer);
 const identity = identityService.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId: '123', chatId: '123' });
 const route = identityService.createRoute({ identityId: identity.id, projectId: f.project.id });
 // Valid historical confirmed submission/check-failure fixture; no new remote
 // direct-development authority is granted by this setup or the repair mode.
 const origin = f.ledger.admit({ userId: f.userId, conversationId: route.conversationId, projectId: f.project.id, userText: 'Fix', repairFailedChecks: true }, 6);
 const child = admitDevelopmentRepair(f.db, f.userId, f.failed(origin))!;
 const turn = JSON.parse(f.ledger.get(child)!.input_json);
 f.ledger.validateScope(turn);
 const step = f.ledger.addStep(child, { kind: 'tool', toolName: 'submit_development_task', toolCallId: 'repair', inputJson: JSON.stringify(f.plan), effect: 'write' });
 reserveRepairSubmission(f.db, f.userId, child, step.id, f.plan);
 const context = { db: f.db, userId: f.userId, masterKey: key, source: 'user' as const, executionMode: 'repair' as const,
  runId: child, stepId: step.id, conversationId: turn.conversationId, projectId: f.project.id };
 assertChannelToolScope(context, 'submit_development_task', f.plan);
 assert.doesNotThrow(() => agentActions(context).preview({ commandId: 'development.task.submit', input: f.plan, idempotencyKey: step.id }));
 assert.throws(() => assertChannelToolScope({ ...context, executionMode: undefined }, 'submit_development_task', f.plan), /CHANNEL_AUTHORITY_REJECTED/);
});
