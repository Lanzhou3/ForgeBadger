import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionCommands } from '../src/services/platform-commands/session-commands.js';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { PlatformNoEffectError } from '../src/services/platform-commands/errors.js';
import type { CommandContext } from '../src/services/platform-commands/types.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';

test('session lifecycle catalog exposes start, stop and takeover with strict inputs', () => {
  const commands = createSessionCommands();
  assert.deepEqual(commands.map(c => c.id), ['session.start', 'session.stop', 'session.takeover']);
  for (const command of commands) assert.throws(() => command.inputSchema.parse({sessionId:'s', userId:'other'}));
});

test('owner stop persists a safe receipt once and preserves stopped lifecycle state', async () => {
  const db = new Database(':memory:');
  try {
    migrate(drizzle(db), {migrationsFolder:fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
    const user = new UserRepository(db).create('session-actions@test.dev', 'hash');
    const project = new ProjectRepository(db,user.id).create({name:'p',path:'/tmp',aiTool:'codex'});
    const repo = new SessionRepository(db,user.id);
    const session = repo.create({projectId:project.id,name:'s',aiTool:'codex',workingDir:'/tmp',attachToken:'private-attach-token'});
    let kills = 0;
    let enters = 0;
    let pane = '› Ask Codex to do anything\n\nmodel · cwd';
    let staged!: () => void;
    let release!: () => void;
    const didStage = new Promise<void>(resolve => {staged=resolve;});
    const settled = new Promise<void>(resolve => {release=resolve;});
    const manager = new InMemorySessionManager({
      async createSession(){},async killSession(){kills++;},async listSessions(){return [];},async hasSession(){return true;},async capturePane(){return '';},
      async inspectPane(){return {content:pane,dead:false};},
      async stageProgrammaticInput(_name,data){pane=`› ${data}\n\nmodel · cwd`;staged();},
      async pressEnter(){enters++;}
    },undefined,undefined,{sleep:async()=>settled});
    const live = await manager.createSession({userId:user.id,sessionId:session.id,launchPlan:{command:'codex',args:[],cwd:'/tmp',env:{},secretEnvNames:[],credentialMode:'host_environment'}});
    repo.update(session.id,{status:'running',runtimeSessionName:live.runtimeSessionName});
    const commands = new Map(createSessionCommands().map(command => [command.id,command]));
    const actions = new PlatformActions({db,userId:user.id,sessionManager:manager},commands);
    const intent = actions.preview({commandId:'session.stop',input:{sessionId:session.id},idempotencyKey:'stop'});
    assert.equal(intent.resources_json.includes('private-attach-token'),false);
    const submission = manager.submitProgrammaticTask(session.id,{adapter:'codex',message:'hello'});
    await didStage;
    const pendingStop = actions.execute(intent.id);
    release();
    await assert.rejects(submission,/PROGRAMMATIC_SUBMIT_INDETERMINATE/);
    const first = await pendingStop;
    const replay = await actions.execute(intent.id);
    assert.deepEqual(replay,first);
    assert.equal(kills,1);
    assert.equal(enters,0);
    assert.equal(repo.getById(session.id)?.status,'exited');
    assert.equal(JSON.stringify(first).includes('attachToken'),false);
    assert.equal(JSON.stringify(first).includes('private-attach-token'),false);
    const other = new UserRepository(db).create('other-session@test.dev','hash');
    assert.throws(()=>commands.get('session.stop')!.resolve({db,userId:other.id},{sessionId:session.id}),/not found/i);
  } finally {db.close();}
});
test('missing runtime and unavailable adapter preconditions leave no side effects',async()=>{
 const db=new Database(':memory:');try{
 migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
 const user=new UserRepository(db).create('no-effect-session@test.dev','hash');const p=new ProjectRepository(db,user.id).create({name:'p',path:'/tmp',aiTool:'codex'});
 const s=new SessionRepository(db,user.id).create({projectId:p.id,name:'s',aiTool:'codex',workingDir:'/tmp'});
 const commands=new Map(createSessionCommands().map(c=>[c.id,c]));const actions=new PlatformActions({db,userId:user.id},commands);
 const i=actions.preview({commandId:'session.start',input:{sessionId:s.id},idempotencyKey:'missing-runtime'});
 await assert.rejects(actions.execute(i.id),/runtime unavailable/);assert.equal(actions.intents.get(i.id)?.status,'approved');assert.equal(actions.intents.receipt(i.id),undefined);
 actions.context.sessionManager=new InMemorySessionManager({async createSession(){assert.fail('must not launch');},async killSession(){},async listSessions(){return[];},async capturePane(){return '';}});
 actions.context.adapterCommandRunner=async()=>({exitCode:1,stdout:'',stderr:'missing'});
 await assert.rejects(actions.execute(i.id),/not available for launch/);assert.equal(actions.intents.get(i.id)?.status,'approved');assert.equal(actions.intents.receipt(i.id),undefined);
 assert.equal(new SessionRepository(db,user.id).getById(s.id)?.status,'idle');
 }finally{db.close();}
});
for (const change of ['disabled','expired','resource'] as const) test(`a ${change} check while start waits prevents launch effects and records a no-effect receipt`,async()=>{
 const {CopilotToolPreferenceRepository}=await import('../src/db/repositories/copilot-tool-preference-repository.js');
 const db=new Database(':memory:');let release!:()=>void;const realNow=Date.now;
 try{
 migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
 const user=new UserRepository(db).create('waiting-start@test.dev','hash');const p=new ProjectRepository(db,user.id).create({name:'p',path:'/tmp',aiTool:'codex'});
 const repo=new SessionRepository(db,user.id);const s=repo.create({projectId:p.id,name:'s',aiTool:'codex',workingDir:'/tmp'});
 let launches=0;const manager=new InMemorySessionManager({async createSession(){launches++;},async killSession(){},async listSessions(){return[];},async capturePane(){return '';}});
 const gate=new Promise<void>(r=>{release=r;});const lock=manager.runExclusive(s.id,async()=>gate);
 const actions=new PlatformActions({db,userId:user.id,sessionManager:manager,adapterCommandRunner:async()=>({exitCode:0,stdout:'codex 1.0.0',stderr:''})},new Map(createSessionCommands().map(c=>[c.id,c])));
 const intent=actions.preview({commandId:'session.start',input:{sessionId:s.id},idempotencyKey:'blocked-start'});
 const execution=actions.execute(intent.id);
 for(let n=0;n<100&&actions.intents.get(intent.id)?.status!=='executing';n++)await new Promise(r=>setTimeout(r,1));
 assert.equal(actions.intents.get(intent.id)?.status,'executing');
 if(change==='disabled')new CopilotToolPreferenceRepository(db,user.id).setEnabled('start_session',false);
 if(change==='expired')Date.now=()=>realNow()+1_000_000;
 if(change==='resource')repo.update(s.id,{name:'changed while waiting'});
 release();await lock;
 await assert.rejects(execution,change==='resource'?/Stale resource/:new RegExp(change));assert.equal(launches,0);assert.equal(repo.getById(s.id)?.status,'idle');assert.equal(actions.intents.receipt(intent.id)?.outcome,'no_effect');
 }finally{Date.now=realNow;release?.();db.close();}
});
// A session whose status still claims `running` but whose backing terminal is
// gone (CLI exited with no attached terminal, or the daemon restarted) must be
// startable — the liveness probe treats it as a stale claim, not a conflict,
// and the restart overwrites the stale row.
test('start succeeds for a stale running session whose terminal already exited',async()=>{
 const db=new Database(':memory:');let launches=0;
 try{
 migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
 const user=new UserRepository(db).create('stale-start@test.dev','hash');const p=new ProjectRepository(db,user.id).create({name:'p',path:'/tmp',aiTool:'codex'});
 const repo=new SessionRepository(db,user.id);const s=repo.create({projectId:p.id,name:'s',aiTool:'codex',workingDir:'/tmp'});
 const manager=new InMemorySessionManager({
   async createSession(){launches++;},async killSession(){},async listSessions(){return[];},async hasSession(){return false;},async capturePane(){return '';}
 });
 const live=await manager.createSession({userId:user.id,sessionId:s.id,launchPlan:{command:'codex',args:[],cwd:'/tmp',env:{},secretEnvNames:[],credentialMode:'host_environment'}});
 repo.update(s.id,{status:'running',runtimeSessionName:live.runtimeSessionName});
 launches=0; // ignore the setup launch; only count the start's launch
 const actions=new PlatformActions({db,userId:user.id,sessionManager:manager,adapterCommandRunner:async()=>({exitCode:0,stdout:'codex 1.0.0',stderr:''})},new Map(createSessionCommands().map(c=>[c.id,c])));
 const i=actions.preview({commandId:'session.start',input:{sessionId:s.id},idempotencyKey:'stale-start'});
 await actions.execute(i.id);
 assert.equal(launches,1);
 assert.equal(repo.getById(s.id)?.status,'running');
 }finally{db.close();}
});
// Conversely, a genuinely-alive terminal is still a real conflict: starting
// must be rejected without launching a second process.
test('start is rejected when a running session has a live terminal',async()=>{
 const db=new Database(':memory:');let launches=0;
 try{
 migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
 const user=new UserRepository(db).create('alive-start@test.dev','hash');const p=new ProjectRepository(db,user.id).create({name:'p',path:'/tmp',aiTool:'codex'});
 const repo=new SessionRepository(db,user.id);const s=repo.create({projectId:p.id,name:'s',aiTool:'codex',workingDir:'/tmp'});
 const manager=new InMemorySessionManager({
   async createSession(){launches++;},async killSession(){},async listSessions(){return[];},async hasSession(){return true;},async capturePane(){return '';}
 });
 const live=await manager.createSession({userId:user.id,sessionId:s.id,launchPlan:{command:'codex',args:[],cwd:'/tmp',env:{},secretEnvNames:[],credentialMode:'host_environment'}});
 repo.update(s.id,{status:'running',runtimeSessionName:live.runtimeSessionName});
 launches=0; // ignore the setup launch; only count the start's launch
 const actions=new PlatformActions({db,userId:user.id,sessionManager:manager,adapterCommandRunner:async()=>({exitCode:0,stdout:'codex 1.0.0',stderr:''})},new Map(createSessionCommands().map(c=>[c.id,c])));
 const i=actions.preview({commandId:'session.start',input:{sessionId:s.id},idempotencyKey:'alive-start'});
 await assert.rejects(actions.execute(i.id),/already running/i);
 assert.equal(launches,0);
 }finally{db.close();}
});
// The project-level autonomy switch is the only gate on Copilot action
// origins: OFF rejects at preview time with guidance and persists nothing,
// ON approves the intent immediately, a hot OFF flip blocks new intents,
// and the owner path is never gated by the switch.
test('copilot origin is gated by the project autonomy switch; the owner path is not',async()=>{
 const db=new Database(':memory:');
 try{
  migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
  const user=new UserRepository(db).create('autonomy-switch@test.dev','hash');
  const projects=new ProjectRepository(db,user.id);
  const p=projects.create({name:'p',path:'/tmp',aiTool:'codex'});
  const repo=new SessionRepository(db,user.id);const s=repo.create({projectId:p.id,name:'s',aiTool:'codex',workingDir:'/tmp'});
  // A live run + step back the copilot action origin; the step id must equal the idempotency key.
  const conversation=new CopilotConversationLog(db,user.id).createConversation();
  db.prepare('INSERT INTO copilot_runs (id,conversation_id,user_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('run-1',conversation.id,user.id,'running',Date.now(),Date.now());
  db.prepare('INSERT INTO copilot_run_steps (id,user_id,run_id,ordinal,kind,tool_call_id,tool_name,effect) VALUES (?,?,?,?,?,?,?,?)').run('on-key',user.id,'run-1',0,'tool_call','call-on','start_session','write');
  const manager=new InMemorySessionManager({async createSession(){},async killSession(){},async listSessions(){return[];},async hasSession(){return false;},async capturePane(){return '';}});
  const base:CommandContext={db,userId:user.id,sessionManager:manager,adapterCommandRunner:async()=>({exitCode:0,stdout:'codex 1.0.0',stderr:''})};
  const commands=new Map(createSessionCommands().map(c=>[c.id,c]));
  const copilotFor=(stepId:string)=>new PlatformActions({...base,actionOrigin:{kind:'copilot',runId:'run-1',stepId}},commands);
  const owner=new PlatformActions({...base},commands);
  assert.equal(projects.getCopilotAutonomy(p.id),false);
  assert.throws(()=>copilotFor('off-key').preview({commandId:'session.start',input:{sessionId:s.id},idempotencyKey:'off-key'}),
   (error:unknown)=>error instanceof PlatformNoEffectError&&error.message.includes('COPILOT_PROJECT_AUTONOMY_OFF')&&error.message.includes('Web'));
  assert.equal(owner.intents.byKey('off-key'),undefined);
  // The owner path ignores the switch.
  const ownerIntent=owner.preview({commandId:'session.start',input:{sessionId:s.id},idempotencyKey:'owner-key'});
  assert.equal(ownerIntent.status,'approved');
  assert.equal(ownerIntent.origin_kind,'legacy');
  // ON: a copilot intent is approved immediately and records its origin.
  projects.setCopilotAutonomy(p.id,true);
  const onIntent=copilotFor('on-key').preview({commandId:'session.start',input:{sessionId:s.id},idempotencyKey:'on-key'});
  assert.equal(onIntent.status,'approved');
  assert.equal(onIntent.origin_kind,'copilot');
  assert.equal(onIntent.origin_run_id,'run-1');
  assert.equal(onIntent.origin_step_id,'on-key');
  // Hot flip back OFF: the next copilot intent is rejected again.
  projects.setCopilotAutonomy(p.id,false);
  assert.throws(()=>copilotFor('hot-key').preview({commandId:'session.start',input:{sessionId:s.id},idempotencyKey:'hot-key'}),/COPILOT_PROJECT_AUTONOMY_OFF/);
  assert.equal(owner.intents.byKey('hot-key'),undefined);
  // ON again: the approved copilot intent executes to a confirmed receipt.
  projects.setCopilotAutonomy(p.id,true);
  const receipt=await copilotFor('on-key').execute(onIntent.id);
  assert.equal(receipt.outcome,'confirmed');
  assert.equal(repo.getById(s.id)?.status,'running');
 }finally{db.close();}
});
