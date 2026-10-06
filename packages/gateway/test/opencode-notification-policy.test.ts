import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE } from '../src/services/opencode-notification-settings.js';

type Event = {type:string;properties:Record<string,unknown>};
it('OpenCode only notifies root busy-to-idle and permissions still pending after the grace period', async t=>{
  const root=await mkdtemp(join(tmpdir(),'fb-opencode-policy-'));
  const saved={...process.env};const originalFetch=globalThis.fetch;
  const sent:Record<string,unknown>[]=[];let pending:Array<{id:string;sessionID:string}>=[];
  try{
    Object.assign(process.env,{FORGEBADGER_GATEWAY_URL:'http://127.0.0.1:48731',FORGEBADGER_SESSION_ID:'fb-session',FORGEBADGER_ATTACH_TOKEN:'fixture'});
    globalThis.fetch=async(_url,init)=>{sent.push(JSON.parse(String(init?.body)));return Response.json({code:0});};
    const file=join(root,'plugin.mjs');await writeFile(file,FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE);
    const module=await import(pathToFileURL(file).href) as {ForgeBadgerPermissionNotify:(input:unknown)=>Promise<{event:(input:{event:Event})=>Promise<void>}>};
    const plugin=await module.ForgeBadgerPermissionNotify({client:{session:{get:async(input:{path:{id:string}})=>({data:{id:input.path.id,...(input.path.id==='child'?{parentID:'root'}:{})}})},permission:{list:async()=>({data:pending})}}});
    const event=(type:string,properties:Record<string,unknown>)=>plugin.event({event:{type,properties}});
    for(const id of ['root','child']){await event('session.status',{sessionID:id,status:{type:'busy'}});await event('session.idle',{sessionID:id});}
    await event('session.idle',{sessionID:'root'});
    assert.deepEqual(sent.map(event => event.hook_event_name), ['TaskStarted', 'Stop']);
    assert.ok(sent.every(event => event.session_id === 'root'));
    t.mock.timers.enable({apis:['setTimeout']});
    await event('permission.asked',{id:'auto',sessionID:'root',permission:'bash'});
    await event('permission.replied',{requestID:'auto',sessionID:'root'});
    t.mock.timers.tick(1000);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(sent.length,2);
    pending=[{id:'human',sessionID:'root'}];
    await event('permission.asked',{id:'human',sessionID:'root',permission:'bash'});
    t.mock.timers.tick(1000);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(sent.length,3);assert.equal(sent[2]?.hook_event_name,'PermissionRequest');
    pending=[];
    await event('permission.asked',{id:'resolved-without-event',sessionID:'root',permission:'bash'});
    t.mock.timers.tick(1000);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(sent.length,3);
  }finally{
    t.mock.timers.reset();globalThis.fetch=originalFetch;
    for(const key of ['FORGEBADGER_GATEWAY_URL','FORGEBADGER_SESSION_ID','FORGEBADGER_ATTACH_TOKEN']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
    await rm(root,{recursive:true,force:true});
  }
});
