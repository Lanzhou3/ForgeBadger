import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { FeishuChannelRepository } from '../src/db/repositories/feishu-channel-repository.js';
import { createFeishuNativeSender } from '../src/services/integrations/feishu-native-sender.js';
import { buildFeishuMessageParts } from '../src/services/integrations/feishu-markdown.js';
import { ChannelDeliveryRepository } from '../src/db/repositories/channel-delivery-repository.js';
import { FeishuIntegrationRepository } from '../src/db/repositories/feishu-integration-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ChannelIdentityService } from '../src/services/channels/channel-identity-service.js';
import { NativeChannelInbox } from '../src/services/channels/native-channel-inbox.js';
import { NativeChannelDelivery } from '../src/services/channels/native-channel-delivery.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';

interface MessageBody { msg_type: string; content: string; uuid: string; reply_in_thread?: boolean; receive_id?: string }
function fixture(reply: (body: MessageBody, index: number) => Response | Promise<Response> = (_, index) => Response.json({code:0,data:{message_id:`om-${index}`}})) {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), {migrationsFolder:fileURLToPath(new URL('../src/db/migrations',import.meta.url))});
  const user = new UserRepository(db).create('markdown@test.dev','fixture');
  const key = randomBytes(32).toString('hex');
  const account = new FeishuChannelRepository(db,user.id,key).upsertAccount({appId:'fixture',appSecret:randomBytes(24).toString('hex'),enabled:true});
  const calls: MessageBody[] = [];
  const io={validate:async()=>{},fetch:async(url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    if(String(url).includes('tenant_access_token')) return Response.json({code:0,tenant_access_token:'fixture'});
    const body = JSON.parse(String(init?.body)) as MessageBody; calls.push(body);
    return reply(body,calls.length);
  }};
  const send = createFeishuNativeSender(db,user.id,key,io);
  const input = {peer:{channel:'feishu' as const,accountId:account.id,accountRevision:account.configRevision,
    externalUserId:'owner',chatId:'chat',chatType:'p2p' as const},deliveryId:'fixture-delivery',signal:new AbortController().signal,authorize:()=>{}};
  return {db,user,key,account,calls,send,input,io};
}

it('sends headings, emphasis, links, quotes and code as Markdown post rows',async()=>{
  const f=fixture();try {
    const text='## 会话总结\n\n**完成** /model，查看 [文档](https://example.com)\n\n> 引用\n\n```ts\nconst value = "**literal**";\n```\n\n后续说明';
    assert.equal((await f.send({...f.input,text})).status,'delivered');
    assert.equal(f.calls[0]!.msg_type,'post');
    const rows=JSON.parse(f.calls[0]!.content).zh_cn.content as {tag:string;text:string}[][];
    assert.ok(rows.every(row=>row.length===1 && row[0]!.tag==='md'));
    assert.ok(rows.some(row=>row[0]!.text.startsWith('```')));
    assert.match(rows.map(row=>row[0]!.text).join('\n'),/后续说明/);
    assert.match(rows.map(row=>row[0]!.text).join('\n'),/\*\*完成\*\*/);
  } finally {f.db.close();}
});

const rejected=()=>Response.json({code:230001,msg:'content format of the post type is incorrect'},{status:400});
const longReply=()=>Array.from({length:12},(_,i)=>`## 段落 ${i}\n\n${'中文😀 **内容** '.repeat(200)}`).join('\n\n');

it('definite post format rejection falls back with readable text, keeping code and link destinations',async()=>{
  const f=fixture((_,index)=>index===1?rejected():Response.json({code:0,data:{message_id:'ok'}}));try {
    const text='## 标题\n\n**完成** [链接](https://example.com/a_(b))\n\n```ts\nconst x = "**literal**";\n```';
    let checkpoint=0;
    assert.equal((await f.send({...f.input,text,checkpoint:next=>{checkpoint=next;}})).status,'delivered');
    assert.equal(checkpoint,1);assert.deepEqual(f.calls.map(c=>c.msg_type),['post','text']);
    const plain=JSON.parse(f.calls[1]!.content).text as string;
    assert.match(plain,/完成 链接 \(https:\/\/example.com\/a_\(b\)\)/);
    assert.match(plain,/const x = "\*\*literal\*\*"/);assert.doesNotMatch(plain,/## 标题|\*\*完成\*\*|```/);
    assert.notEqual(f.calls[0]!.uuid,f.calls[1]!.uuid);
  }finally{f.db.close();}
});

for(const [name,response,status] of [
  ['generic parameter error',()=>Response.json({code:230001,msg:'invalid receive_id'}),'failed'],
  ['rate limit',()=>new Response('',{status:429,headers:{'retry-after':'2'}}),'retry'],
  ['gateway error',()=>Response.json({code:230001,msg:'content format of the post type is incorrect'},{status:500}),'unknown'],
  ['invalid JSON',()=>new Response('not json'),'unknown'],
  ['missing receipt',()=>Response.json({code:0}),'unknown'],
  ['network ambiguity',()=>{throw new Error('connection closed');},'unknown']
] as const) it(`does not resend text on ${name}`,async()=>{
  const f=fixture(response);try {
    assert.equal((await f.send({...f.input,text:'**bold**'})).status,status);
    assert.equal(f.calls.length,1);
  }finally{f.db.close();}
});

it('resumes after the second part is rate limited and keeps UUIDs, scope and checkpoints stable',async()=>{
  const f=fixture((_,i)=>i===2?new Response('',{status:429}):Response.json({code:0,data:{message_id:`ok-${i}`}}));try {
    let next=0;const text=longReply();
    const input={...f.input,peer:{...f.input.peer,threadId:'thread',replyToMessageId:'original'},text,checkpoint:(value:number)=>{next=value;}};
    assert.equal((await f.send(input)).status,'retry');assert.equal(next,1);
    const secondUuid=f.calls[1]!.uuid;
    let result=await f.send({...input,nextPart:next});
    assert.equal(f.calls[2]!.uuid,secondUuid);assert.notEqual(f.calls[0]!.uuid,secondUuid);
    while(result.status==='continue')result=await f.send({...input,nextPart:next});
    assert.equal(result.status,'delivered');
    assert.equal(next,buildFeishuMessageParts(text).length);
    assert.ok(f.calls.every(call=>call.reply_in_thread===true && !call.receive_id && call.uuid.length<=50));
  }finally{f.db.close();}
});

it('a rate limited fallback retries the same logical part with stable format-specific UUIDs',async()=>{
  const f=fixture((body,i)=>body.msg_type==='post'?rejected():i===2?new Response('',{status:429}):Response.json({code:0,data:{message_id:'ok'}}));try {
    let next=0;const input={...f.input,text:'**完成**',checkpoint:(value:number)=>{next=value;}};
    assert.equal((await f.send(input)).status,'retry');assert.equal(next,0);
    assert.equal((await f.send({...input,nextPart:next})).status,'delivered');assert.equal(next,1);
    assert.equal(f.calls[0]!.uuid,f.calls[2]!.uuid);assert.equal(f.calls[1]!.uuid,f.calls[3]!.uuid);
  }finally{f.db.close();}
});

it('never retries a message after successful send but failed checkpoint',async()=>{
  const f=fixture();try {
    const result=await f.send({...f.input,text:longReply(),checkpoint:()=>{throw new Error('lease lost');}});
    assert.equal(result.status,'unknown');assert.equal(f.calls.length,1);
  }finally{f.db.close();}
});

it('rechecks authorization before fallback and every subsequent part',async()=>{
  for(const fallback of [false,true]) {
    let allowed=true;const f=fixture(()=>{allowed=false;return fallback?rejected():Response.json({code:0,data:{message_id:'ok'}});});
    try {
      const result=await f.send({...f.input,text:longReply(),authorize:()=>{if(!allowed)throw new Error('revoked');}});
      assert.equal(result.status,'unknown');assert.equal(f.calls.length,1);
    }finally{f.db.close();}
  }
});

it('preserves ordinary tables and normalizes indented, tilde and unclosed code blocks',()=>{
  const text='| 名称 | 状态 |\n| --- | --- |\n| A | **完成** |\n\n~~~ts\nconst a = 1;\n~~~\n\n    const b = 2;\n\n```py\nprint(3)';
  const parts=buildFeishuMessageParts(text);
  assert.ok(parts.every(p=>p.msg_type==='post'));
  const rendered=parts.map(p=>p.content).join('');
  assert.match(rendered,/\| 名称 \| 状态 \|/);assert.match(rendered,/```ts/);assert.match(rendered,/```py/);
  const rows=JSON.parse(parts[0]!.content).zh_cn.content as {text:string}[][];
  assert.ok(rows.some(r=>r[0]!.text==='```py\nprint(3)\n```'));
});

it('oversized blocks preserve Unicode, code literals and all content within wire byte limits',()=>{
  const code='中文😀 \\"**literal**\\" '.repeat(600);
  const parts=buildFeishuMessageParts('```ts\n'+code+'\n```');
  assert.ok(parts.length>1);assert.ok(parts.every(p=>p.msg_type==='text'));
  assert.equal(parts.map(p=>JSON.parse(p.content).text).join(''),code+'\n');
  assert.ok(parts.every(p=>Buffer.byteLength(JSON.stringify({msg_type:p.msg_type,content:p.content}),'utf8')<=10_000));
  assert.ok(parts.every(p=>!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(p.plain)));
});

it('bounded output puts its truncation notice outside a cut code fence and retains literal @ tags',()=>{
  const parts=buildFeishuMessageParts('```\n'+'😀'.repeat(30_000));
  assert.match(parts.at(-1)!.plain,/Web Copilot/);
  assert.ok(parts.slice(0,-1).every(p=>!p.plain.includes('Web Copilot')));
  const tags=buildFeishuMessageParts('提示 <at user_id="all"></at>');
  assert.doesNotMatch(tags[0]!.content,/<at /);
});

it('reference links retain their definitions in each independent Markdown row',()=>{
  const parts=buildFeishuMessageParts('## [文档][ref]\n\n查看 [文档][ref]。\n\n[ref]: https://example.com/docs "标题"');
  const rows=JSON.parse(parts[0]!.content).zh_cn.content as {text:string}[][];
  assert.ok(rows.every(row=>row[0]!.text.includes('[ref]: <https://example.com/docs>')));
  assert.match(parts[0]!.plain,/文档 \(https:\/\/example.com\/docs\)/);
});

it('unused references cannot amplify short replies and referenced output has a global wire budget',()=>{
  const unused='# 标题\n\n'.repeat(400)+'[unused]: https://example.com/'+'a'.repeat(8_000);
  const compact=buildFeishuMessageParts(unused);
  assert.ok(compact.length<10);assert.ok(compact.every(p=>!p.content.includes('example.com')));
  const used='# [链接][ref]\n\n'.repeat(400)+'[ref]: https://example.com/'+'a'.repeat(8_000);
  const bounded=buildFeishuMessageParts(used);
  assert.ok(bounded.length<=24);
  assert.ok(bounded.reduce((size,p)=>size+Buffer.byteLength(JSON.stringify({msg_type:p.msg_type,content:p.content}),'utf8'),0)<200*1024);
  assert.match(bounded.at(-1)!.plain,/Web Copilot/);
});

it('durable worker sends a long reply across batches and resumes from database checkpoints',async()=>{
  const f=fixture();const directory=mkdtempSync(join(tmpdir(),'fb-markdown-restart-'));try {
    new FeishuIntegrationRepository(f.db,f.user.id).upsertConfig({enabled:true,emergencyDisabled:false,allowedChatIds:['chat']});
    const projects=new ProjectRepository(f.db,f.user.id);
    const project=projects.create({name:'markdown',path:'/private/tmp/markdown-test',aiTool:'claude'});
    const service=new ChannelIdentityService(f.db,f.user.id,f.key),peer=f.input.peer;
    const pair=service.createPairing({channel:'feishu',accountId:f.account.id});
    const claimed=service.claimPairing(pair.token,peer);
    const identity=service.confirmPairing(claimed.id,{revision:claimed.revision,externalUserId:'owner',chatId:'chat'});
    service.createRoute({identityId:identity.id,projectId:project.id});
    const inbox=new NativeChannelInbox(f.db,f.user.id,f.key);
    inbox.receive(peer,{eventId:'event',messageId:'source',text:'report'});
    const adopted=inbox.adoptNext();assert.equal(adopted.status,'adopted');if(adopted.status!=='adopted')throw new Error('not adopted');
    const ledger=new CopilotRunLedger(f.db,f.user.id),text=longReply();
    ledger.append(adopted.runId,{role:'assistant',kind:'text',content:text});ledger.log.updateRun(adopted.runId,{status:'completed'});
    await new NativeChannelDelivery(f.db,f.user.id,f.key,f.send).runOnce(new AbortController().signal);
    assert.equal(f.calls.length,4);
    const first=new ChannelDeliveryRepository(f.db,f.user.id).listMetadata()[0]!;
    assert.equal(first.status,'pending');
    assert.equal(new ChannelDeliveryRepository(f.db,f.user.id).get(first.id)!.attempt_count,0);
    const path=join(directory,'state.sqlite');await f.db.backup(path);f.db.close();
    const restored=new Sqlite(path);
    try {
      const sender=createFeishuNativeSender(restored,f.user.id,f.key,f.io);
      for(let i=0;i<10;i++)await new NativeChannelDelivery(restored,f.user.id,f.key,sender).runOnce(new AbortController().signal);
      assert.equal(new ChannelDeliveryRepository(restored,f.user.id).listMetadata()[0]!.status,'delivered');
    }finally{restored.close();}
    assert.equal(f.calls.length,buildFeishuMessageParts(text).length);
    assert.equal(new Set(f.calls.map(call=>call.uuid)).size,f.calls.length);
    assert.ok(f.calls.length>4);
    assert.ok(f.calls.some(c=>c.content.includes('段落 11')));
  }finally{if(f.db.open)f.db.close();rmSync(directory,{recursive:true,force:true});}
});
