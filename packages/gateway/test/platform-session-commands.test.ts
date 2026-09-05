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

test('session lifecycle catalog includes a nondelegatable explicit takeover', () => {
  const commands = createSessionCommands();
  assert.deepEqual(commands.map(c => c.id), ['session.start', 'session.stop', 'session.takeover']);
  assert.equal(commands.find(c => c.id === 'session.takeover')?.delegatable, false);
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
      async inspectPane(){return {content:pane,dead:false,inMode:false};},
      async stageProgrammaticInput(_name,data){pane=`› ${data}\n\nmodel · cwd`;staged();},
      async pressEnter(){enters++;}
    },undefined,undefined,{sleep:async()=>settled});
    const live = await manager.createSession({userId:user.id,sessionId:session.id,launchPlan:{command:'codex',args:[],cwd:'/tmp',env:{},secretEnvNames:[],credentialMode:'host_environment'}});
    repo.update(session.id,{status:'running',tmuxSession:live.tmuxName});
    const commands = new Map(createSessionCommands().map(command => [command.id,command]));
    const actions = new PlatformActions({db,userId:user.id,sessionManager:manager},commands);
    const intent = actions.preview({commandId:'session.stop',input:{sessionId:session.id},authority:'owner_action',idempotencyKey:'stop'});
    assert.equal(intent.resources_json.includes('private-attach-token'),false);
    actions.decide(intent.id,intent.digest,true);
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
test('missing runtime and unavailable adapter preconditions consume no grant budget or active slot',async()=>{
 const db=new Database(':memory:');try{
 migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const user=new UserRepository(db).create('no-effect-session@test.dev','hash');const p=new ProjectRepository(db,user.id).create({name:'p',path:'/tmp',aiTool:'codex'});
 const s=new SessionRepository(db,user.id).create({projectId:p.id,name:'s',aiTool:'codex',workingDir:'/tmp'});
 const commands=new Map(createSessionCommands().map(c=>[c.id,c]));const actions=new PlatformActions({db,userId:user.id},commands);
 const grant=actions.createGrant({name:'start',projectIds:[p.id],capabilities:['session.start'],expiresAt:Date.now()+100000,maxActions:1});
 const i=actions.preview({commandId:'session.start',input:{sessionId:s.id},authority:'delegated_grant',grantId:grant.id,idempotencyKey:'missing-runtime'});
 await assert.rejects(actions.execute(i.id),/runtime unavailable/);assert.equal(actions.grants.get(grant.id)?.usedActions,0);assert.equal(actions.intents.activeForGrant(grant.id),0);
 actions.context.sessionManager=new InMemorySessionManager({async createSession(){assert.fail('must not launch');},async killSession(){},async listSessions(){return[];},async capturePane(){return '';}});
 actions.context.adapterCommandRunner=async()=>({exitCode:1,stdout:'',stderr:'missing'});
 await assert.rejects(actions.execute(i.id),/not available for launch/);
 assert.equal(actions.grants.get(grant.id)?.usedActions,0);assert.equal(actions.intents.activeForGrant(grant.id),0);
 assert.equal(new SessionRepository(db,user.id).getById(s.id)?.status,'idle');
 }finally{db.close();}
});
for (const change of ['disabled','expired','resource','revoked'] as const) test(`a ${change} check while start waits prevents launch effects and refunds the reservation`,async()=>{
 const {CopilotToolPreferenceRepository}=await import('../src/db/repositories/copilot-tool-preference-repository.js');
 const db=new Database(':memory:');let release!:()=>void;const realNow=Date.now;
 try{
 migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
 const user=new UserRepository(db).create('waiting-start@test.dev','hash');const p=new ProjectRepository(db,user.id).create({name:'p',path:'/tmp',aiTool:'codex'});
 const repo=new SessionRepository(db,user.id);const s=repo.create({projectId:p.id,name:'s',aiTool:'codex',workingDir:'/tmp'});
 let launches=0;const manager=new InMemorySessionManager({async createSession(){launches++;},async killSession(){},async listSessions(){return[];},async capturePane(){return '';}});
 const gate=new Promise<void>(r=>{release=r;});const lock=manager.runExclusive(s.id,async()=>gate);
 const actions=new PlatformActions({db,userId:user.id,sessionManager:manager,adapterCommandRunner:async()=>({exitCode:0,stdout:'codex 1.0.0',stderr:''})},new Map(createSessionCommands().map(c=>[c.id,c])));
 const grant=actions.createGrant({name:'start',projectIds:[p.id],capabilities:['session.start'],expiresAt:Date.now()+100000,maxActions:1});
 const intent=actions.preview({commandId:'session.start',input:{sessionId:s.id},authority:'delegated_grant',grantId:grant.id,idempotencyKey:'blocked-start'});
 const execution=actions.execute(intent.id);
 for(let n=0;n<100&&actions.intents.get(intent.id)?.status!=='executing';n++)await new Promise(r=>setTimeout(r,1));
 assert.equal(actions.intents.get(intent.id)?.status,'executing');
 if(change==='disabled')new CopilotToolPreferenceRepository(db,user.id).setEnabled('start_session',false);
 if(change==='expired')Date.now=()=>realNow()+1_000_000;
 if(change==='revoked')actions.grants.revoke(grant.id);
 if(change==='resource')repo.update(s.id,{name:'changed while waiting'});
 release();await lock;
 await assert.rejects(execution,change==='resource'?/Stale resource/:new RegExp(change));assert.equal(launches,0);assert.equal(repo.getById(s.id)?.status,'idle');assert.equal(actions.grants.get(grant.id)?.usedActions,0);assert.equal(actions.intents.receipt(intent.id)?.outcome,'no_effect');
 }finally{Date.now=realNow;release?.();db.close();}
});
