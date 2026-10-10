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

function fixture() {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder });
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

import express from 'express';
import { signJwt } from '../src/auth/jwt.ts';
import { createTelegramIntegrationRoutes } from '../src/routes/integrations-telegram.ts';
import { createFeishuIntegrationRoutes } from '../src/routes/integrations-feishu.ts';
for(const channel of ['feishu','telegram'] as const)it(`${channel} account/config/health/emergency HTTP preserves owner isolation and write-only credentials`,async()=>{
 const f=fixture();const secret=randomBytes(32).toString('hex');const app=express();app.locals.db=f.db;app.locals.jwtSecret=secret;app.use(express.json());
 let reconciles=0;const runtime={reconcileAccount:async()=>{reconciles++;},getHealth:()=>({state:'connected'})};
 app.use('/integration',channel==='feishu'?createFeishuIntegrationRoutes({db:f.db,masterKey:f.key,channelRuntime:runtime}):createTelegramIntegrationRoutes({db:f.db,masterKey:f.key,channelRuntime:runtime}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const addr=server.address();assert.ok(addr&&typeof addr!=='string');const base=`http://127.0.0.1:${addr.port}/integration`;
 const token=(user:typeof f.user)=>signJwt({userId:user.id,email:user.email},secret);
 const call=(path:string,method='GET',body?:unknown,user=f.user)=>fetch(base+path,{method,headers:{authorization:`Bearer ${token(user)}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  assert.equal((await fetch(base+'/account')).status,401);
  const foreign=await (await call('/account','GET',undefined,f.other)).json();assert.equal(foreign.data.account,null);
  const configured=await (await call('/account')).json();assert.equal(configured.data.account.secretConfigured,true);assert.equal(JSON.stringify(configured).includes('tg-token'),false);
  const input=channel==='feishu'?{appId:'fixture',appSecret:'new-test-secret',enabled:true}:{botToken:'new-test-token',enabled:true};
  const saved=await call('/account','PUT',input);assert.equal(saved.status,200);assert.equal(JSON.stringify(await saved.json()).includes(channel==='feishu'?'new-test-secret':'new-test-token'),false);assert.equal(reconciles,1);
  assert.equal((await call('/config','PATCH',{allowedChatIds:['123','-1001']})).status,200);
  assert.equal((await call('/config','PATCH',{allowedChatIds:Array.from({length:51},(_,i)=>String(i))})).status,400);
  assert.equal((await call('/account','PUT',{...input,unknown:true})).status,400);
  assert.equal((await call('/health')).status,200);
  assert.equal((await call('/emergency-stop','POST',{})).status,200);assert.equal(reconciles,2);
  const final=await (await call('/account')).json();assert.equal(final.data.account.enabled,false);
  const config=await (await call('/config')).json();assert.equal(config.data.config.emergencyDisabled,true);
  assert.equal((await (await call('/account','GET',undefined,f.other)).json()).data.account,null);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));f.db.close();}
});
