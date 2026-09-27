import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { FeishuChannelRepository } from '../src/db/repositories/feishu-channel-repository.js';
import { FeishuIntegrationRepository } from '../src/db/repositories/feishu-integration-repository.js';
import { ChannelIdentityService, type TrustedChannelPeer } from '../src/services/channels/channel-identity-service.js';
import { NativeChannelInbox, createTelegramNativeIngress } from '../src/services/channels/native-channel-inbox.js';
import { NativeChannelDelivery } from '../src/services/channels/native-channel-delivery.js';
import { createFeishuNativeSender } from '../src/services/integrations/feishu-native-sender.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { CopilotFollowups } from '../src/services/agent/followups.js';
import { executionControl } from '../src/services/agent/execution-control.js';
import { assertChannelConversationAuthority } from '../src/services/channels/channel-run-authority.js';
import { normalizeTelegramUpdate } from '../src/services/integrations/telegram-event-normalizer.js';
import { createNativeFeishuRuntime } from '../src/services/channels/native-feishu-runtime.js';
import type { FeishuSdkEventHandlers } from '../src/services/integrations/feishu-sdk.js';
import { TelegramChannelRepository } from '../src/db/repositories/telegram-channel-repository.js';
import { TelegramIntegrationRepository } from '../src/db/repositories/telegram-integration-repository.js';
import { encryptSecret, decryptSecret, type EncryptedSecret } from '../src/crypto/secret-box.js';

const migrationsFolder=fileURLToPath(new URL('../src/db/migrations', import.meta.url));
function fixture(folder=migrationsFolder) {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder: folder });
  const user = new UserRepository(db).create('typing@test.dev', 'fixture');
  const other = new UserRepository(db).create('other@test.dev', 'fixture');
  const key = randomBytes(32).toString('hex');
  const accounts = new FeishuChannelRepository(db, user.id, key);
  const account = accounts.upsertAccount({ appId: 'test-app', appSecret: randomBytes(24).toString('hex'), enabled: true });
  const config = new FeishuIntegrationRepository(db, user.id);
  config.upsertConfig({ enabled: true, emergencyDisabled: false, allowedChatIds: ['chat'] });
  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: 'typing', path: '/private/tmp/typing-test', aiTool: 'claude' });
  projects.setCopilotAutonomy(project.id, true);
  const service = new ChannelIdentityService(db, user.id, key);
  const peer: TrustedChannelPeer = { channel: 'feishu', accountId: account.id, accountRevision: account.configRevision,
    externalUserId: 'sender', chatId: 'chat', chatType: 'p2p', replyToMessageId: 'original' };
  const issued = service.createPairing({ channel: 'feishu', accountId: account.id });
  const claimed = service.claimPairing(issued.token, peer);
  const identity = service.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId: 'sender', chatId: 'chat' });
  const route = service.createRoute({ identityId: identity.id, projectId: project.id });
  const inbox = new NativeChannelInbox(db, user.id, key);
  const receive = () => inbox.receive(peer, { eventId: 'event', messageId: 'original', text: 'hello' });
  let sequence = 0;
  const command = (text: string, scope = peer, event = `command-${++sequence}`) => inbox.receive(scope, { eventId: event, messageId: event, text });
  const deliver = async () => {
    const replies: string[] = [];
    const worker = new NativeChannelDelivery(db, user.id, key, async input => {
      input.authorize(); replies.push(input.text); return { status: 'delivered', messageId: 'reply' };
    });
    for (let i=0;i<20;i++) await worker.runOnce(new AbortController().signal);
    return replies;
  };
  return { db, user, other, key, accounts, account, config, service, route, peer, inbox, receive, command, deliver };
}

it('answers /help and unknown commands durably without creating model runs', async () => {
  const f=fixture();
  try {
    f.command('/help'); f.command('/not-a-command');
    const replies=await f.deliver();
    assert.equal(replies.length,2);
    assert.match(replies[0]!, /\/new/);
    assert.match(replies[1]!, /未知命令/);
    assert.equal(f.inbox.adoptNext().status,'idle');
    assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_runs').get() as {n:number}).n,0);
  } finally { f.db.close(); }
});

function adopted(f: ReturnType<typeof fixture>) {
  const result=f.inbox.adoptNext();
  assert.equal(result.status,'adopted');
  if(result.status!=='adopted')throw new Error('adoption failed');
  return result.runId;
}

it('/status and /stop bypass busy execution and cancel pending input and Web follow-ups',async()=>{
  const f=fixture();
  try {
    f.receive(); const runId=adopted(f);
    const ledger=new CopilotRunLedger(f.db,f.user.id);
    const claim=ledger.claim(runId,'worker',30_000)!;
    const controller=new AbortController();
    executionControl(f.db).active.set(runId,{controller,stopLease:()=>{},promise:Promise.resolve()});
    f.command('queued prompt');
    const followups=new CopilotFollowups(f.db,f.user.id);
    const followup=followups.enqueue({userId:f.user.id,conversationId:f.route.conversationId,userText:'web queued',clientRequestId:'web-queued'});
    f.command('/status');
    const status=(await f.deliver()).join('\n');
    assert.match(status,/处理中/); assert.match(status,/排队消息：2/);
    f.command('/stop');
    assert.equal(ledger.get(runId)?.status,'cancelled');
    assert.equal(controller.signal.aborted,true);
    assert.equal(ledger.finish(claim,'completed'),false);
    assert.equal(f.inbox.adoptNext().status,'idle');
    assert.equal(followups.get(followup.id)?.status,'cancelled');
    assert.deepEqual(followups.promote(),[]);
    assert.ok((await f.deliver()).some(text=>text.includes('取消 2 条')));
  } finally {f.db.close();}
});

it('/new preserves history, changes only the current scope and deduplicates replay',async()=>{
  const f=fixture();
  try {
    f.receive(); const runId=adopted(f);
    const ledger=new CopilotRunLedger(f.db,f.user.id);
    const claim=ledger.claim(runId,'worker',30_000)!;ledger.finish(claim,'completed');
    await f.deliver();
    const history=ledger.log.listMessages(f.route.conversationId);
    f.command('/new',f.peer,'new-once');
    const next=f.service.admit(f.route.id,f.peer).conversationId;
    assert.notEqual(next,f.route.conversationId);
    f.command('/new',f.peer,'new-once');
    assert.equal(f.service.admit(f.route.id,f.peer).conversationId,next);
    assert.deepEqual(ledger.log.listMessages(f.route.conversationId),history);
    assert.throws(()=>assertChannelConversationAuthority(f.db,f.user.id,f.route.conversationId));
    assertChannelConversationAuthority(f.db,f.user.id,next);
    assert.match((await f.deliver()).join('\n'),/已开始新对话/);
    f.command('fresh prompt');
    assert.equal(ledger.get(adopted(f))?.conversation_id,next);
    assert.ok(!ledger.log.listMessages(next).some(m=>m.content==='hello'));
  }finally{f.db.close();}
});

for(const blocker of ['pending','running','followup','unprojected-result','pending-reply','pending-command'] as const)it(`/new waits for ${blocker}`,async()=>{
  const f=fixture();
  try {
    if(blocker==='pending-command')f.command('/help');
    else if(blocker==='followup')new CopilotFollowups(f.db,f.user.id).enqueue({userId:f.user.id,conversationId:f.route.conversationId,userText:'queued',clientRequestId:'queued'});
    else {
      f.receive();
      if(blocker!=='pending') {
        const runId=adopted(f),ledger=new CopilotRunLedger(f.db,f.user.id);
        const claim=ledger.claim(runId,'worker',30_000)!;
        if(blocker!=='running')ledger.finish(claim,'completed');
        if(blocker==='pending-reply')new NativeChannelDelivery(f.db,f.user.id,f.key,async()=>({status:'retry'})).project();
      }
    }
    f.command('/new');
    assert.equal(f.service.admit(f.route.id,f.peer).conversationId,f.route.conversationId);
    assert.ok((await f.deliver()).some(text=>text.includes('请先 /stop')));
  }finally{f.db.close();}
});

it('duplicate /stop does not stop work submitted afterwards',async()=>{
  const f=fixture();
  try {
    f.receive();const first=adopted(f);
    f.command('/stop',f.peer,'stop-once'); await f.deliver();
    f.command('next');const second=adopted(f);
    f.command('/stop',f.peer,'stop-once');
    const ledger=new CopilotRunLedger(f.db,f.user.id);
    assert.equal(ledger.get(first)?.status,'cancelled');
    assert.equal(ledger.get(second)?.status,'pending');
  }finally{f.db.close();}
});

it('failed receipt persistence rolls back stopping and never aborts an executing request',()=>{
  const f=fixture();
  try {
    f.receive();const runId=adopted(f);
    const controller=new AbortController();
    executionControl(f.db).active.set(runId,{controller,stopLease:()=>{},promise:Promise.resolve()});
    f.db.exec("CREATE TRIGGER fail_command BEFORE INSERT ON channel_deliveries WHEN NEW.phase='command' BEGIN SELECT RAISE(ABORT,'disk failure'); END");
    assert.throws(()=>f.command('/stop'),/disk failure/);
    assert.equal(new CopilotRunLedger(f.db,f.user.id).get(runId)?.status,'pending');
    assert.equal(controller.signal.aborted,false);
    assert.equal((f.db.prepare("SELECT count(*) n FROM channel_messages WHERE status='command'").get() as {n:number}).n,0);
  }finally{f.db.close();}
});

it('stops research descendants but leaves other chat/topic conversations and tenants alone',async()=>{
  const f=fixture();
  try {
    f.config.upsertConfig({allowedChatIds:['chat','group']});
    const topic:TrustedChannelPeer={...f.peer,chatType:'group',chatId:'group',threadId:'topic',mentionedBot:true};
    f.receive();const parent=adopted(f);
    f.command('topic prompt',topic);const otherRun=adopted(f);
    const ledger=new CopilotRunLedger(f.db,f.user.id);
    const childConversation=ledger.log.createConversation('research');
    const child=ledger.log.createRun(childConversation.id,{}).id;
    f.db.prepare('INSERT INTO copilot_research_jobs(id,user_id,origin_run_id,source_key,conversation_id,child_run_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run('research-job',f.user.id,parent,'source',childConversation.id,child,Date.now());
    const childController=new AbortController();
    executionControl(f.db).active.set(child,{controller:childController,stopLease:()=>{},promise:Promise.resolve()});
    assert.throws(()=>new NativeChannelInbox(f.db,f.other.id,f.key).receive(f.peer,{eventId:'bad',messageId:'bad',text:'/stop'}));
    f.command('/stop');
    assert.equal(ledger.get(parent)?.status,'cancelled');assert.equal(ledger.get(child)?.status,'cancelled');
    assert.equal(childController.signal.aborted,true);assert.equal(ledger.get(otherRun)?.status,'pending');
    await f.deliver(); f.command('/new');
    assert.equal(f.service.admit(f.route.id,topic).conversationId,ledger.get(otherRun)?.conversation_id);
  }finally{f.db.close();}
});

it('rechecks command reply authority after async token work and preserves committed command effects',async()=>{
  const f=fixture();
  try {
    f.command('/new');
    const next=f.service.admit(f.route.id,f.peer).conversationId;
    let messages=0;
    const sender=createFeishuNativeSender(f.db,f.user.id,f.key,{validate:async()=>{},fetch:async(url)=>{
      if(String(url).includes('/auth/')) {f.service.revokeRoute(f.route.id);return Response.json({code:0,tenant_access_token:'token'});}
      messages++;return Response.json({code:0,data:{message_id:'reply'}});
    }});
    await new NativeChannelDelivery(f.db,f.user.id,f.key,sender).runOnce(new AbortController().signal);
    assert.equal(messages,0);
    assert.equal(f.service.records.session(f.route.id,f.peer)?.conversationId,next);
    assert.equal((f.db.prepare("SELECT status FROM channel_deliveries WHERE phase='command'").get() as {status:string}).status,'cancelled');
  }finally{f.db.close();}
});

it('rejects unexpected command parameters and preserves existing playbook/skills inputs',async()=>{
  const f=fixture();
  try {
    for(const text of ['/NEW extra',' /stop now ','/status anything','/playbooks list'])f.command(text);
    const replies=await f.deliver();assert.equal(replies.length,4);assert.ok(replies.every(text=>text.includes('不接受参数')));
    assert.equal(f.service.admit(f.route.id,f.peer).conversationId,f.route.conversationId);
    f.command('/skills'); assert.equal(f.inbox.adoptNext().status,'adopted');
  }finally{f.db.close();}
});

it('Telegram only normalizes a command addressed to this bot and ignores another bot suffix',()=>{
  const update=(text:string)=>({update_id:1,message:{message_id:1,text,from:{id:123,is_bot:false},chat:{id:-100,type:'supergroup'}}});
  const bot={id:999,username:'fixture_bot',firstName:'Fixture'};
  const own=normalizeTelegramUpdate(update('/new@Fixture_Bot'),bot);
  assert.equal(own?.text,'/new');assert.equal(own?.mentionedBot,true);
  assert.equal(normalizeTelegramUpdate(update('/stop@someone_else @fixture_bot'),bot),undefined);
});

it('Telegram uses the shared durable control path with its own paired account and scoped topic',async()=>{
  const f=fixture();
  try {
    const account=new TelegramChannelRepository(f.db,f.user.id,f.key).upsertAccount({botToken:'fixture',botUsername:'fixture_bot',enabled:true});
    new TelegramIntegrationRepository(f.db,f.user.id).upsertConfig({enabled:true,emergencyDisabled:false,allowedChatIds:['123','-100']});
    const peer:TrustedChannelPeer={channel:'telegram',accountId:account.id,accountRevision:account.configRevision,externalUserId:'123',chatId:'123',chatType:'p2p'};
    const issued=f.service.createPairing({channel:'telegram',accountId:account.id});
    const claim=f.service.claimPairing(issued.token,peer);
    const identity=f.service.confirmPairing(claim.id,{revision:claim.revision,externalUserId:'123',chatId:'123'});
    f.service.createRoute({identityId:identity.id,projectId:f.route.projectId});
    const ingress=createTelegramNativeIngress({db:f.db,userId:f.user.id,masterKey:f.key,accountId:account.id,accountRevision:account.configRevision});
    const event=normalizeTelegramUpdate({update_id:10,message:{message_id:10,message_thread_id:42,text:'/new@fixture_bot',from:{id:123},chat:{id:-100,type:'supergroup'}}},
      {id:999,username:'fixture_bot',firstName:'Fixture'});
    assert.equal(ingress(event).status,'admitted');assert.equal(ingress(event).status,'admitted');
    const replies=await f.deliver();assert.equal(replies.length,1);assert.match(replies[0]!,/已开始新对话/);
    assert.equal(f.service.admit(f.route.id,f.peer).conversationId,f.route.conversationId);
    assert.equal(f.inbox.adoptNext().status,'idle');
  }finally{f.db.close();}
});

it('migration backfills adopted inputs and legacy queued scope is stopped before switching',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'fb-command-upgrade-'));
  mkdirSync(join(directory,'meta'));
  const journal=JSON.parse(readFileSync(join(migrationsFolder,'meta/_journal.json'),'utf8')) as {entries:{tag:string}[]};
  journal.entries=journal.entries.filter(e=>Number.parseInt(e.tag,10)<116);
  for(const entry of journal.entries)cpSync(join(migrationsFolder,entry.tag+'.sql'),join(directory,entry.tag+'.sql'));
  writeFileSync(join(directory,'meta/_journal.json'),JSON.stringify(journal));
  const f=fixture(directory);
  try {
    const ledger=new CopilotRunLedger(f.db,f.user.id);
    // Seed historical rows without invoking runtime authority checks against an old schema.
    const runId=ledger.log.createRun(f.route.conversationId,{}).id;
    f.db.prepare('UPDATE copilot_runs SET runtime_version=1,input_json=?,max_steps=16 WHERE id=?')
      .run(JSON.stringify({userId:f.user.id,conversationId:f.route.conversationId,userText:'old input'}),runId);
    const payload=JSON.stringify(encryptSecret(JSON.stringify({peer:f.peer,text:'legacy queued'}),{key:f.key}));
    for(const [id,status,run] of [['old-adopted','adopted',runId],['old-pending','pending',null]]) {
      f.db.prepare('INSERT INTO channel_messages(id,user_id,route_id,account_id,event_id,message_id,payload_encrypted,payload_digest,status,run_id,created_at,chat_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id,f.user.id,f.route.id,f.account.id,id,id,payload,'fixture',status,run,Date.now(),f.peer.chatId);
    }
    migrate(drizzle(f.db),{migrationsFolder});
    assert.equal(f.inbox.messages.get('old-adopted')?.conversation_id,f.route.conversationId);
    f.command('/new');assert.equal(f.service.admit(f.route.id,f.peer).conversationId,f.route.conversationId);
    f.command('/stop');assert.equal(f.inbox.messages.get('old-pending')?.status,'rejected');
    await f.deliver();f.command('/new');assert.notEqual(f.service.admit(f.route.id,f.peer).conversationId,f.route.conversationId);
    assert.equal(f.inbox.adoptNext().status,'idle');
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.db.close();rmSync(directory,{recursive:true,force:true});}
});

it('fixed conversation binding rejects stale pending input instead of moving it to a new conversation',()=>{
  const f=fixture();
  try {
    const received=f.receive();
    const next=new CopilotRunLedger(f.db,f.user.id).log.createConversation('new');
    f.service.records.replaceSession(f.route.id,f.peer,f.route.conversationId,next.id);
    assert.equal(f.inbox.adoptNext().status,'rejected');
    assert.throws(()=>f.inbox.result(received.id,f.peer));
  }finally{f.db.close();}
});

it('command receipt survives database reopen and a retry never re-executes /new',async()=>{
  const f=fixture();const dir=mkdtempSync(join(tmpdir(),'fb-command-reopen-'));
  try {
    const received=f.command('/new',f.peer,'new');
    const next=f.service.admit(f.route.id,f.peer).conversationId;
    const record=f.db.prepare("SELECT payload_encrypted FROM channel_deliveries WHERE phase='command'").get() as {payload_encrypted:string};
    assert.ok(!record.payload_encrypted.includes('已开始'));
    assert.match(decryptSecret(JSON.parse(record.payload_encrypted) as EncryptedSecret,{key:f.key}),/已开始新对话/);
    const path=join(dir,'db.sqlite');await f.db.backup(path);f.db.close();
    const db=new Sqlite(path);
    try {
      const receivedAgain=new NativeChannelInbox(db,f.user.id,f.key).receive(f.peer,{eventId:'new',messageId:'new',text:'/new'});
      assert.equal(receivedAgain.id,received.id);assert.equal(receivedAgain.duplicate,true);
      assert.equal(new ChannelIdentityService(db,f.user.id).admit(f.route.id,f.peer).conversationId,next);
      let sends=0;
      await new NativeChannelDelivery(db,f.user.id,f.key,async input=>{input.authorize();sends++;return {status:'delivered'};}).runOnce(new AbortController().signal);
      assert.equal(sends,1);
    }finally{db.close();}
  }finally{if(f.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});

it('native production handler sends command feedback while an existing run remains busy',async()=>{
  const f=fixture();let handlers:FeishuSdkEventHandlers|undefined;const replies:string[]=[];
  const runtime=createNativeFeishuRuntime(f.db,f.key,{sdkFactory:{createWebSocketClient:(_config,callbacks,incoming)=>{
    handlers=incoming;return {start:async()=>{callbacks.onReady?.();},close:()=>{},getConnectionStatus:()=>({state:'connected',reconnectAttempts:0})};
  }},validate:async()=>{},fetch:async(url,init)=>{
    if(String(url).includes('/auth/'))return Response.json({code:0,tenant_access_token:'fixture'});
    if(String(url).includes('/reactions'))return Response.json({code:0,data:{reaction_id:'typing'}});
    const body=JSON.parse(String(init?.body)) as {msg_type:string;content:string};
    assert.equal(body.msg_type,'post');
    const post=JSON.parse(body.content) as {zh_cn:{content:{tag:string;text:string}[][]}};
    replies.push(post.zh_cn.content.flat().map(element=>element.text).join('\n'));
    return Response.json({code:0,data:{message_id:'reply'}});
  }});
  const wait=async(check:()=>boolean)=>{const deadline=Date.now()+5000;while(!check()){assert.ok(Date.now()<deadline,'timeout');await new Promise(r=>setTimeout(r,10));}};
  try {
    f.receive();const runId=adopted(f);
    await runtime.start();await wait(()=>Boolean(handlers));
    const event=(text:string,id:string)=>({sender:{sender_id:{open_id:f.peer.externalUserId}},message:{message_id:id,chat_id:f.peer.chatId,chat_type:'p2p',message_type:'text',content:JSON.stringify({text})}});
    await handlers!.onMessage!(event('/status','status'),{botOpenId:'bot'});
    await wait(()=>replies.some(text=>text.includes('处理中')));
    await handlers!.onMessage!(event('/stop','stop'),{botOpenId:'bot'});
    await wait(()=>replies.some(text=>text.includes('已停止 1')));
    assert.equal(new CopilotRunLedger(f.db,f.user.id).get(runId)?.status,'cancelled');
  }finally{await runtime.stop();f.db.close();}
});
