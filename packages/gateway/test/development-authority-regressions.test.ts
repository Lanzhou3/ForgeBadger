import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from "node:url";
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { PlatformActionRepository } from '../src/db/repositories/platform-action-repository.js';
import { DevelopmentTaskRepository } from '../src/db/repositories/development-task-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { canonical } from '../src/services/platform-commands/actions.js';
import { assertDevelopmentAuthority,assertDevelopmentAuthorityCheap } from '../src/services/development/authority.js';
import { hashText, prepareSource } from '../src/services/development/workspace.js';

function fixture(t: TestContext, copilot = true, check='require("node:assert/strict").equal(require("./source.cjs"),1);') {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fb-development-authority-')),db=new Database(':memory:');
 db.pragma('foreign_keys=ON');migrate(drizzle(db),{migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
 const userId=new UserRepository(db).create('authority@test.local','hash').id;
 const projects=new ProjectRepository(db,userId),project=projects.create({name:'P',path:root,aiTool:'codex'});
 fs.writeFileSync(path.join(root,'source.cjs'),'module.exports=0;');fs.writeFileSync(path.join(root,'check.cjs'),check);
 const plan={projectId:project.id,goal:'Fix',sourceFiles:['source.cjs','check.cjs'],changes:[{path:'source.cjs',beforeSha256:hashText('module.exports=0;'),content:'module.exports=1;'}],checks:[{path:'check.cjs',sha256:hashText(fs.readFileSync(path.join(root,'check.cjs'),'utf8'))}]};
 const p=prepareSource(root,plan),resources={projectIds:[project.id],rootPaths:[p.root],revision:hashText(JSON.stringify([p.root,p.sourceDigest,p.outputDigest,p.recipeDigest]))};
 const ledger=new CopilotRunLedger(db,userId),conversation=ledger.log.createConversation('Test');
 const runId=ledger.admit({userId,conversationId:conversation.id,projectId:project.id,userText:'Fix'},6),claim=ledger.claim(runId,'origin',120000)!;
 const step=ledger.addStep(runId,{kind:'tool',toolName:'submit_development_task',toolCallId:'submit',inputJson:JSON.stringify(plan),effect:'write'});ledger.startStep(claim,step);
 const actions=new PlatformActionRepository(db,userId),intent=actions.create({actor_user_id:userId,authority:'owner_action',command_id:'development.task.submit',input_json:canonical(plan),digest:hashText(canonical({commandId:'development.task.submit',input:plan,resources,policyVersion:1})),resources_json:canonical(resources),policy_version:1,expires_at:Date.now()+900000,idempotency_key:copilot?step.id:randomUUID(),status:'approved'},copilot?{kind:'copilot',runId,stepId:step.id}:{kind:'owner_api'});
 actions.start(intent.id,'admission',Date.now()+30000);
 const tasks=new DevelopmentTaskRepository(db,userId),row=tasks.create({project_id:project.id,goal:plan.goal,plan_json:JSON.stringify(plan),recipe_digest:p.recipeDigest,source_digest:p.sourceDigest,output_digest:p.outputDigest,intent_id:intent.id,origin_run_id:copilot?runId:null,origin_step_id:copilot?step.id:null,project_root:p.root});
 actions.finish(intent.id,'confirmed',{taskId:row.id,recipeDigest:row.recipe_digest});ledger.receipt(claim,step,'submitted');ledger.finish(claim,'completed');
 t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
 return {db,userId,projects,project,plan,row,tasks,actions,ledger,runId,step,root,p};
}
it('cheap lease-tick probe catches live revocation while digest proofs stay at full boundaries',t=>{
 const f=fixture(t),row=f.tasks.claim('cheap-probe')!;
 assert.doesNotThrow(()=>assertDevelopmentAuthorityCheap(f.db,row));
 // Digest/tamper proofs are full-validation boundaries: the per-tick probe must not pay for them.
 const intent=f.actions.get(row.intent_id)!;
 f.db.prepare('UPDATE platform_action_intents SET input_json=? WHERE id=?').run('{}',row.intent_id);
 assert.doesNotThrow(()=>assertDevelopmentAuthorityCheap(f.db,row));
 assert.throws(()=>assertDevelopmentAuthority(f.db,row),/MISMATCH|AUTHORITY/);
 f.db.prepare('UPDATE platform_action_intents SET input_json=? WHERE id=?').run(intent.input_json,row.intent_id);
 // Live revocations remain tick-visible through the cheap probe (single indexed queries).
 f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.userId);
 assert.throws(()=>assertDevelopmentAuthorityCheap(f.db,row),/ACTOR/);
 f.db.prepare("UPDATE users SET status='active' WHERE id=?").run(f.userId);
 f.db.prepare("UPDATE copilot_runs SET status='cancelled' WHERE id=?").run(f.runId);
 assert.throws(()=>assertDevelopmentAuthorityCheap(f.db,row),/ORIGIN_REVOKED/);
});
it('consumed confirmed admission remains usable after admission TTL without renewing intent',t=>{
 const f=fixture(t);f.db.prepare('UPDATE platform_action_intents SET expires_at=0 WHERE id=?').run(f.row.intent_id);
 assert.doesNotThrow(()=>assertDevelopmentAuthority(f.db,f.row));assert.equal(f.actions.get(f.row.intent_id)!.expires_at,0);
});
it('manual owner API admission remains independent of the Copilot origin checks',t=>{
 const f=fixture(t,false);f.db.prepare('UPDATE platform_action_intents SET expires_at=0 WHERE id=?').run(f.row.intent_id);
 assertDevelopmentAuthority(f.db,f.row);
});
for(const field of ['input_json','digest','resources_json','actor_user_id'] as const)it(`confirmed receipt cannot authorize tampered intent ${field}`,t=>{
 const f=fixture(t);const value=field==='actor_user_id'?new UserRepository(f.db).create('other-actor@test.local','hash').id:field==='digest'?'b'.repeat(64):'{}';
 f.db.prepare(`UPDATE platform_action_intents SET ${field}=? WHERE id=?`).run(value,f.row.intent_id);
 assert.throws(()=>assertDevelopmentAuthority(f.db,f.row),/MISMATCH|AUTHORITY/);
});
it('confirmed receipt cannot authorize a mutated origin step digest or deleted user request',t=>{
 const f=fixture(t);f.db.prepare("UPDATE copilot_run_steps SET input_digest='invalid' WHERE id=?").run(f.step.id);
 assert.throws(()=>assertDevelopmentAuthority(f.db,f.row),/MISMATCH/);
 f.db.prepare('UPDATE copilot_run_steps SET input_digest=? WHERE id=?').run(hashText(JSON.stringify(f.plan)),f.step.id);
 f.db.prepare("DELETE FROM copilot_messages WHERE user_id=? AND role='user'").run(f.userId);
 assert.throws(()=>assertDevelopmentAuthority(f.db,f.row),/ORIGIN_REVOKED/);
});
