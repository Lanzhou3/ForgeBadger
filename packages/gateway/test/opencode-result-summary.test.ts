import assert from 'node:assert/strict';
import {it} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE} from '../src/services/opencode-notification-settings.js';

for(const sdk of ['v1','v2'] as const)it(`OpenCode ${sdk} freezes only completed root text with the active user parent`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fb-opencode-result-')),saved={...process.env},originalFetch=globalThis.fetch;
  const sent:Record<string,unknown>[]=[];
  try {
    Object.assign(process.env,{FORGEBADGER_GATEWAY_URL:'http://127.0.0.1:48731',FORGEBADGER_SESSION_ID:'fixture',FORGEBADGER_ATTACH_TOKEN:'fixture'});
    globalThis.fetch=async(_url,init)=>{sent.push(JSON.parse(String(init?.body)));return Response.json({code:0});};
    const file=join(dir,'plugin.mjs');await writeFile(file,FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE);
    const module=await import(pathToFileURL(file).href);
    const plugin=await module.ForgeBadgerPermissionNotify({client:{session:{get:async(input:{path:{id:string};sessionID:string})=>{
      const id=sdk==='v1'?input.path.id:input.sessionID;return {data:{id,...(id==='child'?{parentID:'root'}:{})}};
    }}}});
    const event=(type:string,properties:Record<string,unknown>)=>plugin.event({event:{type,properties}});
    await event('message.updated',{info:{sessionID:'root',id:'user-A',role:'user'}});
    await event('message.part.updated',{part:{sessionID:'root',messageID:'user-A',id:'prompt',type:'text',text:'Request A'}});
    await event('session.status',{sessionID:'root',status:{type:'busy'}});
    await event('message.updated',{info:{sessionID:'root',id:'assistant-A',role:'assistant',parentID:'user-A',finish:'stop',time:{completed:100}}});
    await event('message.part.updated',{part:{sessionID:'root',messageID:'assistant-A',id:'result',type:'text',text:'Root result A'}});
    await event('message.part.updated',{part:{sessionID:'root',messageID:'assistant-A',id:'reasoning',type:'reasoning',text:'Private reasoning'}});
    await event('message.updated',{info:{sessionID:'root',id:'late-old',role:'assistant',parentID:'other-user',finish:'stop',time:{completed:200}}});
    await event('message.part.updated',{part:{sessionID:'root',messageID:'late-old',id:'old',type:'text',text:'Wrong round'}});
    await event('session.idle',{sessionID:'root'});
    const stop=sent.find(e=>e.hook_event_name==='Stop')!;
    assert.equal(stop.last_assistant_message,'Root result A');assert.equal(stop.turn_id,'user-A');
    assert.equal(sent.find(e=>e.hook_event_name==='UserPromptSubmit')?.prompt,'Request A');
    assert.doesNotMatch(JSON.stringify(sent),/Private reasoning|Wrong round/);
    const count=sent.length;
    await event('session.status',{sessionID:'child',status:{type:'busy'}});
    await event('session.idle',{sessionID:'child'});assert.equal(sent.length,count);
    await event('session.status',{sessionID:'root',status:{type:'busy'}});
    await event('session.error',{sessionID:'root',error:{name:'APIError',data:{message:'Specific failure'}}});
    assert.equal(sent.at(-1)?.error_message,'Specific failure');
    const afterError=sent.length;await event('session.idle',{sessionID:'root'});assert.equal(sent.length,afterError);
  }finally {
    globalThis.fetch=originalFetch;
    for(const key of ['FORGEBADGER_GATEWAY_URL','FORGEBADGER_SESSION_ID','FORGEBADGER_ATTACH_TOKEN']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
    await rm(dir,{recursive:true,force:true});
  }
});

for(const mode of ['race','race-unknown','parts','bytes','eviction'] as const)it(`OpenCode preserves whole-message identity and redaction boundaries for ${mode}`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fb-opencode-boundary-')),saved={...process.env},originalFetch=globalThis.fetch;
  const sent:Record<string,unknown>[]=[];
  let defer=false,release:(()=>void)|undefined;
  try {
    Object.assign(process.env,{FORGEBADGER_GATEWAY_URL:'http://127.0.0.1:48731',FORGEBADGER_SESSION_ID:'fixture',FORGEBADGER_ATTACH_TOKEN:'fixture'});
    globalThis.fetch=async(_url,init)=>{sent.push(JSON.parse(String(init?.body)));return Response.json({code:0});};
    const file=join(dir,'plugin.mjs');await writeFile(file,FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE);
    const module=await import(pathToFileURL(file).href);
    const plugin=await module.ForgeBadgerPermissionNotify({client:{session:{get:async()=>{
      if(defer){defer=false;await new Promise<void>(r=>{release=r;});}return {data:{id:'root'}};
    }}}});
    const event=(type:string,properties:Record<string,unknown>)=>plugin.event({event:{type,properties}});
    const part=(id:string,text:string,messageID='assistant-A')=>event('message.part.updated',{part:{sessionID:'root',messageID,id,type:'text',text}});
    await event('message.updated',{info:{sessionID:'root',id:'user-A',role:'user'}});
    await event('session.status',{sessionID:'root',status:{type:'busy'}});
    if(mode==='race'||mode==='race-unknown') {
      await part('result','Result A');
      await event('message.updated',{info:{sessionID:'root',id:'assistant-A',role:'assistant',parentID:'user-A',finish:'stop',time:{completed:1}}});
      defer=true;const idle=event('session.idle',{sessionID:'root'});assert.ok(release);
      if(mode==='race')await event('message.updated',{info:{sessionID:'root',id:'user-B',role:'user'}});
      await event('session.status',{sessionID:'root',status:{type:'busy'}});
      await part('result-B','Result B','assistant-B');
      await event('message.updated',{info:{sessionID:'root',id:'assistant-B',role:'assistant',parentID:'user-B',finish:'stop',time:{completed:2}}});
      release();await idle;
      if(mode==='race-unknown') {
        assert.equal(sent.filter(e=>e.hook_event_name==='Stop').length,0);
        assert.equal(sent.at(-1)?.hook_event_name,'TaskStarted');
        assert.equal(sent.at(-1)?.turn_id,undefined);
        await event('session.idle',{sessionID:'root'});
        assert.equal(sent.filter(e=>e.hook_event_name==='Stop').length,1);
        assert.equal(sent.at(-1)?.last_assistant_message,undefined);
        return;
      }
      assert.equal(sent.filter(e=>e.hook_event_name==='Stop')[0]!.turn_id,'user-A');
      await event('session.idle',{sessionID:'root'});
      const final=sent.filter(e=>e.hook_event_name==='Stop').at(-1)!;
      assert.equal(final.turn_id,'user-B');assert.equal(final.last_assistant_message,'Result B');
    } else {
      await part('begin','-----BEGIN PRIVATE KEY-----');
      if(mode==='parts')for(let i=0;i<7;i++)await part(String(i),'fixture_private_body_'+i);
      if(mode==='bytes')await part('large','fixture_private_body'.repeat(4000));
      if(mode==='eviction')for(let i=0;i<33;i++)await part('extra','unrelated','message-'+i);
      await part('end','fixture_private_body\n-----END PRIVATE KEY-----');
      await event('message.updated',{info:{sessionID:'root',id:'assistant-A',role:'assistant',parentID:'user-A',finish:'stop',time:{completed:1}}});
      await event('session.idle',{sessionID:'root'});
      assert.equal(sent.find(e=>e.hook_event_name==='Stop')!.last_assistant_message,undefined);
      assert.doesNotMatch(JSON.stringify(sent),/fixture_private_body/);
    }
  }finally {
    globalThis.fetch=originalFetch;
    for(const key of ['FORGEBADGER_GATEWAY_URL','FORGEBADGER_SESSION_ID','FORGEBADGER_ATTACH_TOKEN']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
    await rm(dir,{recursive:true,force:true});
  }
});
