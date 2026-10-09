import assert from 'node:assert/strict';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { ForgeBadgerEventBus, type ForgeBadgerEvent } from '../src/services/event-bus.js';
import { handleSessionNotificationHook } from '../src/routes/session-hooks.js';
import { createNotificationDeduper } from '../src/services/notification-dedupe.js';
import { ingestTerminalNotification } from '../src/services/terminal-notification-ingestion.js';
import { attachNotificationPersistence } from '../src/services/notification-events.js';
import { createLaunchPlan } from '../src/services/session-launch-plan.js';

function fixture(adapter: 'claude'|'codex'|'kimi'|'opencode'|'pi') {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('notify-filter@test.dev','hash');
  const project = new ProjectRepository(db,user.id).create({ name:'Project',path:'/private/tmp/notify-filter',aiTool:adapter });
  const session = new SessionRepository(db,user.id).create({ projectId:project.id,name:'Session',workingDir:project.path,aiTool:adapter,attachToken:'token' });
  const eventBus = new ForgeBadgerEventBus(); const events: ForgeBadgerEvent[] = [];
  eventBus.on('event', event=>events.push(event as ForgeBadgerEvent));
  attachNotificationPersistence({db,eventBus});
  const hook=(event:Record<string,unknown>)=>handleSessionNotificationHook(db,eventBus,{adapter,...event},'token',session.id,createNotificationDeduper());
  const notifications=()=>events.filter(e=>e.type==='session_notification');
  return {db,eventBus,events,session,hook,notifications};
}

for (const adapter of ['claude','codex'] as const) it(`${adapter} does not mistake pre-review PermissionRequest for human approval`,()=>{
  const f=fixture(adapter);try{
    for(const permission_mode of ['default','auto','bypassPermissions']) assert.equal(f.hook({hook_event_name:'PermissionRequest',permission_mode,tool_name:'Bash'}).status,200);
    assert.equal(f.notifications().length,0);
    assert.equal((f.db.prepare('SELECT count(*) n FROM notifications').get() as {n:number}).n,0);
  }finally{f.db.close();}
});

it('keeps Claude actual human prompt even in auto mode and with child agent context',()=>{
  const f=fixture('claude');try{
    f.hook({hook_event_name:'Notification',notification_type:'permission_prompt',permission_mode:'auto',agent_id:'child',message:'Needs approval'});
    assert.equal(f.notifications().length,1);
  }finally{f.db.close();}
});

for(const adapter of ['claude','codex','kimi','opencode','pi'] as const)it(`${adapter} filters child completion and session exit but keeps root completion and failure`,()=>{
  const f=fixture(adapter);try{
    for(const event of [{hook_event_name:'Stop',agent_id:'child'},{hook_event_name:'SubagentStop'},
      {hook_event_name:'Notification',notification_type:'task.completed'},{hook_event_name:'SessionEnd'},
      {hook_event_name:'PermissionDenied',permission_mode:'auto'},{hook_event_name:'Interrupt'}]) f.hook(event);
    assert.equal(f.notifications().length,0);
    f.hook({hook_event_name:'Stop'});f.hook({hook_event_name:'StopFailure'});
    assert.deepEqual(f.notifications().map(e=>e.notificationType),['task_completed','task_failed']);
  }finally{f.db.close();}
});

for(const adapter of ['kimi','opencode','pi'] as const)it(`${adapter} preserves real pending user input`,()=>{
  const f=fixture(adapter);try{f.hook({hook_event_name:'PermissionRequest',tool_name:'Bash'});assert.equal(f.notifications().length,1);}finally{f.db.close();}
});

it('ignores unclassified bells and Codex completion previews but retains Codex displayed approvals',()=>{
  for(const adapter of ['claude','codex','kimi','opencode','pi'] as const){
    const f=fixture(adapter);try{
      assert.equal(ingestTerminalNotification({...f,sessionId:f.session.id,notification:{kind:'bell'}}).handled,false);
      if(adapter==='codex'){
        assert.equal(ingestTerminalNotification({...f,sessionId:f.session.id,notification:{kind:'osc',code:9,text:'Agent turn complete'}}).handled,false);
        assert.equal(ingestTerminalNotification({...f,sessionId:f.session.id,notification:{kind:'osc',code:9,text:'Approval requested: pnpm test'}}).handled,true);
      }
    }finally{f.db.close();}
  }
});

it('configures Codex user-facing approval OSC notifications without changing its approval policy',()=>{
  const plan=createLaunchPlan({adapter:'codex',projectRoot:'/private/tmp/project',sessionId:'session'});
  assert.ok(plan.args.includes('tui.notifications=["approval-requested"]'));
  assert.ok(plan.args.includes('tui.notification_method="osc9"'));
  assert.ok(plan.args.includes('tui.notification_condition="always"'));
  assert.ok(!plan.args.some(arg=>arg.includes('approval_policy')||arg.includes('approvals_reviewer')));
});

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensurePiNotificationSettings } from '../src/services/cli-notification-settings.js';
it('Pi suppresses headless subagent events while preserving interactive completion and prompts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'fb-pi-filter-'));const saved={...process.env};const originalFetch=globalThis.fetch;
  const handlers=new Map<string,(event:Record<string,unknown>,context:{hasUI:boolean})=>Promise<void>|void>();
  const sent:Record<string,unknown>[]=[];
  try{
    Object.assign(process.env,{PI_CODING_AGENT_DIR:root,FORGEBADGER_GATEWAY_URL:'http://127.0.0.1:48731',FORGEBADGER_SESSION_ID:'session',FORGEBADGER_ATTACH_TOKEN:'fixture'});
    globalThis.fetch=async(_url,init)=>{sent.push(JSON.parse(String(init?.body)));return Response.json({code:0});};
    const generated=await ensurePiNotificationSettings();const file=join(root,'notify.mjs');await writeFile(file,await readFile(generated.path,'utf8'));
    const module=await import(pathToFileURL(file).href) as {default:(api:unknown)=>void};
    module.default({on:(name:string,handler:typeof handlers extends Map<string,infer H>?H:never)=>handlers.set(name,handler)});
    for(const name of ['agent_start','agent_settled','ui_prompt_start']){
      await handlers.get(name)!({kind:'confirm'},{hasUI:false});assert.equal(sent.length,0);
    }
    await handlers.get('agent_start')!({}, {hasUI:true});
    assert.ok(handlers.has('message_end'));
    await handlers.get('message_end')!({message:{role:'assistant',content:[{type:'thinking',thinking:'private reasoning'},{type:'text',text:'Final fixture reply'}]}}, {hasUI:true});
    assert.equal(sent.length,1, 'a finalized message alone is not settled completion');
    await handlers.get('agent_settled')!({}, {hasUI:true});
    await handlers.get('ui_prompt_start')!({kind:'confirm'}, {hasUI:true});
    assert.deepEqual(sent.map(event=>event.hook_event_name),['TaskStarted','Stop','PermissionRequest']);
    assert.equal(sent[1]!.last_assistant_message,'Final fixture reply');
    assert.doesNotMatch(JSON.stringify(sent),/private reasoning/);
    await handlers.get('agent_start')!({}, {hasUI:true});
    await handlers.get('message_end')!({message:{role:'assistant',content:[{type:'text',text:'Old session reply'}]}}, {hasUI:true});
    await handlers.get('session_shutdown')!({}, {hasUI:true});
    await handlers.get('agent_start')!({}, {hasUI:true});
    await handlers.get('agent_settled')!({}, {hasUI:true});
    assert.equal(sent.at(-1)!.last_assistant_message,undefined);
  }finally{
    globalThis.fetch=originalFetch;
    for(const key of ['PI_CODING_AGENT_DIR','FORGEBADGER_GATEWAY_URL','FORGEBADGER_SESSION_ID','FORGEBADGER_ATTACH_TOKEN']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
    await rm(root,{recursive:true,force:true});
  }
});
