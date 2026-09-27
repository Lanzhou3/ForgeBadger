import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
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
import { NativeChannelInbox } from '../src/services/channels/native-channel-inbox.js';
import { NativeChannelDelivery } from '../src/services/channels/native-channel-delivery.js';
import { createFeishuNativeSender } from '../src/services/integrations/feishu-native-sender.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { CopilotPreferencesRepository } from '../src/db/repositories/copilot-preferences-repository.js';
import { buildAgentStack } from '../src/services/agent/agent-stack.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { CopilotFollowups } from '../src/services/agent/followups.js';
import { createAgentLlmClient } from '../src/services/agent/llm-client.js';
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


function models(f: ReturnType<typeof fixture>) {
  const repo=new ModelProviderRepository(f.db,f.user.id,f.key);
  const add=(name:string,key:string,modelId:string,isDefault=false)=>{
    const provider=repo.createProviderProfile({name,providerKey:key,baseUrl:`https://8.8.8.8/${key}/v1`,apiFormat:'openai',authType:'api_key',supportedAdapters:['opencode']});
    repo.createCredential({providerProfileId:provider.id,label:'fixture',plaintextSecret:randomBytes(24).toString('hex')});
    return repo.createModelProfile({providerProfileId:provider.id,name,modelId,capabilities:['chat'],isDefault});
  };
  const a=add('Alpha','alpha','model-a',true), b=add('Beta','beta','org/model-b');
  return {repo,add,a,b};
}

it('/model shows the effective current model and lists tenant-configured choices without starting a run',async()=>{
  const f=fixture();
  try {
    const {a,b}=models(f);
    f.command('/model'); f.command('/model list');
    const replies=await f.deliver();
    assert.match(replies[0]!,/当前模型/);assert.ok(replies[0]!.includes(a.modelId));
    assert.ok(replies[1]!.includes(a.id));assert.ok(replies[1]!.includes(b.id));
    assert.equal(f.inbox.adoptNext().status,'idle');
    assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_runs').get() as {n:number}).n,0);
  }finally{f.db.close();}
});

function adopted(f:ReturnType<typeof fixture>) {
  const result=f.inbox.adoptNext();assert.equal(result.status,'adopted');
  if(result.status!=='adopted')throw new Error('adoption failed');return result.runId;
}
function pin(f:ReturnType<typeof fixture>, peer=f.peer) { return f.service.records.session(f.route.id,peer)?.modelProfileId; }
async function execute(f:ReturnType<typeof fixture>,runId:string) {
  const requests:{url:string;model:string}[]=[];
  const stack=buildAgentStack({db:f.db,masterKey:f.key,eventBus:new ForgeBadgerEventBus(),llmFetch:async(url,init)=>{
    requests.push({url:String(url),model:(JSON.parse(String(init?.body)) as {model:string}).model});
    return Response.json({choices:[{message:{content:'Fixture answer'}}],usage:{prompt_tokens:5,completion_tokens:2}});
  }},f.user.id);
  await stack.orchestrator.executeRun(f.user.id,runId);
  return requests;
}

it('qualified model selection reaches the actual chosen provider/model and leaves global preferences unchanged',async()=>{
  const f=fixture();
  try {
    const {a,b}=models(f);
    const preferences=new CopilotPreferencesRepository(f.db,f.user.id,f.key);preferences.set({modelId:a.id});
    f.command('/model beta/org/model-b');
    assert.equal(pin(f),b.id);assert.equal(preferences.get().modelId,a.id);
    assert.match((await f.deliver()).join('\n'),/已切换当前会话模型/);
    f.receive();const runId=adopted(f);
    assert.equal(JSON.parse(new CopilotRunLedger(f.db,f.user.id).get(runId)!.input_json).modelId,b.id);
    const requests=await execute(f,runId);
    assert.ok(requests.length>0);assert.ok(requests.every(r=>r.model===b.modelId && r.url.startsWith('https://8.8.8.8/beta/v1/')));
    assert.equal(new CopilotRunLedger(f.db,f.user.id).get(runId)?.status,'completed');
  }finally{f.db.close();}
});

it('model choice survives /new and scope rotation without resetting history or another topic',async()=>{
  const f=fixture();
  try {
    const {b}=models(f);f.command(`/model ${b.id}`);await f.deliver();
    f.config.upsertConfig({allowedChatIds:['chat','group']});
    const topic:TrustedChannelPeer={...f.peer,chatType:'group',chatId:'group',threadId:'42',mentionedBot:true};
    f.service.admit(f.route.id,topic);
    assert.equal(pin(f,topic),null);
    f.command('/new');await f.deliver();assert.equal(pin(f),b.id);assert.equal(pin(f,topic),null);
    f.command('after new');const requests=await execute(f,adopted(f));assert.ok(requests.every(r=>r.model===b.modelId));
  }finally{f.db.close();}
});

it('/model default follows the real user preference instead of the provider default',async()=>{
  const f=fixture();
  try {
    const {a,b}=models(f);new CopilotPreferencesRepository(f.db,f.user.id,f.key).set({modelId:b.id});
    f.command(`/model ${a.id}`);f.command('/model default');assert.equal(pin(f),null);
    const replies=await f.deliver();assert.ok(replies[1]!.includes(b.modelId));assert.ok(replies[1]!.includes('跟随默认'));
    f.receive();const requests=await execute(f,adopted(f));assert.ok(requests.length>0);assert.ok(requests.every(r=>r.model===b.modelId));
  }finally{f.db.close();}
});

for(const blocked of ['active','pending','followup'] as const)it(`model selection refuses ${blocked} work but read commands remain available`,async()=>{
  const f=fixture();
  try {
    const {a,b}=models(f);f.command(`/model ${a.id}`);await f.deliver();
    if(blocked==='followup')new CopilotFollowups(f.db,f.user.id).enqueue({userId:f.user.id,conversationId:f.route.conversationId,userText:'queued',clientRequestId:'queued'});
    else {f.receive();if(blocked==='active')adopted(f);}
    f.command(`/model ${b.id}`);f.command('/model status');f.command('/model list');f.command('/model default');
    const replies=await f.deliver();assert.match(replies[0]!,/先 \/stop/);assert.ok(replies[1]!.includes(a.modelId));assert.match(replies[2]!,/可用模型配置/);
    assert.equal(pin(f),a.id);
  }finally{f.db.close();}
});

it('missing, foreign and ambiguous model references never mutate the selection',async()=>{
  const f=fixture();
  try {
    const {repo,a,b}=models(f);f.command(`/model ${a.id}`);await f.deliver();
    const duplicate=repo.createProviderProfile({name:'Beta elsewhere',providerKey:'beta',baseUrl:'https://1.1.1.1/v1',apiFormat:'openai',authType:'api_key',supportedAdapters:['opencode']});
    repo.createCredential({providerProfileId:duplicate.id,plaintextSecret:'fixture-secret'});
    repo.createModelProfile({providerProfileId:duplicate.id,name:b.name,modelId:b.modelId,capabilities:['chat']});
    const foreign=new ModelProviderRepository(f.db,f.other.id,f.key);
    const provider=foreign.createProviderProfile({name:'private-foreign',providerKey:'foreign',baseUrl:'https://1.1.1.1',apiFormat:'openai',authType:'api_key',supportedAdapters:['opencode']});
    const foreignModel=foreign.createModelProfile({providerProfileId:provider.id,name:'private-foreign',modelId:'secret-model'});
    for(const selector of ['missing',foreignModel.id,'beta/org/model-b',b.name])f.command(`/model ${selector}`);
    const replies=await f.deliver();assert.ok(replies.every(r=>r.includes('未切换')));assert.equal(pin(f),a.id);
    f.command('/model list');const listing=(await f.deliver()).join('');assert.ok(!listing.includes('private-foreign'));assert.ok(!listing.includes('secret-model'));
    f.command(`/model ${b.id}`);assert.equal(pin(f),b.id);
  }finally{f.db.close();}
});

for(const failure of ['deleted','inactive','provider-deleted','provider-inactive','credential','format','capability'] as const)
it(`a pinned model becoming ${failure} fails visibly without fallback and can be reset`,async()=>{
  const f=fixture();
  try {
    const {repo,b}=models(f);f.command(`/model ${b.id}`);await f.deliver();
    if(failure==='deleted')repo.deleteModelProfile(b.id);
    if(failure==='inactive')f.db.prepare("UPDATE model_profiles SET status='inactive' WHERE id=?").run(b.id);
    if(failure==='provider-deleted')repo.deleteProviderProfile(b.providerProfileId);
    if(failure==='provider-inactive')f.db.prepare("UPDATE model_provider_profiles SET status='inactive' WHERE id=?").run(b.providerProfileId);
    if(failure==='credential')f.db.prepare('DELETE FROM provider_credentials WHERE provider_profile_id=?').run(b.providerProfileId);
    if(failure==='format')f.db.prepare("UPDATE model_provider_profiles SET api_format='google' WHERE id=?").run(b.providerProfileId);
    if(failure==='capability')f.db.prepare("UPDATE model_profiles SET capabilities='[\"embedding\"]' WHERE id=?").run(b.id);
    f.receive();const runId=adopted(f);const requests=await execute(f,runId);
    assert.deepEqual(requests,[]);assert.equal(new CopilotRunLedger(f.db,f.user.id).get(runId)?.status,'failed');assert.equal(pin(f),b.id);
    assert.ok((await f.deliver()).some(r=>r.includes('任务失败')));
    f.command('/status');assert.ok((await f.deliver()).some(r=>r.includes('当前模型')));
    f.command('/model default');assert.equal(pin(f),null);
  }finally{f.db.close();}
});

it('listing and selection share runtime eligibility, while unspecified capabilities remain compatible',async()=>{
  const f=fixture();
  try {
    const {repo,a,b}=models(f);
    f.db.prepare("UPDATE model_profiles SET capabilities='[]' WHERE id=?").run(a.id);
    f.db.prepare("UPDATE model_provider_profiles SET api_format='bedrock' WHERE id=?").run(b.providerProfileId);
    f.command('/model list');const listing=(await f.deliver()).join('');assert.ok(listing.includes(a.id));assert.ok(!listing.includes(b.id));
    f.command(`/model ${b.id}`);assert.equal(pin(f),null);assert.match((await f.deliver()).join(''),/不支持/);
    f.command('/model Alpha');assert.equal(pin(f),a.id);
    const llm=createAgentLlmClient({modelProviderRepository:repo});assert.equal(llm.modelInfo(a.id).modelId,a.modelId);
    f.db.prepare("UPDATE model_provider_profiles SET api_format='google' WHERE id=?").run(a.providerProfileId);
    assert.throws(()=>llm.modelInfo(a.id),/protocol/,'cached model resolution must not bypass eligibility');
  }finally{f.db.close();}
});

it('model pin and durable receipt roll back together; duplicate commands cannot overwrite a later selection',async()=>{
  const f=fixture();
  try {
    const {a,b}=models(f);
    f.db.exec("CREATE TRIGGER fail_model BEFORE INSERT ON channel_deliveries WHEN NEW.phase='command' BEGIN SELECT RAISE(ABORT,'receipt failure'); END");
    assert.throws(()=>f.command(`/model ${b.id}`,f.peer,'model-b'),/receipt failure/);assert.equal(pin(f),null);
    f.db.exec('DROP TRIGGER fail_model');f.command(`/model ${b.id}`,f.peer,'model-b');assert.equal(pin(f),b.id);
    f.command(`/model ${a.id}`);assert.equal(pin(f),a.id);f.command(`/model ${b.id}`,f.peer,'model-b');assert.equal(pin(f),a.id);
  }finally{f.db.close();}
});

it('empty configuration, bad pagination and long catalogs have bounded local responses',async()=>{
  const f=fixture();
  try {
    for(const text of ['/model','/model list','/model default'])f.command(text);
    assert.equal((await f.deliver()).length,3);
    const {repo,a}=models(f);
    for(let i=0;i<22;i++)repo.createModelProfile({providerProfileId:a.providerProfileId,name:`Another ${i}`,modelId:`model-${i}`,capabilities:['chat']});
    f.command('/model list');f.command('/model list 2');f.command('/model list 0');f.command('/model list 999999999999999');
    const replies=await f.deliver();assert.match(replies[0]!,/第 1\/3 页/);assert.match(replies[1]!,/第 2\/3 页/);
    assert.equal((replies[0]!.match(/\/model [0-9a-f-]{36}/g)??[]).length,10);
    assert.ok(replies.every(r=>Buffer.byteLength(r)<12000));assert.equal(pin(f),null);
  }finally{f.db.close();}
});

it('session model preference and immutable run choice survive database reopen',async()=>{
  const f=fixture();const dir=mkdtempSync(join(tmpdir(),'fb-model-reopen-'));
  try {
    const {b}=models(f);f.command(`/model ${b.id}`);await f.deliver();f.receive();const runId=adopted(f);
    const path=join(dir,'db.sqlite');await f.db.backup(path);f.db.close();const db=new Sqlite(path);
    try {
      assert.equal(new ChannelIdentityService(db,f.user.id).records.session(f.route.id,f.peer)?.modelProfileId,b.id);
      assert.equal(JSON.parse(new CopilotRunLedger(db,f.user.id).get(runId)!.input_json).modelId,b.id);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{db.close();}
  }finally{if(f.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});
