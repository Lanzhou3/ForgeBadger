import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { signJwt } from '../src/auth/jwt.js';
import { createNotificationRoutes } from '../src/routes/notifications.js';
import { FeishuChannelRepository } from '../src/db/repositories/feishu-channel-repository.js';
import { FeishuIntegrationRepository } from '../src/db/repositories/feishu-integration-repository.js';
import { ChannelIdentityService } from '../src/services/channels/channel-identity-service.js';
import { NotificationRepository } from '../src/db/repositories/notification-repository.js';
import { NotificationService } from '../src/services/notification-service.js';
import { FeishuNotifications } from '../src/services/notifications/feishu-notifications.js';
import { FeishuNotificationWorker, type FeishuNotificationIO } from '../src/services/notifications/feishu-notification-worker.js';
import { attachNotificationPersistence } from '../src/services/notification-events.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { deliverAutomationResult } from '../src/services/automation/delivery.js';
import { createNativeFeishuRuntime } from '../src/services/channels/native-feishu-runtime.js';
import { FeishuNotificationTargets } from '../src/services/notifications/feishu-notification-targets.js';

function fixture() {
  const db=new Sqlite(':memory:');migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
  const user=new UserRepository(db).create('owner@test.dev','fixture'),other=new UserRepository(db).create('other@test.dev','fixture');
  const key=randomBytes(32).toString('hex');
  const accounts=new FeishuChannelRepository(db,user.id,key);
  const account=accounts.upsertAccount({appId:'fixture',appSecret:randomBytes(24).toString('hex'),enabled:true});
  const integration=new FeishuIntegrationRepository(db,user.id);integration.upsertConfig({enabled:true,emergencyDisabled:false,allowedChatIds:['chat']});
  const identities=new ChannelIdentityService(db,user.id,key);
  const peer={channel:'feishu' as const,accountId:account.id,accountRevision:account.configRevision,externalUserId:'owner',chatId:'chat',chatType:'p2p' as const};
  const pair=identities.createPairing({channel:'feishu',accountId:account.id}),claim=identities.claimPairing(pair.token,peer);
  const identity=identities.confirmPairing(claim.id,{revision:claim.revision,externalUserId:'owner',chatId:'chat'});
  const service=new FeishuNotifications(db,user.id),notifications=new NotificationRepository(db,user.id);
  const enable=(extra:Partial<ReturnType<typeof service.records.config>>={})=>service.update({...service.records.config(),enabled:true,targetId:`private:${identity.id}`,identityId:identity.id,...extra});
  const create=(type='task_completed',message='已完成')=>new NotificationService(db,user.id).create({type:'claude_notification',titleKey:'notifications.taskCompleted',message,href:'/sessions/not-trusted',payload:{notification_type:type,project_name:'Project',session_name:'Session',adapter:'codex'}});
  const calls:{url:string;body:Record<string,unknown>}[]=[];
  const io:FeishuNotificationIO={validate:async()=>{},fetch:async(url,init)=>{
    calls.push({url:String(url),body:JSON.parse(String(init?.body??'{}')) as Record<string,unknown>});
    return String(url).includes('/auth/')?Response.json({code:0,tenant_access_token:'fixture'}):Response.json({code:0,data:{message_id:'om-ok'}});
  }};
  const worker=()=>new FeishuNotificationWorker(db,user.id,key,io).runOnce(new AbortController().signal);
  return {db,user,other,key,accounts,account,integration,identities,identity,service,notifications,enable,create,io,calls,worker};
}

it('exposes an owner-only disabled-by-default Feishu notification subscription',async()=>{
  const db=new Sqlite(':memory:');
  migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
  const user=new UserRepository(db).create('notification@test.dev','fixture');
  const secret=randomBytes(32).toString('hex');
  const app=express();app.locals.db=db;app.locals.jwtSecret=secret;app.use(express.json());app.use('/notifications',createNotificationRoutes(db));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  try {
    const url=`http://127.0.0.1:${address.port}/notifications/feishu`;
    assert.equal((await fetch(url)).status,401);
    const response=await fetch(url,{headers:{authorization:`Bearer ${signJwt({userId:user.id,email:user.email},secret)}`}});
    assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.code,0);assert.equal(body.data.config.enabled,false);
    assert.deepEqual(body.data.config.types,['attention','failure','completion']);
  }finally{await new Promise<void>(r=>server.close(()=>r()));db.close();}
});

it('subscribes without a project or remote route, and sends a personal JSON 2.0 card',async()=>{
  const f=fixture();try {
    f.enable();f.create();await f.worker();
    assert.equal(f.identities.records.listRoutes().length,0);
    const sent=f.calls.at(-1)!.body;assert.equal(sent.msg_type,'interactive');assert.equal(sent.receive_id,'chat');
    const card=JSON.parse(sent.content as string);assert.equal(card.schema,'2.0');assert.match(card.header.title.content,/回复结束/);
    assert.ok(card.body.elements.every((element:{tag:string})=>element.tag!=='button'));
    assert.equal(f.service.records.list()[0]!.status,'delivered');assert.equal(f.notifications.list().length,1);
  }finally{f.db.close();}
});

it('notification subscription is independent of the inbound command allowlist',async()=>{
  const f=fixture();try {
    f.integration.upsertConfig({allowedChatIds:['configured-group']});
    f.service.update({...f.service.records.config(),enabled:true,targetId:`private:${f.identity.id}`,identityId:f.identity.id});
    f.create();await f.worker();
    assert.equal(f.service.records.list()[0]?.status,'delivered');
    assert.deepEqual(f.integration.getConfig().allowedChatIds,['configured-group']);
    const pair=f.identities.createPairing({channel:'feishu',accountId:f.account.id});
    assert.throws(()=>f.identities.claimPairing(pair.token,{channel:'feishu',accountId:f.account.id,accountRevision:f.account.configRevision,
      externalUserId:'owner',chatId:'chat',chatType:'p2p'}),/CHANNEL_AUTHORITY_REJECTED/);
  }finally{f.db.close();}
});

it('validates settings and test cards over HTTP and isolates delivery metadata', async () => {
  const f = fixture();
  const secret = randomBytes(32).toString('hex');
  const app = express();
  app.locals.db = f.db;
  app.locals.jwtSecret = secret;
  app.use(express.json());
  app.use('/notifications', createNotificationRoutes(f.db,{masterKey:f.key,io:f.io}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/notifications/feishu`;
  const request = (path: string, method = 'GET', body?: unknown, user = f.user) => fetch(url + path, {
    method,
    headers: { authorization: `Bearer ${signJwt({ userId: user.id, email: user.email }, secret)}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    const input = { ...f.service.records.config(), enabled: true, targetId: `private:${f.identity.id}`, identityId: f.identity.id };
    assert.equal((await request('', 'PUT', input, f.other)).status, 409);
    assert.equal((await request('', 'PUT', { ...input, chatId: 'arbitrary' })).status, 400);
    assert.equal((await request('/targets/refresh','POST',{chatId:'arbitrary'})).status,400);
    for (const webBaseUrl of ['not a URL', 'https://user:pass@example.com']) {
      const invalid = await request('', 'PUT', { ...input, webBaseUrl });
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).details.code, 'WEB_URL_INVALID');
    }
    f.db.exec("CREATE TRIGGER fail_notification_settings BEFORE INSERT ON feishu_notification_settings BEGIN SELECT RAISE(ABORT, 'private database error'); END");
    const unavailable = await request('', 'PUT', input);
    assert.equal(unavailable.status, 500);
    assert.equal((await unavailable.json()).details.code, 'INTERNAL_ERROR');
    f.db.exec('DROP TRIGGER fail_notification_settings');
    const saved = await request('', 'PUT', input);
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get('cache-control'), 'no-store');
    assert.equal((await saved.json()).data.config.revision, 1);
    assert.equal((await request('', 'PUT', input)).status, 409);
    assert.equal((await request('/test', 'POST', { requestId: randomUUID(), content: 'arbitrary' })).status, 400);
    const body = { requestId: randomUUID() };
    const first = await request('/test', 'POST', body);
    assert.equal(first.status, 202);
    const receipt = (await first.json()).data;
    assert.deepEqual((await (await request('/test', 'POST', body)).json()).data, receipt);
    const own = (await (await request('/deliveries')).json()).data.deliveries;
    assert.equal(own.length, 1);
    assert.deepEqual(Object.keys(own[0]).sort(), ['createdAt', 'errorCode', 'id', 'status', 'type']);
    assert.deepEqual((await (await request('/deliveries', 'GET', undefined, f.other)).json()).data.deliveries, []);
    groupDirectory(f);
    const refresh=await request('/targets/refresh','POST',{});
    assert.equal(refresh.status,200);
    const refreshed=(await refresh.json()).data.targets;
    assert.equal(refreshed.filter((target:{kind:string})=>target.kind==='group').length,1);
    assert.deepEqual((await (await request('','GET',undefined,f.other)).json()).data.targets,[]);
    f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id);
    assert.equal((await request('/test', 'POST', { requestId: randomUUID() })).status, 401);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    f.db.close();
  }
});

it('the production runtime drains notifications without a remote project route', async () => {
  const f = fixture();
  const runtime = createNativeFeishuRuntime(f.db, f.key, {
    ...f.io,
    sdkFactory: { createWebSocketClient: (_config, callbacks) => ({
      start: async () => { callbacks.onReady?.(); },
      close: () => {},
      getConnectionStatus: () => ({ state: 'connected', reconnectAttempts: 0 }),
    }) },
  });
  try {
    f.enable();
    f.create();
    await runtime.start();
    const deadline = Date.now() + 5000;
    while (f.service.records.list()[0]?.status !== 'delivered' && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(f.service.records.list()[0]?.status, 'delivered');
    assert.equal(f.identities.records.listRoutes().length, 0);
    assert.equal(f.calls.filter(call => call.url.includes('/messages')).length, 1);
  } finally {
    await runtime.stop();
    f.db.close();
  }
});

it('does not backfill disabled history and filters explicit event types',()=>{
  const f=fixture();try {
    f.create();assert.equal(f.service.records.list().length,0);f.enable({types:['failure']});
    for(const type of ['task_completed','attention','permission_prompt','session_ended','invented'])f.create(type);
    f.create('task_failed');f.create('permission_denied');
    assert.equal(f.service.records.list().length,2);assert.ok(f.service.records.list().every(d=>d.event_type==='failure'));
  }finally{f.db.close();}
});

it('stale, foreign and revoked subscriptions cannot prevent local notification persistence',()=>{
  const f=fixture();try {
    assert.throws(()=>new FeishuNotifications(f.db,f.other.id).update({...f.service.records.config(),enabled:true,targetId:`private:${f.identity.id}`,identityId:f.identity.id}),/TARGET_INVALID/);
    f.enable();f.identities.revokeIdentity(f.identity.id);f.create();
    assert.equal(f.notifications.list().length,1);assert.equal(f.service.records.list().length,0);
    assert.equal(new FeishuNotifications(f.db,f.other.id).records.list().length,0);
    f.service.update({...f.service.records.config(),enabled:false});assert.equal(f.service.records.config().enabled,false);
  }finally{f.db.close();}
});

it('same settings preserve queued records; revisions reject stale writes and never revive old deliveries',async()=>{
  const f=fixture();try {
    f.enable();const n=f.create();f.service.enqueue(n);assert.equal(f.service.records.list().length,1);
    const before=f.service.records.config();f.service.update(before);assert.equal(f.service.records.config().revision,before.revision);
    f.service.update({...before,enabled:false});assert.equal(f.service.records.list()[0]!.status,'cancelled');
    assert.throws(()=>f.service.update(before),/CONFIG_CONFLICT/);
    f.enable();await f.worker();assert.equal(f.calls.length,0);f.create();await f.worker();
    assert.equal(f.service.records.list().filter(r=>r.status==='delivered').length,1);
  }finally{f.db.close();}
});

it('test cards are user-scoped and idempotent across configuration changes',async()=>{
  const f=fixture();try {
    const requestId=randomUUID();assert.throws(()=>f.service.test({requestId}),/SUBSCRIPTION_DISABLED/);
    f.enable();assert.throws(()=>f.service.test({requestId,chatId:'foreign'}));
    const first=f.service.test({requestId});assert.equal(f.service.test({requestId}).id,first.id);
    f.service.update({...f.service.records.config(),enabled:false});f.enable();
    assert.equal(f.service.test({requestId}).id,first.id);await f.worker();assert.equal(f.calls.length,0);
    assert.equal(new FeishuNotifications(f.db,f.other.id).records.get(first.id),undefined);
  }finally{f.db.close();}
});

it('keeps test requests idempotent when the pending queue is full', () => {
  const f = fixture();
  try {
    f.enable();
    const requestId = randomUUID();
    const first = f.service.test({ requestId });
    for (let i = 1; i < 100; i++) f.service.test({ requestId: randomUUID() });
    assert.equal(f.service.test({ requestId }).id, first.id);
    assert.throws(() => f.service.test({ requestId: randomUUID() }), /QUEUE_FULL/);
    assert.equal(f.service.records.pendingCount(), 100);
  } finally { f.db.close(); }
});

const invalidations:Record<string,(f:ReturnType<typeof fixture>)=>void>={
  'subscription disabled':f=>{f.service.update({...f.service.records.config(),enabled:false});},
  'identity revoked':f=>{f.identities.revokeIdentity(f.identity.id);},
  'account rotated':f=>{f.accounts.upsertAccount({appId:'new-app',appSecret:randomBytes(24).toString('hex'),enabled:true});},
  'emergency stop':f=>{f.integration.upsertConfig({emergencyDisabled:true});},
  'user disabled':f=>{f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id);},
  'source deleted':f=>{f.notifications.clearAll();}
};
for(const [name,invalidate] of Object.entries(invalidations))it(`does not send after ${name} during token await`,async()=>{
  const f=fixture();try {
    f.enable();f.create();const original=f.io.fetch!;
    f.io.fetch=async(url,init)=>{const response=await original(url,init);if(String(url).includes('/auth/'))invalidate(f);return response;};
    await f.worker();assert.equal(f.calls.filter(c=>c.url.includes('/messages')).length,0);
    assert.equal(f.service.records.list()[0]!.status,'cancelled');
  }finally{f.db.close();}
});

it('permanent errors and ambiguous outcomes are not automatically resent',async()=>{
  for(const mode of ['rejected','network','invalid','missing','gateway'] as const) {
    const f=fixture();try {
      f.enable();f.create();const original=f.io.fetch!;let sends=0;
      f.io.fetch=async(url,init)=>{
        if(String(url).includes('/auth/'))return original(url,init);sends++;
        if(mode==='network')throw new Error('network lost');
        if(mode==='invalid')return new Response('broken');
        if(mode==='missing')return Response.json({code:0});
        if(mode==='gateway')return Response.json({code:1},{status:502});
        return Response.json({code:230002},{status:400});
      };
      await f.worker();await f.worker();assert.equal(sends,1);
      assert.equal(f.service.records.list()[0]!.status,mode==='rejected'?'failed':'unknown');
    }finally{f.db.close();}
  }
});

it('429 schedules a durable retry with stable UUID and survives a real database reopen',async()=>{
  const f=fixture(),dir=mkdtempSync(join(tmpdir(),'fb-notification-reopen-'));try {
    f.enable();f.create();const original=f.io.fetch!;let limited=true;const uuids:string[]=[];
    f.io.fetch=async(url,init)=>{
      if(String(url).includes('/messages')){uuids.push(JSON.parse(String(init?.body??'{}')).uuid);if(limited){limited=false;return new Response('',{status:429,headers:{'retry-after':'60'}});}}
      return original(url,init);
    };
    await f.worker();const item=f.service.records.list()[0]!;
    assert.equal(item.status,'pending');assert.ok(item.next_attempt_at>Date.now()+59_000);
    await f.worker();assert.equal(uuids.length,1);
    const path=join(dir,'db.sqlite');await f.db.backup(path);f.db.close();const restored=new Sqlite(path);
    try {
      restored.prepare('UPDATE feishu_notification_deliveries SET next_attempt_at=0 WHERE user_id=?').run(f.user.id);
      await new FeishuNotificationWorker(restored,f.user.id,f.key,f.io).runOnce(new AbortController().signal);
      assert.equal(new FeishuNotifications(restored,f.user.id).records.get(item.id)!.status,'delivered');assert.equal(uuids[0],uuids[1]);
    }finally{restored.close();}
  }finally{if(f.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});

it('expires stale attention notifications and abandoned in-flight claims without sending',async()=>{
  const f=fixture();try {
    f.enable();f.create('permission_prompt');f.db.prepare('UPDATE feishu_notification_deliveries SET expires_at=0').run();
    await f.worker();assert.equal(f.service.records.list()[0]!.error_code,'EXPIRED');
    f.create();const claimed=f.service.records.claim()!;f.db.prepare('UPDATE feishu_notification_deliveries SET lease_until=0 WHERE id=?').run(claimed.id);
    await f.worker();assert.equal(f.service.records.get(claimed.id)!.status,'unknown');assert.equal(f.calls.length,0);
  }finally{f.db.close();}
});

it('card contents are inert plain text and links use canonical same-origin paths only',async()=>{
  const f=fixture();try {
    for(const url of ['javascript:alert(1)','//evil.test','https://user:pass@example.com','https://example.com/?secret=1','https://example.com/\\evil'])
      assert.throws(()=>f.enable({webBaseUrl:url}));
    f.enable({webBaseUrl:'https://forge.example.com/base/'});
    new NotificationService(f.db,f.user.id).create({type:'app_action_notification',titleKey:'ignored',message:'**bold** <at user_id="all"></at>',href:'//evil.test',payload:{adapter:'<button>evil</button>'}});
    // app_action is opt-in.
    assert.equal(f.service.records.list().length,0);
    f.enable({types:['app_action']});
    new NotificationService(f.db,f.user.id).create({type:'app_action_notification',titleKey:'ignored',message:'**bold** <at user_id="all"></at>',href:'//evil.test'});
    await f.worker();const card=JSON.parse(f.calls.at(-1)!.body.content as string);
    assert.ok(card.body.elements.filter((e:{tag:string})=>e.tag==='div').every((e:{text:{tag:string}})=>e.text.tag==='plain_text'));
    assert.equal(card.body.elements.at(-1).behaviors[0].default_url,'https://forge.example.com/base/models');
    assert.equal(JSON.stringify(card).includes('evil.test'),false);
  }finally{f.db.close();}
});

it('production event and automation producers enter the same durable subscription queue',()=>{
  const f=fixture();try {
    f.enable({types:['app_action','automation']});const bus=new ForgeBadgerEventBus();attachNotificationPersistence({db:f.db,eventBus:bus});
    bus.emitEvent({type:'app_action_notification',userId:f.user.id,titleKey:'notifications.done',message:'applied',action:'apply_provider',status:'success'});
    deliverAutomationResult(f.db,f.user.id,{automationId:'automation-1',automationName:'Daily',content:'summary',notify:true});
    assert.deepEqual(f.service.records.list().map(row=>row.event_type).sort(),['app_action','automation']);
    assert.equal(f.notifications.list().length,2);
    f.db.exec("CREATE TRIGGER reject_notification_outbox BEFORE INSERT ON feishu_notification_deliveries BEGIN SELECT RAISE(ABORT,'fixture'); END");
    assert.throws(()=>new NotificationService(f.db,f.user.id).create({type:'app_action_notification',titleKey:'done',message:'rollback',href:'/models'}));
    assert.equal(f.notifications.list().length,2);
  }finally{f.db.close();}
});

function groupDirectory(f:ReturnType<typeof fixture>) {
  const original=f.io.fetch!;
  const remote={name:'开发通知群',joined:true,include:true};
  f.integration.upsertConfig({allowedChatIds:['group']});
  f.io.fetch=async(url,init)=>{
    const path=String(url);
    if(path.includes('/members/is_in_chat'))return Response.json({code:0,data:{is_in_chat:remote.joined}});
    if(path.includes('/im/v1/chats?'))return Response.json({code:0,data:{items:remote.include?
      [{chat_id:'group',name:remote.name},{chat_id:'unconfigured',name:'Other tenant-facing group'}]:[],has_more:false}});
    return original(url,init);
  };
  const refresh=()=>f.service.targets.refresh(f.key,f.io);
  const select=(id:string)=>f.service.update({...f.service.records.config(),enabled:true,targetId:id,identityId:null});
  return {remote,refresh,select};
}

it('offers only configured, provider-verified groups and sends independently of private identity or inbound grants',async()=>{
  const f=fixture();try {
    const g=groupDirectory(f);const targets=await g.refresh();
    assert.equal(targets.filter(t=>t.kind==='group').length,1);
    const group=targets.find(t=>t.kind==='group')!;
    assert.equal(group.name,'开发通知群');assert.equal(group.available,true);
    g.select(group.id);f.identities.revokeIdentity(f.identity.id);
    f.integration.upsertConfig({allowedChatIds:['unrelated-inbound-chat']});
    f.create();await f.worker();
    assert.equal(f.service.records.list()[0]?.status,'delivered');
    assert.equal(f.calls.at(-1)?.body.receive_id,'group');
    assert.deepEqual(f.integration.getConfig().allowedChatIds,['unrelated-inbound-chat']);
    assert.equal(f.identities.records.listRoutes().length,0);
    assert.throws(()=>new FeishuNotifications(f.db,f.other.id).update({...f.service.records.config(),revision:0}),/TARGET_INVALID/);
  }finally{f.db.close();}
});

it('renaming a group preserves queued work; leaving and rejoining never revives old target revisions',async()=>{
  const f=fixture();try {
    const g=groupDirectory(f),group=(await g.refresh()).find(t=>t.kind==='group')!;
    g.select(group.id);f.create();const item=f.service.records.list()[0]!;
    g.remote.name='新群名';await g.refresh();
    assert.equal(f.service.targets.authority(group.id).revision,group.revision);
    g.remote.include=false;await g.refresh();g.remote.include=true;await g.refresh();
    assert.ok(f.service.targets.authority(group.id).revision>group.revision);
    await f.worker();assert.equal(f.service.records.get(item.id)?.status,'cancelled');
    assert.equal(f.calls.filter(c=>c.url.includes('/messages')).length,0);
    f.create();await f.worker();assert.equal(f.service.records.list()[0]?.status,'delivered');
  }finally{f.db.close();}
});

it('checks membership before a group send and exposes a departed target as unavailable',async()=>{
  const f=fixture();try {
    const g=groupDirectory(f),group=(await g.refresh()).find(t=>t.kind==='group')!;
    g.select(group.id);f.create();g.remote.joined=false;await f.worker();
    assert.equal(f.service.records.list()[0]?.error_code,'TARGET_UNAVAILABLE');
    assert.equal(f.service.state().ready,false);
    assert.equal(f.calls.filter(c=>c.url.includes('/messages')).length,0);
  }finally{f.db.close();}
});

it('reports missing member-read scope without sending or pretending the test succeeded',async()=>{
  const f=fixture();try {
    const g=groupDirectory(f),group=(await g.refresh()).find(t=>t.kind==='group')!;
    g.select(group.id);f.service.test({requestId:randomUUID()});const original=f.io.fetch!;
    f.io.fetch=async(url,init)=>String(url).includes('/members/is_in_chat')?Response.json({code:99991672},{status:403}):original(url,init);
    await f.worker();
    assert.equal(f.service.records.list()[0]?.status,'failed');
    assert.equal(f.service.records.list()[0]?.error_code,'DIRECTORY_PERMISSION_REQUIRED');
    assert.equal(f.calls.filter(c=>c.url.includes('/messages')).length,0);
  }finally{f.db.close();}
});

it('reads all directory pages and never applies a partial or cyclic listing',async()=>{
  const f=fixture();try {
    const g=groupDirectory(f);let pages=0;
    f.io.fetch=async url=>{
      if(String(url).includes('/auth/'))return Response.json({code:0,tenant_access_token:'fixture'});
      pages++;
      return new URL(String(url)).searchParams.has('page_token')
        ?Response.json({code:0,data:{items:[{chat_id:'group',name:'Second page'}],has_more:false}})
        :Response.json({code:0,data:{items:[],has_more:true,page_token:'next'}});
    };
    const listed=await g.refresh();assert.equal(pages,2);
    assert.equal(listed.find(t=>t.kind==='group')?.name,'Second page');
    f.io.fetch=async url=>String(url).includes('/auth/')?Response.json({code:0,tenant_access_token:'fixture'})
      :Response.json({code:0,data:{items:[],has_more:true,page_token:'loop'}});
    await assert.rejects(g.refresh(),/DIRECTORY_INCOMPLETE/);
    assert.deepEqual(f.service.targets.list(),listed);
  }finally{f.db.close();}
});

it('rejects stale directory refresh after account rotation and keeps cached groups on permission failure',async()=>{
  const f=fixture();try {
    const g=groupDirectory(f),groups=await g.refresh();
    f.io.fetch=async()=>Response.json({code:99991672},{status:403});
    await assert.rejects(g.refresh(),/DIRECTORY_PERMISSION_REQUIRED/);
    assert.deepEqual(f.service.targets.list(),groups);
    const h=groupDirectory(f),original=f.io.fetch!;
    // Restore a normal token response, rotate while the verified group list is in flight.
    f.io.fetch=async(url,init)=>{
      if(String(url).includes('/auth/'))return Response.json({code:0,tenant_access_token:'fixture'});
      const response=await original(url,init);
      f.accounts.upsertAccount({appId:'rotated',appSecret:randomBytes(24).toString('hex'),enabled:true});
      return response;
    };
    await assert.rejects(h.refresh(),/ACCOUNT_CHANGED/);
    assert.equal(f.service.targets.list().length,0);
  }finally{f.db.close();}
});

it('fences a group send when the subscription changes during the membership request',async()=>{
  const f=fixture();try {
    const g=groupDirectory(f),group=(await g.refresh()).find(t=>t.kind==='group')!;
    g.select(group.id);f.create();const original=f.io.fetch!;
    f.io.fetch=async(url,init)=>{
      const result=await original(url,init);
      if(String(url).includes('/members/is_in_chat'))f.enable();
      return result;
    };
    await f.worker();assert.equal(f.service.records.list()[0]?.status,'cancelled');
    assert.equal(f.calls.filter(c=>c.url.includes('/messages')).length,0);
  }finally{f.db.close();}
});

it('accepts legacy private subscriptions and rejects conflicting or arbitrary target fields',()=>{
  const f=fixture();try {
    const {targetId:_legacyOmitted,...legacy}=f.service.records.config();
    f.service.update({...legacy,enabled:true,identityId:f.identity.id});
    assert.equal(f.service.records.config().targetId,`private:${f.identity.id}`);
    assert.throws(()=>f.service.update({...f.service.records.config(),targetId:'group:untrusted'}),/TARGET_CONFLICT/);
    assert.throws(()=>f.service.update({...f.service.records.config(),chatId:'arbitrary'}));
  }finally{f.db.close();}
});

it('migrates existing private settings without redirecting or reviving queued messages',()=>{
  const db=new Sqlite(':memory:');try {
    db.exec('CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES(\'owner\')');
    db.exec(readFileSync(new URL('../src/db/migrations/0119_feishu_notifications.sql',import.meta.url),'utf8'));
    db.exec("INSERT INTO feishu_notification_settings(user_id,enabled,identity_id,revision,updated_at) VALUES('owner',1,'identity',4,0)");
    for(const status of ['pending','sending','delivered'])db.prepare(`INSERT INTO feishu_notification_deliveries
      (id,user_id,notification_id,event_type,subscription_revision,identity_revision,status,expires_at,created_at)
      VALUES(?,'owner',?,'completion',4,1,?,100,0)`).run(status,status,status);
    db.exec(readFileSync(new URL('../src/db/migrations/0120_feishu_notification_targets.sql',import.meta.url),'utf8'));
    const service=new FeishuNotifications(db,'owner');
    assert.equal(service.records.config().targetId,'private:identity');assert.equal(service.records.config().revision,4);
    assert.equal(service.records.get('pending')?.status,'cancelled');assert.equal(service.records.get('sending')?.status,'sending');
    assert.equal(service.records.get('delivered')?.status,'delivered');
    assert.equal((db.prepare('SELECT count(*) n FROM feishu_notification_groups').get() as {n:number}).n,0);
  }finally{db.close();}
});
