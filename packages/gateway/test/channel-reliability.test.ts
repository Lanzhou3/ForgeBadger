import assert from 'node:assert/strict';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { UserRepository } from '../src/db/repositories/user-repository.js';
import { FeishuChannelRepository } from '../src/db/repositories/feishu-channel-repository.js';
import { FeishuIntegrationRepository } from '../src/db/repositories/feishu-integration-repository.js';
import { TelegramChannelRepository } from '../src/db/repositories/telegram-channel-repository.js';
import { TelegramIntegrationRepository } from '../src/db/repositories/telegram-integration-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ChannelIdentityService, type TrustedChannelPeer } from '../src/services/channels/channel-identity-service.js';
import { NativeChannelInbox, createFeishuNativeIngress, createTelegramNativeIngress } from '../src/services/channels/native-channel-inbox.js';
import { decryptSecret, type EncryptedSecret } from '../src/crypto/secret-box.js';

const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

it('route status projects current authority without mutating data or leaking another tenant', () => {
  const f = fixture();
  try {
    const { route } = bound(f);
    const before = f.db.prepare('SELECT total_changes() n').get();
    assert.equal(f.service.listRouteStatuses()[0]?.authorityValid, true);
    assert.deepEqual(new ChannelIdentityService(f.db, f.other.id).listRouteStatuses(), []);
    assert.deepEqual(f.db.prepare('SELECT total_changes() n').get(), before);
    assert.equal(new CopilotConversationLog(f.db, f.user.id).deleteConversation(route.conversationId), true);
    assert.equal(f.service.listRouteStatuses()[0]?.authorityValid, false);
    f.db.close();
    assert.throws(() => f.service.listRouteStatuses());
  } finally { if (f.db.open) f.db.close(); }
});

function fixture(folder = migrationsFolder) {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder: folder });
  const user = new UserRepository(db).create('telegram-channel@test.dev', 'fixture');
  const other = new UserRepository(db).create('other@test.dev', 'fixture');
  const key = randomBytes(32).toString('hex');

  const feishuAccounts = new FeishuChannelRepository(db, user.id, key);
  const feishuAccount = feishuAccounts.upsertAccount({ appId: 'fixture', appSecret: randomBytes(24).toString('hex'), enabled: true });
  const feishuConfig = new FeishuIntegrationRepository(db, user.id);
  feishuConfig.upsertConfig({ enabled: true, emergencyDisabled: false });

  const telegramAccounts = new TelegramChannelRepository(db, user.id, key);
  const telegramAccount = telegramAccounts.upsertAccount({ botToken: 'tg-token', botUsername: 'fb_bot', enabled: true });
  const telegramConfig = new TelegramIntegrationRepository(db, user.id);
  telegramConfig.upsertConfig({ enabled: true, emergencyDisabled: false });

  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: 'p', path: '/private/tmp/tg-channel-project', aiTool: 'claude' });
  // Channel admission requires the project-level Copilot autonomy switch; the
  // flow tests run with it enabled and the dedicated switch tests toggle it.
  projects.setCopilotAutonomy(project.id, true);
  const service = new ChannelIdentityService(db, user.id, key);
  const pair = (channel: 'feishu' | 'telegram', accountId: string, accountRevision: number, externalUserId: string, chatId: string) => {
    const peer: TrustedChannelPeer = { channel, accountId, accountRevision, externalUserId, chatId, chatType: 'p2p' };
    const issued = service.createPairing({ channel, accountId });
    const claimed = service.claimPairing(issued.token, peer);
    const identity = service.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId, chatId });
    return { peer, identity };
  };
  return { db, user, other, key, feishuAccounts, feishuAccount, feishuConfig, telegramAccounts, telegramAccount, telegramConfig, projects, project, service, pair };
}

import { createTelegramPollingClient } from '../src/services/integrations/telegram-polling-client.ts';
import { normalizeTelegramUpdate } from '../src/services/integrations/telegram-event-normalizer.ts';
const bot = { id: 999, username: 'fb_bot', firstName: 'Fixture' };
const update = (updateId: number, messageId: number, chatId: number, threadId?: number) => ({ update_id: updateId, message: { message_id: messageId, text: '@fb_bot check', from: { id: 123, is_bot: false }, chat: { id: chatId, type: chatId === 123 ? 'private' : 'supergroup' }, ...(threadId ? { message_thread_id: threadId } : {}) } });
it('different Telegram chats may use the same message_id without losing either message', () => {
 const f=fixture();try{
  const {peer,identity}=f.pair('telegram',f.telegramAccount.id,f.telegramAccount.configRevision,'123','123');
  f.service.createRoute({identityId:identity.id,projectId:f.project.id});
  f.telegramConfig.upsertConfig({allowedChatIds:['123','-1001']});
  const ingress=createTelegramNativeIngress({db:f.db,userId:f.user.id,masterKey:f.key,accountId:f.telegramAccount.id,accountRevision:f.telegramAccount.configRevision});
  assert.equal(ingress(normalizeTelegramUpdate(update(100,1,123),bot)).status,'admitted');
  assert.equal(ingress(normalizeTelegramUpdate(update(101,1,-1001),bot)).status,'admitted');
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM channel_messages').get() as { n: number }).n,2);
 }finally{f.db.close();}
});
it('private and group messages should not implicitly reuse private conversation history', () => {
 const f=fixture();try{
  const {peer,identity}=f.pair('telegram',f.telegramAccount.id,f.telegramAccount.configRevision,'123','123');
  f.service.createRoute({identityId:identity.id,projectId:f.project.id});
  f.telegramConfig.upsertConfig({allowedChatIds:['123','-1001']});
  const group={...peer,chatId:'-1001',chatType:'group' as const,mentionedBot:true as const};
  const dm=f.service.records.peerRoute(peer)!;
  const groupRoute=f.service.records.peerRoute(group)!;
  const admitted = f.service.admit(groupRoute.id,group);
  assert.notEqual(dm.conversationId,admitted.conversationId,'Group replies currently see the same conversation as the private chat');
 }finally{f.db.close();}
});
it('polling must not confirm an update whose durable inbox handler failed', async () => {
 const offsets: unknown[]=[];let calls=0;let handled=0;
 const client=createTelegramPollingClient({token:'fixture',callbacks:{},validate:async()=>{},
  fetch:async(input,init)=>{
   if(String(input).endsWith('/getMe'))return Response.json({ok:true,result:{id:999,is_bot:true,first_name:'Fixture',username:'fb_bot'}});
   const body=JSON.parse(String(init?.body));offsets.push(body.offset);calls++;
   if(calls===1)return Response.json({ok:true,result:[update(100,1,123)]});
   client.close();return Response.json({ok:true,result:[]});
  },handlers:{onMessage:()=>{handled++;throw new Error('SQLITE_BUSY');}}
 });
 await assert.rejects(client.start(), /SQLITE_BUSY/);assert.equal(handled,1);
 assert.notEqual(offsets[1],101,'offset 101 confirms update 100 despite failed durable admission');
});
it('Telegram normalization must preserve a forum topic for scoped routing and replies', () => {
 const event=normalizeTelegramUpdate(update(101,5,-1001,42),bot);
 assert.ok(event);
 assert.equal((event as unknown as {threadId?:string}).threadId,'42');
});
for(const channel of ['feishu','telegram'] as const)it(`unchanged ${channel} account save should preserve the paired identity revision`,()=>{
 const f=fixture();try{
  const account=channel==='feishu'?f.feishuAccount:f.telegramAccount;
  const {identity}=f.pair(channel,account.id,account.configRevision,'123','123');
  const saved=channel==='feishu'?f.feishuAccounts.upsertAccount({appId:'fixture',enabled:true}):f.telegramAccounts.upsertAccount({enabled:true});
  assert.equal(saved.configRevision,identity.accountRevision,'No credential or enablement change occurred');
 }finally{f.db.close();}
});

import { TelegramCursorRepository } from '../src/db/repositories/telegram-cursor-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { assertChannelConversationAuthority, recoverLegacyChannelRuns } from '../src/services/channels/channel-run-authority.js';
import { NativeChannelDelivery } from '../src/services/channels/native-channel-delivery.js';
import { createTelegramNativeSender } from '../src/services/integrations/telegram-native-sender.js';
import { createFeishuNativeSender } from '../src/services/integrations/feishu-native-sender.js';
import { runChannelDiagnostics } from '../src/services/channels/channel-diagnostics.js';

function bound(f: ReturnType<typeof fixture>) {
 const {peer,identity}=f.pair('telegram',f.telegramAccount.id,f.telegramAccount.configRevision,'123','123');
 const route=f.service.createRoute({identityId:identity.id,projectId:f.project.id});
 f.telegramConfig.upsertConfig({allowedChatIds:['123','-1001','-1002']});
 return {peer,identity,route,inbox:new NativeChannelInbox(f.db,f.user.id,f.key)};
}

it('isolates two groups and two topics, reuses a scope and fences all descendants on revoke',()=>{
 const f=fixture();try{
  const {peer,route,inbox}=bound(f);
  const scopes:TrustedChannelPeer[]=[peer,{...peer,chatType:'group',mentionedBot:true,chatId:'-1001'},{...peer,chatType:'group',mentionedBot:true,chatId:'-1002'},{...peer,chatType:'group',mentionedBot:true,chatId:'-1001',threadId:'42'},{...peer,chatType:'group',mentionedBot:true,chatId:'-1001',threadId:'43'}];
  const ids=scopes.map(scope=>f.service.admit(route.id,scope).conversationId);
  assert.equal(new Set(ids).size,5);
  assert.equal(f.service.admit(route.id,scopes[3]!).conversationId,ids[3]);
  for(const id of ids) assertChannelConversationAuthority(f.db,f.user.id,id);
  const message=inbox.receive(scopes[3]!,{eventId:'topic-message',messageId:'1',text:'topic only'});
  assert.throws(()=>inbox.result(message.id,scopes[4]!),/CHANNEL_AUTHORITY_REJECTED/);
  f.telegramConfig.upsertConfig({allowedChatIds:['123','-1002']});
  assert.throws(()=>assertChannelConversationAuthority(f.db,f.user.id,ids[1]!),/CHANNEL_AUTHORITY_REJECTED/);
  f.service.revokeRoute(route.id);
  for(const id of ids) assert.throws(()=>assertChannelConversationAuthority(f.db,f.user.id,id),/CHANNEL_AUTHORITY_REJECTED/);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.db.close();}
});

it('a private backlog awaiting approval does not block another group on the same authorization route',()=>{
 const f=fixture();try{
  const {peer,inbox}=bound(f);
  inbox.receive(peer,{eventId:'1',messageId:'1',text:'private first'});
  const run=inbox.adoptNext();assert.equal(run.status,'adopted');
  if(run.status!=='adopted')throw new Error('adoption failed');
  f.db.prepare("UPDATE copilot_runs SET status='awaiting_approval' WHERE id=?").run(run.runId);
  inbox.receive(peer,{eventId:'2',messageId:'2',text:'private second'});
  const group=inbox.receive({...peer,chatType:'group',mentionedBot:true,chatId:'-1001'},{eventId:'3',messageId:'2',text:'group'});
  const next=inbox.adoptNext();assert.equal(next.status,'adopted');
  if(next.status==='adopted')assert.equal(next.messageId,group.id);
 }finally{f.db.close();}
});

it('legacy chat-less rows deduplicate their own chat and reject event aliases reused across chats',()=>{
 const f=fixture();try{
  const {peer,inbox}=bound(f);
  const first=inbox.receive(peer,{eventId:'original',messageId:'1',text:'hello'});
  f.db.prepare('UPDATE channel_messages SET chat_id=NULL WHERE id=?').run(first.id);
  assert.equal(inbox.receive(peer,{eventId:'alias',messageId:'1',text:'hello'}).duplicate,true);
  const group:TrustedChannelPeer={...peer,chatType:'group',mentionedBot:true,chatId:'-1001'};
  assert.throws(()=>inbox.receive(group,{eventId:'alias',messageId:'1',text:'hello'}),/CHANNEL_REPLAY_CONFLICT/);
  const second=inbox.receive(group,{eventId:'group-event',messageId:'1',text:'hello'});
  assert.notEqual(first.id,second.id);
  f.db.prepare('UPDATE channel_messages SET chat_id=NULL WHERE id=?').run(second.id);
  assert.equal(inbox.receive(group,{eventId:'group-redelivery',messageId:'1',text:'hello'}).duplicate,true);
 }finally{f.db.close();}
});

it('fences legacy active runs before recovery while retaining transcripts and current runs',()=>{
 const f=fixture();try{
  const {peer,inbox}=bound(f);
  const message=inbox.receive(peer,{eventId:'old',messageId:'1',text:'preserve history'});
  const run=inbox.adoptNext();if(run.status!=='adopted')throw new Error('adoption failed');
  const ledger=new CopilotRunLedger(f.db,f.user.id);const claim=ledger.claim(run.runId,'old-worker',30_000)!;
  f.db.prepare('UPDATE channel_messages SET chat_id=NULL WHERE id=?').run(message.id);
  recoverLegacyChannelRuns(f.db,f.user.id);
  assert.equal(ledger.get(run.runId)?.status,'cancelled');
  assert.equal(ledger.get(run.runId)?.stop_reason,'channel_scope_migration');
  assert.equal(ledger.finish(claim,'completed'),false);
  assert.ok(ledger.log.listRunMessages(run.runId).length);
  recoverLegacyChannelRuns(f.db,f.user.id);
 }finally{f.db.close();}
});

it('persists only the successful prefix of a polling batch and resumes without duplicate inbox rows',async()=>{
 const f=fixture();try{
  bound(f);const cursor=new TelegramCursorRepository(f.db,f.user.id,f.telegramAccount.id,1);
  const receive=createTelegramNativeIngress({db:f.db,userId:f.user.id,masterKey:f.key,accountId:f.telegramAccount.id,accountRevision:1});
  const offsets:(number|undefined)[]=[];let fail=true;
  const run=async()=>{
   const client=createTelegramPollingClient({token:'fixture',callbacks:{},cursor,validate:async()=>{},fetch:async(input,init)=>{
    if(String(input).endsWith('/getMe'))return Response.json({ok:true,result:{id:999,is_bot:true,first_name:'Fixture',username:'fb_bot'}});
    const offset=JSON.parse(String(init?.body)).offset as number|undefined;offsets.push(offset);
    const batch=[update(10,1,123),update(11,2,123),update(12,3,123)].filter(u=>u.update_id>=(offset??0));
    if(!batch.length)client.close();return Response.json({ok:true,result:batch});
   },handlers:{onMessage:event=>{if(fail && event.eventId==='tg:11')throw new Error('SQLITE_BUSY');return receive(event);}}});
   return client.start();
  };
  await assert.rejects(run(),/SQLITE_BUSY/);assert.equal(cursor.load(),11);assert.deepEqual(offsets,[undefined]);
  fail=false;await run();assert.equal(cursor.load(),13);assert.deepEqual(offsets,[undefined,11,13]);
  assert.equal((f.db.prepare('SELECT count(*) n FROM channel_messages').get() as {n:number}).n,3);
  assert.equal(new TelegramCursorRepository(f.db,f.other.id,f.telegramAccount.id,1).load(),undefined);
  f.telegramAccounts.upsertAccount({botToken:'rotated',enabled:true});
  assert.throws(()=>cursor.save(14),/STALE/);assert.equal(new TelegramCursorRepository(f.db,f.user.id,f.telegramAccount.id,2).load(),undefined);
 }finally{f.db.close();}
});

it('cursor persistence failure never confirms an already stored update; replay is idempotent',async()=>{
 const f=fixture();try{
  bound(f);const cursor=new TelegramCursorRepository(f.db,f.user.id,f.telegramAccount.id,1);
  const receive=createTelegramNativeIngress({db:f.db,userId:f.user.id,masterKey:f.key,accountId:f.telegramAccount.id,accountRevision:1});
  f.db.exec("CREATE TRIGGER fail_cursor BEFORE INSERT ON telegram_polling_cursors BEGIN SELECT RAISE(ABORT,'cursor disk failure'); END");
  let calls=0;
  const client=createTelegramPollingClient({token:'fixture',callbacks:{},cursor,validate:async()=>{},fetch:async(input)=>{
   if(String(input).endsWith('/getMe'))return Response.json({ok:true,result:{id:999,is_bot:true,first_name:'Fixture',username:'fb_bot'}});
   calls++;return Response.json({ok:true,result:[update(10,1,123)]});
  },handlers:{onMessage:receive}});
  await assert.rejects(client.start(),/cursor disk failure/);assert.equal(calls,1);assert.equal(cursor.load(),undefined);
  f.db.exec('DROP TRIGGER fail_cursor');
  assert.equal(receive(normalizeTelegramUpdate(update(10,1,123),bot)).status,'admitted');
  assert.equal((f.db.prepare('SELECT count(*) n FROM channel_messages').get() as {n:number}).n,1);
 }finally{f.db.close();}
});

it('honors a polling retry_after longer than 30 seconds and close interrupts the wait',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let polls=0;
 const client=createTelegramPollingClient({token:'fixture',callbacks:{},validate:async()=>{},fetch:async(input)=>{
  if(String(input).endsWith('/getMe'))return Response.json({ok:true,result:{id:999,is_bot:true,first_name:'Fixture',username:'fb_bot'}});
  polls++;return Response.json({ok:false,error_code:429,description:'rate limit',parameters:{retry_after:60}},{status:429});
 },handlers:{onMessage:()=>{}}});
 const running=client.start();await new Promise(setImmediate);
 assert.equal(polls,1);t.mock.timers.tick(59999);await new Promise(setImmediate);assert.equal(polls,1);
 client.close();await running;assert.equal(polls,1);
});

function completed(f: ReturnType<typeof fixture>, text: string) {
 const {peer,inbox}=bound(f);inbox.receive(peer,{eventId:'complete',messageId:'1',text:'request'});
 const run=inbox.adoptNext();if(run.status!=='adopted')throw new Error('adoption failed');
 const ledger=new CopilotRunLedger(f.db,f.user.id);ledger.append(run.runId,{role:'assistant',kind:'text',content:text});
 ledger.finish(ledger.claim(run.runId,'owner',30_000)!,'completed');
 return peer;
}

it('Telegram retains its existing 12 KB encoded reply bound',async()=>{
 const f=fixture();try{
  completed(f,'汉字"\\\n'.repeat(20_000));let text='';
  await new NativeChannelDelivery(f.db,f.user.id,f.key,async input=>{text=input.text;return {status:'delivered',messageId:'1'};})
    .runOnce(new AbortController().signal);
  assert.ok(Buffer.byteLength(JSON.stringify({text}),'utf8')<=12_000);
  assert.match(text,/内容已截断/);
 }finally{f.db.close();}
});

it('resumes only the unsent chunk after a durable 429 retry, preserving receipts and not retrying early',async()=>{
 const f=fixture();try{
  completed(f,'a'.repeat(4096)+'b'.repeat(10));const sent:string[]=[];let throttle=true;
  const send=createTelegramNativeSender(f.db,f.user.id,f.key,{validate:async()=>{},fetch:async(_url,init)=>{
   const text=JSON.parse(String(init?.body)).text as string;sent.push(text);
   if(text.startsWith('b')&&throttle){throttle=false;return Response.json({ok:false,error_code:429,description:'wait',parameters:{retry_after:60}},{status:429});}
   return Response.json({ok:true,result:{message_id:sent.length}});
  }});
  await new NativeChannelDelivery(f.db,f.user.id,f.key,send).runOnce(new AbortController().signal);
  const record=f.db.prepare('SELECT * FROM channel_deliveries').get() as {status:string;next_part:number;next_attempt_at:number;provider_message_id:string};
  assert.equal(record.status,'pending');assert.equal(record.next_part,1);assert.equal(record.provider_message_id,'1');assert.ok(record.next_attempt_at>Date.now()+59000);
  const restarted=new NativeChannelDelivery(f.db,f.user.id,f.key,send);
  await restarted.runOnce(new AbortController().signal);assert.equal(sent.length,2);
  f.db.prepare('UPDATE channel_deliveries SET next_attempt_at=0').run();
  await restarted.runOnce(new AbortController().signal);
  assert.deepEqual(sent,['a'.repeat(4096),'b'.repeat(10),'b'.repeat(10)]);
  assert.equal(restarted.records.listMetadata()[0]?.status,'delivered');
  assert.equal(restarted.records.listMetadata()[0]?.channel,'telegram');
 }finally{f.db.close();}
});

it('a send accepted before checkpoint failure is unknown and is never automatically replayed',async()=>{
 const f=fixture();try{
  completed(f,'reply');let sends=0;
  f.db.exec("CREATE TRIGGER fail_checkpoint BEFORE UPDATE OF next_part ON channel_deliveries BEGIN SELECT RAISE(ABORT,'disk failure'); END");
  const send=createTelegramNativeSender(f.db,f.user.id,f.key,{validate:async()=>{},fetch:async()=>{sends++;return Response.json({ok:true,result:{message_id:1}});}});
  const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,send);
  await worker.runOnce(new AbortController().signal);assert.equal(worker.records.listMetadata()[0]?.status,'unknown');
  f.db.exec('DROP TRIGGER fail_checkpoint');await worker.runOnce(new AbortController().signal);assert.equal(sends,1);
 }finally{f.db.close();}
});

it('rechecks Telegram authorization after asynchronous endpoint validation and preserves topics',async()=>{
 const f=fixture();try{
  const {peer}=bound(f);let allowed=true;let sends=0;
  const send=createTelegramNativeSender(f.db,f.user.id,f.key,{validate:async()=>{allowed=false;},fetch:async()=>{sends++;return Response.json({ok:true,result:{message_id:1}});}});
  await send({peer,text:'hi',deliveryId:'d',signal:new AbortController().signal,authorize:()=>{if(!allowed)throw new Error('revoked');}});
  assert.equal(sends,0);
  let body:Record<string,unknown>={};
  const scoped=createTelegramNativeSender(f.db,f.user.id,f.key,{validate:async()=>{},fetch:async(_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({ok:true,result:{message_id:1}});}});
  await scoped({peer:{...peer,threadId:'42'},text:'hi',deliveryId:'d',signal:new AbortController().signal,authorize:()=>{}});
  assert.equal(body.message_thread_id,42);
 }finally{f.db.close();}
});

it('Feishu thread replies use the reply endpoint; an ordinary quoted reply remains in the main chat',async()=>{
 const f=fixture();try{
  const requests:{url:string;body:Record<string,unknown>}[]=[];
  const send=createFeishuNativeSender(f.db,f.user.id,f.key,{validate:async()=>{},fetch:async(url,init)=>{
   requests.push({url:String(url),body:JSON.parse(String(init?.body))});
   return String(url).includes('tenant_access_token')?Response.json({code:0,tenant_access_token:'test-token'}):Response.json({code:0,data:{message_id:'om-done'}});
  }});
  const base={channel:'feishu' as const,accountId:f.feishuAccount.id,accountRevision:1,chatType:'p2p' as const,chatId:'dm',externalUserId:'owner',replyToMessageId:'om-source'};
  await send({peer:{...base,threadId:'omt-topic'},text:'reply',deliveryId:'d',signal:new AbortController().signal,authorize:()=>{}});
  assert.ok(requests[1]!.url.endsWith('/messages/om-source/reply'));assert.equal(requests[1]!.body.reply_in_thread,true);
  await send({peer:base,text:'main',deliveryId:'d2',signal:new AbortController().signal,authorize:()=>{}});
  assert.ok(requests[3]!.url.includes('receive_id_type=chat_id'));assert.equal(requests[3]!.body.receive_id,'dm');
 }finally{f.db.close();}
});

it('delivery diagnostics distinguish untested, pending, cancelled and delivered',async()=>{
 const f=fixture();try{
  completed(f,'result');const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,async()=>({status:'delivered'}));
  const diagnostic=()=>runChannelDiagnostics(f.db,f.user.id,f.key,'telegram').checks.find(c=>c.key==='delivery')!;
  assert.equal(diagnostic().status,'untested');assert.equal(diagnostic().ok,false);
  worker.project();assert.equal(diagnostic().status,'pending');
  f.db.prepare("UPDATE channel_deliveries SET status='cancelled'").run();assert.equal(diagnostic().status,'failed');
  f.db.prepare("UPDATE channel_deliveries SET status='delivered'").run();assert.equal(diagnostic().status,'passed');
 }finally{f.db.close();}
});

import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { encryptSecret } from '../src/crypto/secret-box.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';

it('upgrades a real pre-0114 database, preserves history, deduplicates old group messages and reopens scoped sessions/cursors',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'fb-channel-upgrade-'));
 const previous=join(directory,'previous');mkdirSync(join(previous,'meta'),{recursive:true});
 const journal=JSON.parse(readFileSync(join(migrationsFolder,'meta/_journal.json'),'utf8')) as {entries:{tag:string}[]};
 journal.entries=journal.entries.filter(entry=>Number.parseInt(entry.tag,10)<114);
 for(const entry of journal.entries)cpSync(join(migrationsFolder,entry.tag+'.sql'),join(previous,entry.tag+'.sql'));
 writeFileSync(join(previous,'meta/_journal.json'),JSON.stringify(journal));
 const f=fixture(previous);
 try{
  const {peer,identity}=f.pair('telegram',f.telegramAccount.id,1,'123','123');
  const conversation=new CopilotConversationLog(f.db,f.user.id).createConversation('existing private history');
  f.db.prepare('UPDATE copilot_conversations SET channel_owned=1 WHERE id=?').run(conversation.id);
  f.db.prepare('INSERT INTO channel_routes(id,user_id,identity_id,project_id,conversation_id,created_at) VALUES (?,?,?,?,?,?)').run('old-route',f.user.id,identity.id,f.project.id,conversation.id,Date.now());
  const group:TrustedChannelPeer={...peer,chatType:'group',mentionedBot:true,chatId:'-1001'};
  f.telegramConfig.upsertConfig({allowedChatIds:['123','-1001']});
  const digest=createHash('sha256').update(JSON.stringify(['old-route',group.channel,group.accountId,group.accountRevision,group.externalUserId,group.chatId,group.chatType,'old group input'])).digest('hex');
  const payload=JSON.stringify(encryptSecret(JSON.stringify({peer:group,text:'old group input'}),{key:f.key}));
  f.db.prepare('INSERT INTO channel_messages(id,user_id,route_id,account_id,event_id,message_id,payload_encrypted,payload_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('old-message',f.user.id,'old-route',f.telegramAccount.id,'tg:1','1',payload,digest,Date.now());
  await f.db.backup(join(directory,'before.db'));
  migrate(drizzle(f.db),{migrationsFolder});
  const inbox=new NativeChannelInbox(f.db,f.user.id,f.key);
  assert.equal(inbox.receive(group,{eventId:'tg:2',messageId:'1',text:'old group input'}).duplicate,true);
  const run=inbox.adoptNext();assert.equal(run.status,'adopted');
  if(run.status==='adopted')assert.notEqual(new CopilotRunLedger(f.db,f.user.id).get(run.runId)?.conversation_id,conversation.id);
  assert.equal(f.service.admit('old-route',peer).conversationId,conversation.id);
  const groupConversation=f.service.admit('old-route',group).conversationId;
  new TelegramCursorRepository(f.db,f.user.id,f.telegramAccount.id,1).save(3);
  const count=(f.db.prepare('SELECT count(*) n FROM __drizzle_migrations').get() as {n:number}).n;
  migrate(drizzle(f.db),{migrationsFolder});assert.equal((f.db.prepare('SELECT count(*) n FROM __drizzle_migrations').get() as {n:number}).n,count);
  await f.db.backup(join(directory,'after.db'));
  const reopened=new Sqlite(join(directory,'after.db'));
  try{
   assert.equal(new ChannelIdentityService(reopened,f.user.id).admit('old-route',group).conversationId,groupConversation);
   assert.equal(new TelegramCursorRepository(reopened,f.user.id,f.telegramAccount.id,1).load(),3);
   assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(),[]);
   assert.equal((reopened.prepare('PRAGMA integrity_check').get() as {integrity_check:string}).integrity_check,'ok');
  }finally{reopened.close();}
  const backup=new Sqlite(join(directory,'before.db'),{readonly:true});
  try{assert.equal((backup.prepare('SELECT payload_encrypted FROM channel_messages WHERE id=?').get('old-message') as {payload_encrypted:string}).payload_encrypted,payload);}
  finally{backup.close();}
 }finally{f.db.close();rmSync(directory,{recursive:true,force:true});}
});

for(const channel of ['feishu','telegram'] as const)it(`identical explicit ${channel} credentials preserve connection health and pending pairing`,()=>{
 const f=fixture();try{
  const account=channel==='feishu'?f.feishuAccount:f.telegramAccount;
  const repository=channel==='feishu'?f.feishuAccounts:f.telegramAccounts;
  repository.updateAccountHealth(account.id,{state:'connected',lastConnectedAt:new Date(1000)});
  const pairing=f.service.createPairing({channel,accountId:account.id});
  const saved=channel==='feishu'?f.feishuAccounts.upsertAccount({...f.feishuAccounts.decryptAccountCredentials(account.id),enabled:true}):f.telegramAccounts.upsertAccount({...f.telegramAccounts.decryptAccountCredentials(account.id),enabled:true});
  assert.equal(saved.configRevision,1);assert.equal(saved.connectionState,'connected');assert.equal((f.db.prepare(`SELECT last_connected_at FROM ${channel==='feishu'?'feishu_channel_accounts':'telegram_channel_accounts'} WHERE id=?`).get(account.id) as {last_connected_at:number}).last_connected_at,1000);
  assert.equal(f.service.claimPairing(pairing.token,{channel,accountId:account.id,accountRevision:1,externalUserId:'123',chatId:'123',chatType:'p2p'}).status,'claimed');
 }finally{f.db.close();}
});

it('retry exhaustion becomes failed and retains partial delivery receipts',async()=>{
 const f=fixture();try{
  completed(f,'a'.repeat(4096)+'b');let sends=0;
  const sender=createTelegramNativeSender(f.db,f.user.id,f.key,{validate:async()=>{},fetch:async()=>{
   sends++;if(sends===1)return Response.json({ok:true,result:{message_id:101}});
   return Response.json({ok:false,error_code:429,description:'wait',parameters:{retry_after:1}},{status:429});
  }});
  const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,sender);
  for(let i=0;i<7;i++){f.db.prepare('UPDATE channel_deliveries SET next_attempt_at=0').run();await worker.runOnce(new AbortController().signal);}
  const row=f.db.prepare('SELECT status,provider_message_id,attempt_count FROM channel_deliveries').get() as {status:string;provider_message_id:string;attempt_count:number};
  assert.deepEqual(row,{status:'failed',provider_message_id:'101',attempt_count:5});assert.equal(sends,6);
 }finally{f.db.close();}
});

import { createNativeTelegramRuntime } from '../src/services/channels/native-telegram-runtime.js';
import { PlatformActionRepository } from '../src/db/repositories/platform-action-repository.js';
import { DevelopmentTaskRepository } from '../src/db/repositories/development-task-repository.js';
import { assertDevelopmentAuthority } from '../src/services/development/authority.js';

it('deleting a route parent revokes a child development effect fence while cancellation remains available', () => {
  const f = fixture();
  try {
    const { peer, route, inbox } = bound(f);
    inbox.receive({ ...peer, chatId: '-1001', chatType: 'group', mentionedBot: true }, { eventId: 'dev', messageId: 'dev', text: 'change' });
    const adopted = inbox.adoptNext();
    if (adopted.status !== 'adopted') return assert.fail('admission required');
    const ledger = new CopilotRunLedger(f.db, f.user.id);
    assert.ok(ledger.claim(adopted.runId, 'owner', 30000));
    const digest = 'a'.repeat(64);
    const plan = { projectId: f.project.id, goal: 'change', sourceFiles: ['file.ts'],
      changes: [{ path: 'file.ts', beforeSha256: digest, content: 'updated' }], checks: [{ path: 'check.mjs', sha256: digest }] };
    const step = ledger.addStep(adopted.runId, { kind: 'tool', toolName: 'submit_development_task', toolCallId: 'dev', inputJson: JSON.stringify(plan), effect: 'write' });
    const actions = new PlatformActionRepository(f.db, f.user.id);
    const intent = actions.create({ actor_user_id: f.user.id, authority: 'owner_action', command_id: 'development.task.submit',
      input_json: JSON.stringify(plan), digest, resources_json: '{}', policy_version: 1, expires_at: Date.now() + 60000,
      idempotency_key: step.id, status: 'executing' }, { kind: 'copilot', runId: adopted.runId, stepId: step.id });
    const tasks = new DevelopmentTaskRepository(f.db, f.user.id);
    const task = tasks.create({ project_id: f.project.id, goal: plan.goal, plan_json: JSON.stringify(plan), recipe_digest: digest,
      source_digest: digest, output_digest: digest, intent_id: intent.id, origin_run_id: adopted.runId, origin_step_id: step.id, project_root: f.project.path });
    actions.finish(intent.id, 'confirmed', { taskId: task.id, recipeDigest: digest });
    assert.doesNotThrow(() => assertDevelopmentAuthority(f.db, task, false));
    assert.equal(ledger.log.deleteConversation(route.conversationId), true);
    assert.throws(() => assertDevelopmentAuthority(f.db, task, false), /CHANNEL_AUTHORITY_REJECTED/);
    assert.equal(tasks.cancel(task.id, f.project.id).status, 'cancelled');
  } finally { f.db.close(); }
});
import { TelegramConnectionSupervisor, type TelegramSupervisorAccount } from '../src/services/integrations/telegram-connection-supervisor.js';
import type { TelegramPollingCallbacks } from '../src/services/integrations/telegram-polling-client.js';

function supervisedInbox(f: ReturnType<typeof fixture>) {
  bound(f);
  const account: TelegramSupervisorAccount = { userId: f.user.id, accountId: f.telegramAccount.id,
    configRevision: 1, enabled: true, botToken: 'fixture', botUsername: 'fb_bot' };
  const cursor = new TelegramCursorRepository(f.db, f.user.id, account.accountId, 1);
  const ingress = createTelegramNativeIngress({ db: f.db, userId: f.user.id, masterKey: f.key,
    accountId: account.accountId, accountRevision: 1 });
  let readAccount: () => TelegramSupervisorAccount | Promise<TelegramSupervisorAccount> = () => account;
  let resumeAccount = () => {};
  let release!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { release = resolve; });
  let firstPoll = true;
  const callbacks: TelegramPollingCallbacks[] = [];
  const offsets: Array<number | undefined> = [];
  const supervisor = new TelegramConnectionSupervisor({
    accounts: { listEnabled: () => [account], get: () => readAccount(), updateHealth: () => {} },
    createHandlers: () => ({ onMessage: ingress }),
    createPollingClient: (config, lifecycle, handlers) => {
      callbacks.push(lifecycle);
      return createTelegramPollingClient({ token: config.botToken, callbacks: lifecycle, handlers, cursor,
        validate: async () => {}, fetch: async (url, init) => {
          if (String(url).endsWith('/getMe')) return Response.json({ ok: true,
            result: { id: 999, is_bot: true, first_name: 'Fixture', username: 'fb_bot' } });
          const offset = (JSON.parse(String(init?.body)) as { offset?: number }).offset;
          offsets.push(offset);
          if (firstPoll) { firstPoll = false; return response; }
          if (offset === undefined) return Response.json({ ok: true, result: [update(100, 1, 123)] });
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('closed')), { once: true });
          });
        }
      });
    }
  });
  return { supervisor, cursor, callbacks, offsets, account,
    release: () => release(Response.json({ ok: true, result: [update(100, 1, 123)] })),
    deferAccount: () => new Promise<void>(resolve => {
      readAccount = () => new Promise<TelegramSupervisorAccount>(done => {
        readAccount = () => account;
        resumeAccount = () => { done(account); resolve(); };
      });
    }),
    resumeAccount: () => resumeAccount()
  };
}

const settlePolling = () => new Promise<void>(resolve => setImmediate(resolve));
for (let gap = 0; gap < 8; gap++) {
  it(`same-revision reconcile preserves durable Telegram ingress at microtask gap ${gap}`, async () => {
    const f = fixture(); const transport = supervisedInbox(f);
    try {
      await transport.supervisor.start(); await settlePolling();
      transport.release();
      for (let i = 0; i < gap; i++) await Promise.resolve();
      await transport.supervisor.reconcileAccount(f.user.id); await settlePolling();
      assert.equal((f.db.prepare('SELECT count(*) n FROM channel_messages').get() as { n: number }).n, 1);
      assert.equal(transport.cursor.load(), 101);
      assert.equal(transport.supervisor.getHealth(f.user.id).state, 'connected');
      const inbox = new NativeChannelInbox(f.db, f.user.id, f.key);
      assert.equal(inbox.adoptNext().status, 'adopted');
      assert.equal(inbox.adoptNext().status, 'idle');
    } finally { await transport.supervisor.stop(); f.db.close(); }
  });
}

it('slow reconciliation leaves skipped Telegram updates unacknowledged and reconnects the same account', async () => {
  const f = fixture(); const transport = supervisedInbox(f);
  try {
    await transport.supervisor.start(); await settlePolling();
    const resumed = transport.deferAccount();
    const refreshing = transport.supervisor.reconcileAccount(f.user.id);
    transport.release(); await settlePolling();
    assert.equal(transport.cursor.load(), undefined);
    assert.deepEqual(transport.offsets, [undefined]);
    transport.resumeAccount(); await resumed; await refreshing; await settlePolling();
    assert.equal(transport.callbacks.length, 2);
    transport.callbacks[0]!.onError?.(new Error('late old-client failure'));
    await settlePolling();
    assert.equal(transport.supervisor.getHealth(f.user.id).state, 'connected');
    assert.equal(transport.cursor.load(), 101);
    assert.equal((f.db.prepare('SELECT count(*) n FROM channel_messages').get() as { n: number }).n, 1);
  } finally { await transport.supervisor.stop(); f.db.close(); }
});

for (const channel of ['feishu', 'telegram'] as const) {
  it(`deleting the ${channel} route parent blocks child Web admission`, () => {
    const f = fixture();
    try {
      const account = channel === 'telegram' ? f.telegramAccount : f.feishuAccount;
      const { peer, identity } = f.pair(channel, account.id, account.configRevision, '123', '123');
      const route = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
      const config = channel === 'telegram' ? f.telegramConfig : f.feishuConfig;
      config.upsertConfig({ allowedChatIds: ['123', '-1001'] });
      const group = { ...peer, chatId: '-1001', chatType: 'group' as const, mentionedBot: true as const };
      const child = f.service.admit(route.id, group).conversationId;
      assert.equal(new CopilotConversationLog(f.db, f.user.id).deleteConversation(route.conversationId), true);
      assert.throws(() => f.service.admit(route.id, group), /CHANNEL_AUTHORITY_REJECTED/);
      assert.throws(() => new CopilotRunLedger(f.db, f.user.id).admit({
        userId: f.user.id, conversationId: child, userText: 'after parent deletion'
      }, 16), /CHANNEL_AUTHORITY_REJECTED/);
      assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_runs').get() as { n: number }).n, 0);
    } finally { f.db.close(); }
  });
}
it('native Telegram runtime acknowledges definite authority rejection and admits the next authorized update',async()=>{
 const f=fixture();try{
  bound(f);let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});let polls=0;
  const runtime=createNativeTelegramRuntime(f.db,f.key,{validate:async()=>{},fetch:async(input,init)=>{
   if(String(input).endsWith('/getMe'))return Response.json({ok:true,result:{id:999,is_bot:true,first_name:'Fixture',username:'fb_bot'}});
   polls++;const offset=JSON.parse(String(init?.body)).offset as number|undefined;
   if(offset===12){finish();return new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('closed')),{once:true});});}
   const forbidden=update(10,1,123);forbidden.message.from.id=456;
   return Response.json({ok:true,result:[forbidden,update(11,2,123)]});
  }});
  try{await runtime.start();await done;
   assert.equal(new TelegramCursorRepository(f.db,f.user.id,f.telegramAccount.id,1).load(),12);
   assert.equal((f.db.prepare('SELECT count(*) n FROM channel_messages').get() as {n:number}).n,1);assert.equal(polls,2);
  }finally{await runtime.stop();}
 }finally{f.db.close();}
});
it('diagnostics respect integration emergency stop and do not attribute another channel route to Feishu',()=>{
 const f=fixture();try{
  bound(f);
  const feishu=runChannelDiagnostics(f.db,f.user.id,f.key,'feishu').checks.find(c=>c.key==='route')!;
  assert.equal(feishu.detail,'尚无渠道授权路由。');
  f.telegramAccounts.updateAccountHealth(f.telegramAccount.id,{state:'connected'});
  f.telegramConfig.upsertConfig({emergencyDisabled:true});
  const checks=runChannelDiagnostics(f.db,f.user.id,f.key,'telegram').checks;
  assert.equal(checks.find(c=>c.key==='route')?.ok,false);assert.equal(checks.find(c=>c.key==='connection')?.ok,false);
 }finally{f.db.close();}
});
