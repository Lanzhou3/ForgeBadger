import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { createPlatformCommands } from '../src/services/platform-commands/catalog.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry, executeAgentTool } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
function fixture() {
    const db = new Database(':memory:');
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    const user = new UserRepository(db).create('grant@test.dev', 'hash');
    const projects = new ProjectRepository(db, user.id);
    const p = projects.create({ name: 'allowed', path: '/tmp/allowed', aiTool: '' });
    const outside = projects.create({ name: 'private', path: '/tmp/private', aiTool: '' });
    const actions = new PlatformActions({ db, userId: user.id }, createPlatformCommands());
    const grant = actions.createGrant({ name: 'project grant', projectIds: [p.id], capabilities: ['pm.work_item.create', 'memory.write'], expiresAt: Date.now() + 100000, maxActions: 10 });
    const ledger = new CopilotRunLedger(db, user.id);
    return { db, user, p, outside, actions, grant, ledger };
}
it('binds only fresh conversations and cannot escape or switch a binding', () => {
    const { db, user, p, grant, ledger } = fixture();
    try {
        const convo = ledger.log.createConversation();
        const run = ledger.admit({ userId: user.id, conversationId: convo.id, userText: 'hello', grantId: grant.id, projectId: p.id }, 4);
        ledger.cancel(run);
        assert.throws(() => ledger.admit({ userId: user.id, conversationId: convo.id, userText: 'switch', grantId: 'different' }, 4), /cannot change/);
        const inherited = ledger.admit({ userId: user.id, conversationId: convo.id, userText: 'inherit' }, 4);
        assert.equal(JSON.parse(ledger.get(inherited)!.input_json).grantId, grant.id);
        const old = ledger.log.createConversation();
        const oldRun = ledger.admit({ userId: user.id, conversationId: old.id, userText: 'unscoped' }, 4);
        ledger.cancel(oldRun);
        assert.throws(() => ledger.admit({ userId: user.id, conversationId: old.id, userText: 'bind', grantId: grant.id }, 4), /fresh empty/);
    }
    finally {
        db.close();
    }
});
it('filters lists before output and rejects outside projects and global recall', async () => {
    const { db, user, p, outside, grant } = fixture();
    try {
        const tools = createAgentToolRegistry(createPlatformTools());
        const ctx = { db, userId: user.id, masterKey: 'test', grantId: grant.id };
        const list = await executeAgentTool(tools.tools.get('list_projects')!, {}, ctx);
        assert.deepEqual((list.output as {
            projects: {
                id: string;
            }[];
        }).projects.map(x => x.id), [p.id]);
        assert.match((await executeAgentTool(tools.tools.get('get_project')!, { projectId: outside.id }, ctx)).error ?? '', /outside grant/);
        assert.match((await executeAgentTool(tools.tools.get('search_memory')!, { query: 'secret', scope: 'global' }, ctx)).error ?? '', /Global memory/);
    }
    finally {
        db.close();
    }
});
it('runs an authorized PM write through a durable receipt without a chat approval', async () => {
    const { db, user, p, grant, ledger } = fixture();
    try {
        let calls = 0;
        const orch = createCopilotOrchestrator({ db, masterKey: 'test', eventBus: new ForgeBadgerEventBus(), toolRegistry: createAgentToolRegistry(createPlatformTools()), llm: { async stream({ onEvent }) {
                    if (calls++ === 0)
                        onEvent({ type: 'tool_call', toolCall: { id: 'create', name: 'pm_create_work_item', arguments: JSON.stringify({ projectId: p.id, title: 'Track delivery' }) } });
                    return { message: 'done' };
                }, async summarize() {
                    return '';
                }, async generateTitle() {
                    return '';
                } } });
        const convo = ledger.log.createConversation();
        const run = await orch.runTurn({ userId: user.id, conversationId: convo.id, userText: 'Track delivery', grantId: grant.id });
        assert.equal(ledger.get(run)?.status, 'completed');
        assert.equal(ledger.log.listPendingActions(run).length, 0);
        assert.equal((db.prepare('SELECT count(*) n FROM platform_action_receipts WHERE user_id=?').get(user.id) as {
            n: number;
        }).n, 1);
    }
    finally {
        db.close();
    }
});
it('refuses autonomous CLI dispatch before recording an intent or creating any session', () => {
    const { db, p, actions } = fixture();
    try {
        assert.throws(() => actions.preview({ commandId: 'pm.task.execute', input: { projectId: p.id, workItemId: 'absent' }, idempotencyKey: 'cli', authority: 'owner_action' }), /Work item not found/);
        assert.equal((db.prepare('SELECT count(*) n FROM sessions').get() as {
            n: number;
        }).n, 0);
    }
    finally {
        db.close();
    }
});
it('does not persist model-curated global memory behind a grant or a scheduled read-only run', async () => {
    const previous = process.env.FORGEBADGER_COPILOT_MEMORY_CURATION;
    process.env.FORGEBADGER_COPILOT_MEMORY_CURATION = '1';
    const { db, user, grant, ledger } = fixture();
    try {
        let proposed = 0;
        const orch = createCopilotOrchestrator({ db, masterKey: 'test', eventBus: new ForgeBadgerEventBus(), toolRegistry: createAgentToolRegistry(createPlatformTools()), llm: { async stream() {
                    return { message: 'done' };
                }, async summarize() {
                    return '';
                }, async generateTitle() {
                    return '';
                }, async proposeMemory() {
                    proposed++;
                    return [{ scope: 'global' as const, kind: 'fact' as const, text: 'must not persist' }];
                } } });
        const c = ledger.log.createConversation();
        await orch.runTurn({ userId: user.id, conversationId: c.id, userText: 'Remember', grantId: grant.id });
        const scheduled = ledger.log.createConversation();
        await orch.runTurn({ userId: user.id, conversationId: scheduled.id, userText: 'Report', source: 'scheduled' });
        assert.equal(proposed, 0);
        assert.equal((db.prepare('SELECT count(*) n FROM copilot_memory').get() as {
            n: number;
        }).n, 0);
    }
    finally {
        db.close();
        if (previous === undefined)
            delete process.env.FORGEBADGER_COPILOT_MEMORY_CURATION;
        else
            process.env.FORGEBADGER_COPILOT_MEMORY_CURATION = previous;
    }
});
it('does not expose global skill summaries through local slash commands in a granted conversation', async () => {
    const { db, user, grant, ledger } = fixture();
    try {
        const { SkillRepository } = await import('../src/db/repositories/skill-repository.js');
        new SkillRepository(db, user.id).create({ name: 'private-global-skill', description: 'classified-global-description', content: 'test', isEnabled: true });
        const c = ledger.log.createConversation();
        const orch = createCopilotOrchestrator({ db, masterKey: 'test', eventBus: new ForgeBadgerEventBus(), toolRegistry: createAgentToolRegistry(createPlatformTools()), llm: { async stream() {
                    throw new Error('Local command should not reach model');
                }, async summarize() {
                    return '';
                }, async generateTitle() {
                    return '';
                } } });
        await orch.runTurn({ userId: user.id, conversationId: c.id, userText: '/skills', grantId: grant.id });
        assert.equal(ledger.log.listMessages(c.id).filter(m => m.role === 'assistant').some(m => m.content.includes('private-global-skill') || m.content.includes('classified-global-description')), false);
    }
    finally {
        db.close();
    }
});
for(const reason of ['scope','budget'] as const)it(`publishes a stable denied tool-result for grant ${reason} rejection`,async()=>{
 const {db,user,p,outside,grant,ledger}=fixture();try{
 if(reason==='budget')db.prepare('UPDATE copilot_grants SET used_actions=max_actions WHERE id=?').run(grant.id);
 let turns=0;const c=ledger.log.createConversation();const orch=createCopilotOrchestrator({db,masterKey:'test',eventBus:new ForgeBadgerEventBus(),toolRegistry:createAgentToolRegistry(createPlatformTools()),llm:{async stream({onEvent}){if(turns++===0)onEvent({type:'tool_call',toolCall:{id:'denied',name:'pm_create_work_item',arguments:JSON.stringify({projectId:reason==='scope'?outside.id:p.id,title:'Cannot write'})}});return {message:'done'};},async summarize(){return '';},async generateTitle(){return '';}}});
 await orch.runTurn({userId:user.id,conversationId:c.id,userText:'Operate',grantId:grant.id});
 const results=ledger.log.listMessages(c.id).filter(m=>m.kind==='tool_result');assert.equal(results.length,1);assert.match(results[0]!.content,/^Denied by security policy: /);
 assert.equal((db.prepare('SELECT count(*) n FROM project_manager_work_items').get() as {n:number}).n,0);
 }finally{db.close();}
});
it('chat rejection atomically rejects the underlying platform intent and cannot later execute it',async()=>{
 const {db,user,p,ledger,actions}=fixture();try{
 let turns=0;const c=ledger.log.createConversation();const orch=createCopilotOrchestrator({db,masterKey:'test',eventBus:new ForgeBadgerEventBus(),toolRegistry:createAgentToolRegistry(createPlatformTools()),llm:{async stream({onEvent}){if(turns++===0)onEvent({type:'tool_call',toolCall:{id:'reject',name:'pm_create_work_item',arguments:JSON.stringify({projectId:p.id,title:'Rejected'})}});return {message:'done'};},async summarize(){return '';},async generateTitle(){return '';}}});
 const run=await orch.runTurn({userId:user.id,conversationId:c.id,userText:'Create task'});const pending=ledger.log.listPendingActions(run)[0]!;const intent=actions.intents.byKey(pending.stepId!)!;
 await orch.resumeAfterApproval({userId:user.id,runId:run,actionId:pending.id,approved:false});
 assert.equal(actions.intents.get(intent.id)?.status,'rejected');await assert.rejects(actions.execute(intent.id),/not approved|no longer active/);assert.throws(()=>actions.decide(intent.id,intent.digest,true),/already decided|no longer active/);
 }finally{db.close();}
});
it('recovers a committed platform DB receipt into the same run without replaying the write',async()=>{
 const {db,user,p,grant,ledger,actions}=fixture();try{
 const conversation=ledger.log.createConversation();const run=ledger.admit({userId:user.id,conversationId:conversation.id,userText:'Create once',grantId:grant.id},4);const claim=ledger.claim(run,'crashed',30000)!;
 const input={projectId:p.id,title:'Committed once'};const step=ledger.addStep(run,{kind:'tool',toolCallId:'once',toolName:'pm_create_work_item',inputJson:JSON.stringify(input),effect:'write'});ledger.startStep(claim,step);
 ledger.append(run,{role:'assistant',kind:'tool_call',content:'pm_create_work_item',toolName:'pm_create_work_item',toolCallId:'once',toolInputJson:JSON.stringify(input)},step.id);
 const intent=actions.preview({commandId:'pm.work_item.create',input,idempotencyKey:step.id,authority:'delegated_grant',grantId:grant.id});await actions.execute(intent.id);
 db.prepare('UPDATE copilot_runs SET lease_expires_at=0 WHERE id=?').run(run);
 const recovered=ledger.claim(run,'recovered',30000);assert.ok(recovered);assert.equal(ledger.steps(run).find(s=>s.id===step.id)?.status,'completed');assert.equal(ledger.log.listMessages(conversation.id).filter(m=>m.kind==='tool_result').length,1);assert.equal((db.prepare('SELECT count(*) n FROM project_manager_work_items').get() as {n:number}).n,1);
 assert.equal(actions.grants.get(grant.id)?.usedActions,1);
 db.prepare('UPDATE copilot_runs SET lease_expires_at=0 WHERE id=?').run(run);
 const restored=createCopilotOrchestrator({db,masterKey:'test',eventBus:new ForgeBadgerEventBus(),toolRegistry:createAgentToolRegistry(createPlatformTools()),llm:{async stream(){return {message:'Recovered'};},async summarize(){return '';},async generateTitle(){return '';}}});
 await restored.executeRun(user.id,run);assert.equal(ledger.get(run)?.status,'completed');assert.equal((db.prepare('SELECT count(*) n FROM project_manager_work_items').get() as {n:number}).n,1);

 }finally{db.close();}
});
it('a platform no-effect receipt is a completed failed tool step, not an indeterminate run',async()=>{
 const {db,user,p,grant,ledger}=fixture();try{
 db.exec("CREATE TRIGGER fail_pm_create BEFORE INSERT ON project_manager_work_items BEGIN SELECT RAISE(ABORT,'controlled DB rollback'); END");
 let turns=0;const c=ledger.log.createConversation();const orch=createCopilotOrchestrator({db,masterKey:'test',eventBus:new ForgeBadgerEventBus(),toolRegistry:createAgentToolRegistry(createPlatformTools()),llm:{async stream({onEvent}){if(turns++===0)onEvent({type:'tool_call',toolCall:{id:'rollback',name:'pm_create_work_item',arguments:JSON.stringify({projectId:p.id,title:'Rollback'})}});return {message:'done'};},async summarize(){return '';},async generateTitle(){return '';}}});
 const run=await orch.runTurn({userId:user.id,conversationId:c.id,userText:'Create',grantId:grant.id});
 assert.equal(ledger.get(run)?.status,'completed');const step=ledger.steps(run).find(s=>s.kind==='tool')!;assert.equal(step.status,'completed');assert.match(step.result_json??'',/Tool error:.*no_effect/);
 }finally{db.close();}
});
it('filters grant scope before the default 50-row limit for projects and sessions',async()=>{
 const {db,user,actions}=fixture();try{
 const {SessionRepository}=await import('../src/db/repositories/session-repository.js');
 const projects=new ProjectRepository(db,user.id),sessions=new SessionRepository(db,user.id);const ids:string[]=[];
 for(let n=0;n<65;n++){const p=projects.create({name:`Project ${n}`,path:`/tmp/project-${n}`,aiTool:''});ids.push(p.id);sessions.create({projectId:p.id,name:`Session ${n}`,aiTool:'codex',workingDir:p.path});}
 const all=actions.createGrant({name:'all',projectIds:ids,capabilities:['pm.work_item.create'],expiresAt:Date.now()+100000,maxActions:10});
 const tools=createAgentToolRegistry(createPlatformTools());const ctx={db,userId:user.id,masterKey:'test',grantId:all.id};
 const p=await executeAgentTool(tools.tools.get('list_projects')!,{limit:100},ctx);assert.equal((p.output as {projects:unknown[]}).projects.length,65);
 const s=await executeAgentTool(tools.tools.get('list_sessions')!,{limit:100},ctx);assert.equal((s.output as {sessions:unknown[]}).sessions.length,65);
 const one=actions.createGrant({name:'last',projectIds:[ids[64]!],capabilities:['pm.work_item.create'],expiresAt:Date.now()+100000,maxActions:1});
 const last=await executeAgentTool(tools.tools.get('list_projects')!,{}, {...ctx,grantId:one.id});assert.equal((last.output as {projects:{id:string}[]}).projects[0]?.id,ids[64]);
 }finally{db.close();}
});
