import assert from 'node:assert/strict';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';

const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
it('adds empty channel identity tables without activating legacy mappings', () => {
  const db = new Sqlite(':memory:');
  try {
    migrate(drizzle(db), { migrationsFolder });
    for (const table of ['channel_pairings', 'channel_identities', 'channel_routes']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} must exist`);
    }
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

import { randomBytes } from 'node:crypto';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { FeishuChannelRepository } from '../src/db/repositories/feishu-channel-repository.js';
import { FeishuIntegrationRepository } from '../src/db/repositories/feishu-integration-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ChannelIdentityService, type TrustedChannelPeer } from '../src/services/channels/channel-identity-service.js';

function fixture(path = ':memory:', folder = migrationsFolder) {
  const db = new Sqlite(path); migrate(drizzle(db), { migrationsFolder: folder });
  const user = new UserRepository(db).create('channel@test.dev', 'fixture');
  const other = new UserRepository(db).create('other@test.dev', 'fixture');
  const key = randomBytes(32).toString('hex');
  const accounts = new FeishuChannelRepository(db, user.id, key);
  const account = accounts.upsertAccount({ appId: 'fixture', appSecret: randomBytes(24).toString('hex'), enabled: true });
  const config = new FeishuIntegrationRepository(db, user.id);
  config.upsertConfig({ enabled: true, emergencyDisabled: false });
  const projects = new ProjectRepository(db, user.id);
  // Upgrade-rehearsal fixtures may predate migration 0104; ProjectRepository writes with the
  // current schema (drizzle RETURNING lists copilot_autonomy), so seed the project with raw
  // SQL on those schemas. The full-schema fixture turns the autonomy switch on so channel
  // admission passes without a grant.
  const hasAutonomyColumn = (db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>).some(column => column.name === 'copilot_autonomy');
  let project: { id: string };
  if (hasAutonomyColumn) {
    project = projects.create({ name: 'p', path: '/private/tmp/channel-project', aiTool: 'claude' });
    projects.setCopilotAutonomy(project.id, true);
  } else {
    const now = Date.now();
    db.prepare('INSERT INTO projects(id,user_id,name,path,ai_tool,status,is_imported,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('fixture-project', user.id, 'p', '/private/tmp/channel-project', 'claude', 'active', 0, now, now);
    project = { id: 'fixture-project' };
  }
  const service = new ChannelIdentityService(db, user.id, key);
  const peer: TrustedChannelPeer = { channel: 'feishu', accountId: account.id, accountRevision: account.configRevision, externalUserId: 'ou-owner', chatId: 'oc-private', chatType: 'p2p' };
  const pair = () => {
    const issued = service.createPairing({ channel: 'feishu', accountId: account.id });
    const claimed = service.claimPairing(issued.token, peer);
    return service.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId: peer.externalUserId, chatId: peer.chatId });
  };
  return { db, user, other, key, accounts, account, config, project, projects, service, peer, pair };
}

it('requires claim and exact owner confirmation; hashes tokens and rejects replay', () => {
  const f = fixture();
  try {
    const { pairing, token } = f.service.createPairing({ channel: 'feishu', accountId: f.account.id });
    assert.throws(() => f.service.confirmPairing(pairing.id, { revision: 1, externalUserId: f.peer.externalUserId, chatId: f.peer.chatId }));
    assert.equal(JSON.stringify(f.service.records.listPairings()).includes(token), false);
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM channel_pairings').all()).includes(token), false);
    const claimed = f.service.claimPairing(token, f.peer);
    assert.throws(() => f.service.claimPairing(token, f.peer));
    assert.throws(() => f.service.confirmPairing(pairing.id, { revision: claimed.revision, externalUserId: 'wrong', chatId: f.peer.chatId }));
    const identity = f.service.confirmPairing(pairing.id, { revision: claimed.revision, externalUserId: f.peer.externalUserId, chatId: f.peer.chatId });
    assert.equal(identity.status, 'active');
    assert.equal(f.service.records.listRoutes().length, 0);
    assert.throws(() => f.service.confirmPairing(pairing.id, { revision: claimed.revision, externalUserId: f.peer.externalUserId, chatId: f.peer.chatId }));
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM audit_logs').all()).includes(token), false);
  } finally { f.db.close(); }
});

it('creates a fresh project-bound route and rolls back duplicate route history', () => {
  const f = fixture();
  try {
    const identity = f.pair();
    const route = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
    assert.equal(f.service.records.route(route.id)?.projectId, f.project.id);
    assert.throws(() => f.service.createRoute({ identityId: identity.id, projectId: f.project.id }));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM copilot_conversations').get().n, 1);
    const admitted = f.service.admit(route.id, f.peer, { capability: 'project.update', projectIds: [f.project.id] });
    assert.equal(admitted.actorUserId, f.user.id);
    assert.throws(() => f.service.admit(route.id, f.peer, { capability: 'project.update', projectIds: ['foreign'] }));
    f.service.revokeRoute(route.id);
    const replacement = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
    assert.notEqual(replacement.conversationId, route.conversationId);
    assert.throws(() => f.service.admit(route.id, f.peer));
  } finally { f.db.close(); }
});

it('rejects expired, cancelled, cross-account, group and foreign-tenant claims', () => {
  const f = fixture();
  try {
    const a = f.service.createPairing({ channel: 'feishu', accountId: f.account.id });
    assert.throws(() => f.service.claimPairing(a.token, { ...f.peer, accountId: 'foreign' }));
    assert.throws(() => f.service.claimPairing(a.token, { ...f.peer, chatType: 'group' } as unknown as TrustedChannelPeer));
    assert.throws(() => new ChannelIdentityService(f.db, f.other.id, f.key).claimPairing(a.token, f.peer));
    const b = f.service.createPairing({ channel: 'feishu', accountId: f.account.id });
    assert.throws(() => f.service.claimPairing(a.token, f.peer));
    f.db.prepare('UPDATE channel_pairings SET expires_at=0 WHERE id=?').run(b.pairing.id);
    assert.throws(() => f.service.claimPairing(b.token, f.peer));
    assert.throws(() => f.service.createPairing({ channel: 'telegram', accountId: f.account.id }));
  } finally { f.db.close(); }
});

for (const change of ['expire', 'rotate', 'emergency', 'allowlist', 'cancel'] as const) {
  it(`rechecks ${change} at confirmation after claim`, () => {
    const f = fixture();
    try {
      const issued = f.service.createPairing({ channel: 'feishu', accountId: f.account.id });
      const claimed = f.service.claimPairing(issued.token, f.peer);
      if (change === 'expire') f.db.prepare('UPDATE channel_pairings SET expires_at=0 WHERE id=?').run(claimed.id);
      if (change === 'rotate') f.accounts.upsertAccount({ appId: f.account.appId, enabled: true });
      if (change === 'emergency') f.config.upsertConfig({ emergencyDisabled: true });
      if (change === 'allowlist') f.config.upsertConfig({ allowedChatIds: ['other-chat'] });
      if (change === 'cancel') f.service.cancelPairing(claimed.id);
      assert.throws(() => f.service.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId: f.peer.externalUserId, chatId: f.peer.chatId }));
      assert.equal(f.service.records.listIdentities().length, 0);
    } finally { f.db.close(); }
  });
}

for (const change of ['autonomy', 'identity', 'route', 'account', 'config', 'actor', 'history', 'peer'] as const) {
  it(`rejects stale admission after ${change} changes`, () => {
    const f = fixture();
    try {
      const identity = f.pair(); const route = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
      if (change === 'autonomy') f.projects.setCopilotAutonomy(f.project.id, false);
      if (change === 'identity') f.service.revokeIdentity(identity.id);
      if (change === 'route') f.service.revokeRoute(route.id);
      if (change === 'account') f.accounts.upsertAccount({ appId: f.account.appId, enabled: false });
      if (change === 'config') f.config.upsertConfig({ enabled: false });
      if (change === 'actor') f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id);
      if (change === 'history') f.db.prepare("UPDATE copilot_conversations SET status='deleted' WHERE id=?").run(route.conversationId);
      assert.throws(() => f.service.admit(route.id, change === 'peer' ? { ...f.peer, externalUserId: 'imposter' } : f.peer));
    } finally { f.db.close(); }
  });
}

it('permits explicit new pairing after account rotation and enforces composite tenant FKs', () => {
  const f = fixture();
  try {
    const first = f.pair(); const old = f.service.createRoute({ identityId: first.id, projectId: f.project.id });
    f.peer.accountRevision = f.accounts.upsertAccount({ appId: f.account.appId, enabled: true }).configRevision;
    const next = f.pair(); const route = f.service.createRoute({ identityId: next.id, projectId: f.project.id });
    assert.notEqual(route.conversationId, old.conversationId);
    assert.throws(() => f.service.admit(old.id, f.peer));
    assert.ok(f.service.admit(route.id, f.peer));

    assert.throws(() => f.db.prepare('UPDATE channel_routes SET user_id=? WHERE id=?').run(f.other.id, route.id), /FOREIGN KEY/);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.db.close(); }
});

import { createServer } from '../src/server.js';
import { createServer as httpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { signJwt } from '../src/auth/jwt.js';
import { InMemoryApiKeyStore } from '../src/secrets/api-key-store.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { RuntimeAuthorizationInvalidator } from '../src/services/runtime-authorization-invalidation.js';

it('serves authenticated owner management through the mounted Gateway, without a public claim endpoint', async () => {
  const f = fixture();
  const jwtSecret = randomBytes(32).toString('hex');
  const app = createServer({ db: f.db, masterKey: f.key, jwtSecret,
    sessionManager: {} as InMemorySessionManager, apiKeyStore: new InMemoryApiKeyStore({ masterKey: f.key }),
    eventBus: new ForgeBadgerEventBus(), runtimeAuthorizationInvalidator: new RuntimeAuthorizationInvalidator() });
  const server = httpServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/copilot/channels`;
  const request = (path: string, body?: unknown, userId = f.user.id) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${signJwt({ userId, email: 'fixture@test.dev' }, jwtSecret)}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  try {
    assert.equal((await fetch(base + '/identities')).status, 401);
    assert.equal((await request('/deliveries')).status, 200);
    assert.deepEqual((await (await request('/deliveries', undefined, f.other.id)).json()).data.deliveries, []);
    // Telegram is a valid channel platform now; the feishu account id is unknown to it, so authority rejects it.
    assert.equal((await request('/pairings', { channel: 'telegram', accountId: f.account.id })).status, 403);
    const issuedResponse = await request('/pairings', { channel: 'feishu', accountId: f.account.id });
    assert.equal(issuedResponse.status, 201);
    assert.equal(issuedResponse.headers.get('cache-control'), 'no-store');
    const issued = (await issuedResponse.json()).data;
    assert.equal((await request('/pairings/claim', { token: issued.token, ...f.peer })).status, 404);
    const listing = await (await request('/pairings')).text();
    assert.equal(listing.includes(issued.token), false);
    const claimed = f.service.claimPairing(issued.token, f.peer);
    const confirmation = { revision: claimed.revision, externalUserId: f.peer.externalUserId, chatId: f.peer.chatId };
    assert.equal((await request(`/pairings/${claimed.id}/confirm`, confirmation, f.other.id)).status, 403);
    const confirmed = await request(`/pairings/${claimed.id}/confirm`, confirmation);
    assert.equal(confirmed.status, 200);
    const identity = (await confirmed.json()).data.identity;
    const created = await request('/routes', { identityId: identity.id, projectId: f.project.id });
    assert.equal(created.status, 201);
    const route = (await created.json()).data.route;
    assert.deepEqual((await (await request('/routes', undefined, f.other.id)).json()).data.routes, []);
    assert.equal((await request(`/identities/${identity.id}/revoke`, {}, f.other.id)).status, 403);
    assert.ok(f.service.admit(route.id, f.peer));

    const diagnosticsInbox=new NativeChannelInbox(f.db,f.user.id,f.key);
    diagnosticsInbox.receive(f.peer,{eventId:'diagnostic-event',messageId:'diagnostic-message',text:'private prompt'});
    const adopted=diagnosticsInbox.adoptNext();assert.equal(adopted.status,'adopted');
    if(adopted.status==='adopted')new CopilotRunLedger(f.db,f.user.id).log.updateRun(adopted.runId,{status:'completed'});
    new NativeChannelDelivery(f.db,f.user.id,f.key,async()=>{throw new Error('must not send');}).project();
    const metadataResponse=await request('/deliveries');assert.equal(metadataResponse.headers.get('cache-control'),'no-store');
    const metadata=(await metadataResponse.json()).data.deliveries;assert.equal(metadata.length,1);
    assert.deepEqual(Object.keys(metadata[0]).sort(),['createdAt','id','inboxId','phase','receiptRecorded','status']);
    assert.equal(JSON.stringify(metadata).includes('private prompt'),false);
    assert.deepEqual((await (await request('/deliveries',undefined,f.other.id)).json()).data.deliveries,[]);
    assert.equal((await request(`/identities/${identity.id}/revoke`, {})).status, 200);
    assert.throws(() => f.service.admit(route.id, f.peer));
    f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id);
    assert.equal((await request('/routes')).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    f.db.close();
  }
});

import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

it('upgrades populated main schema, preserves route revocation and restores a pre-upgrade backup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fb-channel-migration-'));
  const prior = join(directory, 'prior');
  cpSync(migrationsFolder, prior, { recursive: true });
  const journalPath = join(prior, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = entriesBefore(journal.entries, '0078_channel_identity_routes');
  writeFileSync(journalPath, JSON.stringify(journal));
  const path = join(directory, 'rehearsal.db');
  const f = fixture(path, prior);
  f.db.prepare('INSERT INTO sessions(id,user_id,project_id,name,ai_tool,status,working_dir,runtime_session_name,last_prompt) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('migration-session',f.user.id,f.project.id,'Existing session','claude','running',directory,'fb-preserved-runtime','保留现有会话提示词');
  const backupPath=join(directory,'before.db');
  await f.db.backup(backupPath);
  const names = (f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'").all() as Array<{ name: string }>).map(row => row.name);
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const tableColumns = (source: Sqlite.Database, table: string) =>
    (source.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{ name: string }>).map((column) => column.name);
  const originalNames = names.map((name) => tableColumns(f.db, name));
  const selectRows = (source: Sqlite.Database, columns: string[][]) =>
    names.map((name, index) => {
      const cols = columns[index] as string[];
      // 0105 drops copilot_grants/copilot_conversation_grants entirely; a table with no
      // surviving columns contributes no rows to the comparison.
      return cols.length === 0 ? [] : source.prepare(`SELECT ${cols.map(quote).join(',')} FROM ${quote(name)}`).all();
    });
  const before = selectRows(f.db, originalNames);
  let db: Sqlite.Database = f.db;
  try {
    migrate(drizzle(db), { migrationsFolder });
    // A deliberately destructive migration (e.g. 0083 dropping the retired
    // feishu_refs_json columns) removes columns by decision; the rehearsal
    // still requires every surviving column's rows to remain byte-identical.
    const survivingNames = originalNames.map((columns, index) => {
      const current = new Set(tableColumns(db, names[index] as string));
      return columns.filter((column) => current.has(column));
    });
    const projectRows = (rowSets: unknown[][]) =>
      rowSets.map((rowSet, index) =>
        (rowSet as Array<Record<string, unknown>>).map((row) =>
          Object.fromEntries((survivingNames[index] as string[]).map((column) => [column, row[column]]))
        )
      );
    assert.deepEqual(projectRows(selectRows(db, survivingNames)), projectRows(before), 'all pre-existing table rows must remain unchanged');
    const applied=db.prepare('SELECT * FROM __drizzle_migrations').all();
    migrate(drizzle(db), { migrationsFolder });
    assert.deepEqual(db.prepare('SELECT * FROM __drizzle_migrations').all(),applied,'upgrade must be idempotent');
    cpSync(backupPath,join(directory,'restored.db'));
    const restored=new Sqlite(join(directory,'restored.db'));
    try {
      assert.deepEqual(selectRows(restored, originalNames),before,'restored synthetic backup must preserve every original row');
      assert.equal(restored.prepare("SELECT count(*) n FROM sqlite_master WHERE name='channel_identities'").get().n,0);
      assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[]);
      assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    } finally { restored.close(); }
    assert.equal(db.prepare('SELECT count(*) AS n FROM channel_identities').get().n, 0);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    new ProjectRepository(db, f.user.id).setCopilotAutonomy(f.project.id, true);
    const identity = f.pair(); const route = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
    db.close(); db = new Sqlite(path);
    let service = new ChannelIdentityService(db, f.user.id, f.key);
    assert.ok(service.admit(route.id, f.peer));
    service.revokeIdentity(identity.id);
    db.close(); db = new Sqlite(path);
    service = new ChannelIdentityService(db, f.user.id, f.key);
    assert.throws(() => service.admit(route.id, f.peer));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

for (const claimed of [false, true]) {
  it(`revoking identity invalidates an outstanding ${claimed ? 'claimed' : 'pending'} pairing`, () => {
    const f = fixture();
    try {
      const identity = f.pair();
      const issued = f.service.createPairing({ channel: 'feishu', accountId: f.account.id });
      const candidate = claimed ? f.service.claimPairing(issued.token, f.peer) : undefined;
      f.service.revokeIdentity(identity.id);
      assert.equal(f.service.records.pairing(issued.pairing.id)?.status, 'cancelled');
      assert.throws(() => f.service.claimPairing(issued.token, f.peer));
      if (candidate) assert.throws(() => f.service.confirmPairing(candidate.id, { revision: candidate.revision, externalUserId: f.peer.externalUserId, chatId: f.peer.chatId }));
      const newIdentity = f.pair();
      assert.notEqual(newIdentity.id, identity.id);
    } finally { f.db.close(); }
  });
}

it('rejects a foreign project without leaving a conversation or route', () => {
  const f = fixture();
  try {
    const identity = f.pair();
    f.db.prepare('INSERT INTO projects(id,user_id,name,path,ai_tool,status,is_imported,copilot_autonomy,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('foreign-project', f.other.id, 'foreign', '/private/tmp/foreign-channel-project', 'claude', 'active', 0, 0, Date.now(), Date.now());
    assert.throws(() => f.service.createRoute({ identityId: identity.id, projectId: 'foreign-project' }));
    assert.equal(f.service.records.listRoutes().length, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM copilot_conversations').get().n, 0);
  } finally { f.db.close(); }
});

import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
it('native admission cannot bypass a revoked channel route through a Web conversation', () => {
  const f = fixture();
  try {
    const identity = f.pair();
    const route = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
    f.service.revokeRoute(route.id);
    assert.throws(() => new CopilotRunLedger(f.db, f.user.id).admit({ userId: f.user.id, conversationId: route.conversationId, userText: 'bypass route' }, 2));
  } finally { f.db.close(); }
});

import { NativeChannelInbox, createFeishuNativeIngress } from '../src/services/channels/native-channel-inbox.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import type { PlatformCommand } from '../src/services/platform-commands/types.js';
import { z } from 'zod';

function inboxFixture(path?:string) {
  const f=fixture(path); const identity=f.pair();
  const route=f.service.createRoute({identityId:identity.id,projectId:f.project.id});
  return {...f,identity,route,inbox:new NativeChannelInbox(f.db,f.user.id,f.key)};
}
const incoming=(suffix:string,text='Check project progress')=>({eventId:`event-${suffix}`,messageId:`message-${suffix}`,text});
const llmFixture:AgentLlmClient={
  stream:async request=>{request.onEvent({type:'text_delta',text:'Project summary'});return {message:'Project summary'};},
  summarize:async()=> 'Summary',generateTitle:async()=> 'Title',proposeMemory:async()=>[]
};

it('durably deduplicates encrypted input and adopts FIFO once into real native runs', async()=>{
  const f=inboxFixture();
  try {
    const first=f.inbox.receive(f.peer,incoming('1'));
    assert.equal(f.inbox.receive(f.peer,incoming('1')).id,first.id);
    assert.equal(f.inbox.receive(f.peer,{...incoming('1'),eventId:'redelivery-event'}).id,first.id);
    assert.throws(()=>f.inbox.receive(f.peer,incoming('1','changed text')));
    const second=f.inbox.receive(f.peer,incoming('2'));
    assert.throws(()=>f.inbox.receive(f.peer,{...incoming('2'),eventId:'event-1'}));
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM channel_messages').all()).includes('Check project progress'),false);
    const adopted=f.inbox.adoptNext(); assert.equal(adopted.status,'adopted'); if(adopted.status!=='adopted')return;
    assert.equal(adopted.messageId,first.id);
    assert.equal(f.inbox.adoptNext().status,'idle');
    const orchestrator=createCopilotOrchestrator({db:f.db,masterKey:f.key,eventBus:new ForgeBadgerEventBus(),toolRegistry:createAgentToolRegistry([]),llm:llmFixture});
    await orchestrator.executeRun(f.user.id,adopted.runId);
    assert.equal(f.inbox.result(first.id,f.peer).status,'completed');
    assert.ok(f.inbox.result(first.id,f.peer).messages.some(message=>message.content==='Project summary'));
    const next=f.inbox.adoptNext(); assert.equal(next.status,'adopted');
    if(next.status==='adopted')assert.equal(next.messageId,second.id);
    assert.equal(f.inbox.receive(f.peer,incoming('1')).id,first.id);
    assert.equal(new CopilotRunLedger(f.db,f.user.id).log.listRuns(f.route.conversationId).length,2);
  }finally{f.db.close();}
});

it('keeps pairing tokens out of native storage and ignores group events',()=>{
  const f=fixture();
  try {
    const issued=f.service.createPairing({channel:'feishu',accountId:f.account.id});
    const handle=createFeishuNativeIngress({db:f.db,userId:f.user.id,masterKey:f.key,accountId:f.account.id,accountRevision:f.account.configRevision});
    const event=(text:string,chatType='p2p')=>({sender:{sender_id:{open_id:f.peer.externalUserId}},message:{message_id:'pair-message',chat_id:f.peer.chatId,chat_type:chatType,message_type:'text',content:JSON.stringify({text})}});
    assert.equal(handle(event('ignored','group'),{botOpenId:'bot'}).status,'ignored');
    assert.throws(()=>handle(event('/pair invalid'),{botOpenId:'bot'}));
    assert.equal(handle(event('/pair '+issued.token),{botOpenId:'bot'}).status,'pairing_claimed');
    assert.throws(()=>handle(event('/pair '+issued.token),{botOpenId:'bot'}));
    assert.equal(f.db.prepare('SELECT count(*) n FROM channel_messages').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM copilot_messages').get().n,0);
  }finally{f.db.close();}
});

it('rejects pending and result access after revocation without calling a model',()=>{
  const f=inboxFixture();
  try {
    const item=f.inbox.receive(f.peer,incoming('1'));
    f.service.revokeIdentity(f.identity.id);
    assert.equal(f.inbox.adoptNext().status,'rejected');
    assert.throws(()=>f.inbox.result(item.id,f.peer));
    assert.equal(f.db.prepare('SELECT count(*) n FROM copilot_runs').get().n,0);
  }finally{f.db.close();}
});

it('does not release late model content or execute tool calls after route revocation',async()=>{
  const f=inboxFixture();
  try {
    let release!:()=>void; let started!:()=>void;
    const startedPromise=new Promise<void>(resolve=>{started=resolve;});
    const wait=new Promise<void>(resolve=>{release=resolve;});
    const item=f.inbox.receive(f.peer,incoming('1'));const admitted=f.inbox.adoptNext();assert.equal(admitted.status,'adopted');if(admitted.status!=='adopted')return;
    let toolCalls=0;
    const runtime=createCopilotOrchestrator({db:f.db,masterKey:f.key,eventBus:new ForgeBadgerEventBus(),
      toolRegistry:createAgentToolRegistry([{name:'list_projects',description:'test',risk:'read',requiresApproval:false,inputSchema:z.object({}),execute:async()=>{toolCalls++;return [];}}]),
      llm:{...llmFixture,stream:async request=>{started();await wait;request.onEvent({type:'text_delta',text:'must not escape'});request.onEvent({type:'tool_call',toolCall:{id:'call',name:'list_projects',arguments:'{}'}});return {message:'late'};}}});
    const running=runtime.executeRun(f.user.id,admitted.runId);await startedPromise;
    f.service.revokeRoute(f.route.id);release();await running;
    assert.equal(toolCalls,0);
    assert.equal(new CopilotRunLedger(f.db,f.user.id).get(admitted.runId)?.status,'failed');
    assert.equal(new CopilotRunLedger(f.db,f.user.id).log.listRunMessages(admitted.runId).some(message=>message.content.includes('must not escape')),false);
    assert.throws(()=>f.inbox.result(item.id,f.peer));
  }finally{f.db.close();}
});

for(const removeOrigin of [false,true]) {
  it(`blocks direct platform effects when channel ${removeOrigin?'origin is missing':'route is revoked'}`,async()=>{
    const f=inboxFixture();
    try {
      const admittedMessage=f.inbox.receive(f.peer,incoming('1'));const adopted=f.inbox.adoptNext();assert.equal(adopted.status,'adopted');if(adopted.status!=='adopted')return;
      const ledger=new CopilotRunLedger(f.db,f.user.id);
      const step=ledger.addStep(adopted.runId,{kind:'tool',toolName:'test',toolCallId:'test-call',inputJson:'{}',effect:'write'});
      let effects=0;
      const command:PlatformCommand={id:'test',capability:'project.update',effect:'database',inputSchema:z.object({}),resolve:()=>({projectIds:[f.project.id],revision:'1'}),execute:()=>{effects++;return {};}};
      const actions=new PlatformActions({db:f.db,userId:f.user.id,actionOrigin:{kind:'copilot',runId:adopted.runId,stepId:step.id}},new Map([['test',command]]));
      const intent=actions.preview({commandId:'test',input:{},idempotencyKey:step.id});
      assert.equal(intent.channel_conversation_id,f.route.conversationId);
      if(removeOrigin)f.db.prepare('DELETE FROM copilot_run_steps WHERE user_id=? AND id=?').run(f.user.id,step.id);
      else f.service.revokeRoute(f.route.id);
      await assert.rejects(actions.execute(intent.id));
      assert.equal(effects,0);
      assert.ok(admittedMessage.id);
    }finally{f.db.close();}
  });
}

it('reopens pending/adopted messages without creating duplicate native runs',()=>{
  const directory=mkdtempSync(join(tmpdir(),'fb-native-inbox-'));const path=join(directory,'test.db');const f=inboxFixture(path);
  let db:Sqlite.Database=f.db;
  try {
    const first=f.inbox.receive(f.peer,incoming('1'));const second=f.inbox.receive(f.peer,incoming('2'));
    const adopted=f.inbox.adoptNext();assert.equal(adopted.status,'adopted');
    db.close();db=new Sqlite(path);const inbox=new NativeChannelInbox(db,f.user.id,f.key);
    assert.equal(inbox.receive(f.peer,incoming('1')).id,first.id);
    assert.equal(inbox.messages.get(first.id)?.status,'adopted');assert.equal(inbox.messages.get(second.id)?.status,'pending');
    assert.equal(inbox.adoptNext().status,'idle');
    assert.equal(db.prepare('SELECT count(*) n FROM copilot_runs').get().n,1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

it('remembers a redelivery event alias so it cannot be reused for a different message',()=>{
  const f=inboxFixture();
  try {
    f.inbox.receive(f.peer,incoming('1'));
    f.inbox.receive(f.peer,{...incoming('1'),eventId:'alias-event'});
    assert.throws(()=>f.inbox.receive(f.peer,{...incoming('2'),eventId:'alias-event'}));
  }finally{f.db.close();}
});

it('does not recover a missing channel route as an unrestricted conversation',()=>{
  const f=inboxFixture();
  try {
    f.db.prepare('DELETE FROM channel_routes WHERE user_id=? AND id=?').run(f.user.id,f.route.id);
    assert.throws(()=>new CopilotRunLedger(f.db,f.user.id).admit({userId:f.user.id,conversationId:f.route.conversationId,userText:'missing binding'},2));
  }finally{f.db.close();}
});

it('does not let a busy route starve a separate route',()=>{
  const f=inboxFixture();
  try {
    f.inbox.receive(f.peer,incoming('busy-0'));assert.equal(f.inbox.adoptNext().status,'adopted');
    for(let i=1;i<=20;i++)f.inbox.receive(f.peer,incoming(`busy-${i}`));
    const peer={...f.peer,externalUserId:'second-peer',chatId:'second-private-chat'};
    const issued=f.service.createPairing({channel:'feishu',accountId:f.account.id});const claimed=f.service.claimPairing(issued.token,peer);
    const identity=f.service.confirmPairing(claimed.id,{revision:claimed.revision,externalUserId:peer.externalUserId,chatId:peer.chatId});
    f.service.createRoute({identityId:identity.id,projectId:f.project.id});
    const item=f.inbox.receive(peer,incoming('unblocked'));
    const adopted=f.inbox.adoptNext();assert.equal(adopted.status,'adopted');if(adopted.status==='adopted')assert.equal(adopted.messageId,item.id);
  }finally{f.db.close();}
});

it('preserves duplicate receipts at the pending backlog limit',()=>{
  const f=inboxFixture();
  try {
    const item=f.inbox.receive(f.peer,incoming('first'));
    f.db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<999)
      INSERT INTO channel_messages(id,user_id,route_id,account_id,event_id,message_id,payload_encrypted,payload_digest,created_at)
      SELECT 'fill-'||x,?,?,?,'fill-event-'||x,'fill-message-'||x,'fixture','fixture',? FROM n`).run(f.user.id,f.route.id,f.account.id,Date.now());
    assert.equal(f.inbox.receive(f.peer,incoming('first')).id,item.id);
    assert.throws(()=>f.inbox.receive(f.peer,incoming('overflow')),/CHANNEL_BACKLOG_FULL/);
  }finally{f.db.close();}
});

it('blocks approval resumption after channel revocation before changing its pending decision',async()=>{
  const f=inboxFixture();
  try {
    f.inbox.receive(f.peer,incoming('1'));const adopted=f.inbox.adoptNext();if(adopted.status!=='adopted')return assert.fail('admission required');
    const ledger=new CopilotRunLedger(f.db,f.user.id);const claim=ledger.claim(adopted.runId,'owner',30000)!;
    const step=ledger.addStep(adopted.runId,{kind:'tool',toolName:'test',toolCallId:'approve-call',inputJson:'{}',effect:'write'});
    ledger.waitApproval(claim,step);const action=ledger.log.listPendingActions(adopted.runId)[0]!;
    f.service.revokeRoute(f.route.id);
    const runtime=createCopilotOrchestrator({db:f.db,masterKey:f.key,eventBus:new ForgeBadgerEventBus(),toolRegistry:createAgentToolRegistry([{name:'test',description:'test',risk:'write',requiresApproval:true,inputSchema:z.object({}),execute:async()=>[]}]),llm:llmFixture});
    await assert.rejects(runtime.resumeAfterApproval({userId:f.user.id,runId:adopted.runId,actionId:action.id,approved:true}));
    assert.equal(ledger.log.getPendingAction(action.id)?.status,'pending');
  }finally{f.db.close();}
});

it('rechecks authority at an external command fence after an await',async()=>{
  const f=inboxFixture();
  try {
    f.inbox.receive(f.peer,incoming('1'));const adopted=f.inbox.adoptNext();if(adopted.status!=='adopted')return assert.fail('admission required');
    const step=new CopilotRunLedger(f.db,f.user.id).addStep(adopted.runId,{kind:'tool',toolName:'external',toolCallId:'external',inputJson:'{}',effect:'write'});
    let release!:()=>void;let started!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});const began=new Promise<void>(resolve=>{started=resolve;});let effects=0;
    const command:PlatformCommand={id:'test',capability:'project.update',effect:'external',inputSchema:z.object({}),resolve:()=>({projectIds:[f.project.id],revision:'1'}),
      execute:async context=>{started();await waiting;context.authorize?.();effects++;return {};}};
    const actions=new PlatformActions({db:f.db,userId:f.user.id,actionOrigin:{kind:'copilot',runId:adopted.runId,stepId:step.id}},new Map([['test',command]]));
    const intent=actions.preview({commandId:'test',input:{},idempotencyKey:step.id});
    const executing=actions.execute(intent.id);const rejected=assert.rejects(executing);await began;
    f.service.revokeRoute(f.route.id);release();await rejected;assert.equal(effects,0);
  }finally{f.db.close();}
});

it('backfills channel ownership and action provenance on identity-schema upgrade',()=>{
  const directory=mkdtempSync(join(tmpdir(),'fb-channel-backfill-'));const prior=join(directory,'prior');cpSync(migrationsFolder,prior,{recursive:true});
  const journalFile=join(prior,'meta/_journal.json');const journal=JSON.parse(readFileSync(journalFile,'utf8'));journal.entries=entriesBefore(journal.entries,'0079_native_channel_messages');writeFileSync(journalFile,JSON.stringify(journal));
  const f=fixture(':memory:',prior);
  try {
    const conversationId='historical-channel-conversation';const identityId='historical-channel-identity';const routeId='historical-channel-route';const legacyGrantId='historical-grant';
    f.db.prepare("INSERT INTO copilot_grants(id,user_id,actor_user_id,name,status,revision,scope_json,expires_at,max_actions,max_concurrency,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(legacyGrantId,f.user.id,f.user.id,'historical','active',1,'[]',Date.now()+600000,5,1,Date.now());
    f.db.prepare("INSERT INTO copilot_conversations(id,user_id,title,status,created_at,updated_at) VALUES (?,?,'channel','active',?,?)").run(conversationId,f.user.id,Date.now(),Date.now());
    f.db.prepare('INSERT INTO copilot_conversation_grants(conversation_id,user_id,grant_id,created_at) VALUES (?,?,?,?)').run(conversationId,f.user.id,legacyGrantId,Date.now());
    f.db.prepare('INSERT INTO channel_identities(id,user_id,channel,account_id,account_revision,external_user_id,chat_id,created_at) VALUES (?,?,\'feishu\',?,?,?,?,?)').run(identityId,f.user.id,f.account.id,f.account.configRevision,f.peer.externalUserId,f.peer.chatId,Date.now());
    f.db.prepare('INSERT INTO channel_routes(id,user_id,identity_id,grant_id,grant_revision,conversation_id,created_at) VALUES (?,?,?,?,?,?,?)').run(routeId,f.user.id,identityId,legacyGrantId,1,conversationId,Date.now());
    const log=new CopilotRunLedger(f.db,f.user.id).log;const run=log.createRun(conversationId, {});
    f.db.prepare("INSERT INTO copilot_run_steps(id,user_id,run_id,ordinal,kind,status,effect) VALUES ('old-step',?,?,1,'tool','pending','write')").run(f.user.id,run.id);
    f.db.prepare("INSERT INTO platform_action_intents(id,user_id,actor_user_id,grant_id,grant_revision,authority,command_id,input_json,digest,resources_json,policy_version,expires_at,idempotency_key,status,created_at) VALUES ('old-intent',?,?,?,1,'delegated_grant','test','{}','digest','{}',1,?,'old-step','approved',?)").run(f.user.id,f.user.id,legacyGrantId,Date.now()+60000,Date.now());
    migrate(drizzle(f.db),{migrationsFolder});
    assert.equal(f.db.prepare('SELECT channel_owned FROM copilot_conversations WHERE id=?').get(conversationId).channel_owned,1);
    assert.equal(f.db.prepare("SELECT channel_conversation_id FROM platform_action_intents WHERE id='old-intent'").get().channel_conversation_id,conversationId);
    assert.throws(()=>new CopilotRunLedger(f.db,f.user.id).validateScope({userId:f.user.id,conversationId,userText:'missing route'}));
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.db.close();rmSync(directory,{recursive:true,force:true});}
});

it('keeps native delivery records separate from historical Feishu queues',()=>{
  const f=inboxFixture();
  try {
    assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channel_deliveries'").get());
  }finally{f.db.close();}
});

import { NativeChannelDelivery } from '../src/services/channels/native-channel-delivery.js';
import { ChannelDeliveryRepository } from '../src/db/repositories/channel-delivery-repository.js';
import { createFeishuNativeSender } from '../src/services/integrations/feishu-native-sender.js';

function completedInput(f:ReturnType<typeof inboxFixture>,suffix='delivery') {
  const receipt=f.inbox.receive(f.peer,incoming(suffix));
  const adoption=f.inbox.adoptNext();assert.equal(adoption.status,'adopted');if(adoption.status!=='adopted')throw new Error('fixture');
  const log=new CopilotRunLedger(f.db,f.user.id).log;
  new CopilotRunLedger(f.db,f.user.id).append(adoption.runId,{role:'assistant',kind:'text',content:'Delivered project summary'});
  log.updateRun(adoption.runId,{status:'completed'});
  return {...receipt,runId:adoption.runId,log};
}
it('projects encrypted results once and does not resend delivered or unknown outcomes',async()=>{
  const f=inboxFixture();
  try {
    completedInput(f);let sends=0;
    const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,async input=>{input.authorize();sends++;assert.equal(input.text,'Delivered project summary');return {status:'delivered',messageId:'om-result'};});
    await worker.runOnce(new AbortController().signal);await worker.runOnce(new AbortController().signal);
    assert.equal(sends,1);assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM channel_deliveries').all()).includes('Delivered project summary'),false);
    completedInput(f,'unknown');const unknown=new NativeChannelDelivery(f.db,f.user.id,f.key,async()=>{sends++;throw new Error('uncertain transport');});
    await unknown.runOnce(new AbortController().signal);await unknown.runOnce(new AbortController().signal);
    assert.equal(sends,2);assert.equal(f.db.prepare("SELECT count(*) n FROM channel_deliveries WHERE status='unknown'").get().n,1);
  }finally{f.db.close();}
});
for(const invalidation of ['revoke','expired','stop'] as const) it(`does not send after token wait and ${invalidation}`,async()=>{
  const f=inboxFixture();let release!:()=>void;const gate=new Promise<void>(r=>release=r);let started!:()=>void;const began=new Promise<void>(r=>started=r);
  const controller=new AbortController();let messages=0;
  try {
    completedInput(f);
    const sender=createFeishuNativeSender(f.db,f.user.id,f.key,{validate:async()=>{},fetch:async url=>{
      if(String(url).includes('/auth/')){started();await gate;return Response.json({code:0,tenant_access_token:'fixture-token'});}
      messages++;return Response.json({code:0,data:{message_id:'om-result'}});
    }});
    const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,sender);const running=worker.runOnce(controller.signal);await began;
    if(invalidation==='revoke')f.service.revokeRoute(f.route.id);
    if(invalidation==='expired') {f.db.prepare("UPDATE channel_deliveries SET lease_until=0").run();worker.records.claim();}
    if(invalidation==='stop'){controller.abort();f.db.close();}
    release();await running;assert.equal(messages,0);
    if(invalidation==='expired')assert.equal(f.db.prepare('SELECT status FROM channel_deliveries').get().status,'unknown');
  }finally{release?.();if(f.db.open)f.db.close();}
});
it('cancels obsolete approval notices and deduplicates each pending decision separately',async()=>{
  const f=inboxFixture();
  try {
    const run=completedInput(f);run.log.updateRun(run.runId,{status:'awaiting_approval'});
    const first=run.log.createPendingAction({runId:run.runId,tool:'project.update',inputJson:'{"private":"do not expose"}',inputDigest:'fixture'});
    const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,async input=>{input.authorize();assert.equal(input.text.includes('private'),false);return {status:'delivered',messageId:'om-approval'};});
    worker.project();run.log.decidePendingAction(first.id,'approved');
    await worker.runOnce(new AbortController().signal);
    assert.equal(f.db.prepare('SELECT status FROM channel_deliveries').get().status,'cancelled');
    run.log.createPendingAction({runId:run.runId,tool:'project.update',inputJson:'{}',inputDigest:'fixture'});
    await worker.runOnce(new AbortController().signal);await worker.runOnce(new AbortController().signal);
    assert.equal(f.db.prepare('SELECT count(*) n FROM channel_deliveries').get().n,2);
  }finally{f.db.close();}
});

import { createGatewayApp } from '../src/server.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { InMemoryApiKeyStore } from '../src/secrets/api-key-store.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import type { FeishuSdkEventHandlers } from '../src/services/integrations/feishu-sdk.js';

it('default Gateway composition receives, adopts, executes and delivers without consuming legacy outbox',async()=>{
  const f=inboxFixture();let handlers:FeishuSdkEventHandlers|undefined;let sends=0;let closed=0;
  const legacy=f.accounts.enqueueOutbox({accountId:f.account.id,idempotencyKey:'historical',chatId:f.peer.chatId,payload:'historical payload'});
  const models=new ModelProviderRepository(f.db,f.user.id,f.key);
  const provider=models.createProviderProfile({name:'fixture',providerKey:'fixture',baseUrl:'https://8.8.8.8',apiFormat:'openai',authType:'api_key',supportedAdapters:['opencode']});
  models.createCredential({providerProfileId:provider.id,label:'fixture',plaintextSecret:'fixture-key'});
  models.createModelProfile({providerProfileId:provider.id,name:'fixture',modelId:'fixture',capabilities:['chat'],isDefault:true});
  const app=createGatewayApp({db:f.db,masterKey:f.key,jwtSecret:randomBytes(32).toString('hex'),sessionServerIpcPath:'/private/tmp/forgebadger-channel-test.sock',
    sessionManager:new InMemorySessionManager({async listSessions(){return[];},async createSession(){},async killSession(){},async capturePane(){return '';}} as never),
    apiKeyStore:new InMemoryApiKeyStore({masterKey:f.key}),llmFetch:async()=>Response.json({choices:[{message:{content:'Native end-to-end fixture result'}}]}),
    nativeFeishuIO:{sdkFactory:{createWebSocketClient:(_config,callbacks,incomingHandlers)=>{handlers=incomingHandlers;return {start:async()=>{callbacks.onReady?.();},close:()=>{closed++;},getConnectionStatus:()=>({state:'connected',reconnectAttempts:0})};}},
      validate:async()=>{},fetch:async url=>{
        if(String(url).includes('/auth/'))return Response.json({code:0,tenant_access_token:'fixture-token'});
        sends++;return Response.json({code:0,data:{message_id:'om-composed'}});
      }}
  });
  try {
    await app.recoveryReady;
    for(let n=0;!handlers && n<50;n++)await new Promise(r=>setTimeout(r,10));
    assert.ok(handlers?.onMessage);
    const event={sender:{sender_id:{open_id:f.peer.externalUserId}},message:{message_id:'composed-message',chat_id:f.peer.chatId,chat_type:'p2p',message_type:'text',content:JSON.stringify({text:'Summarize the project'})}};
    await handlers.onMessage(event,{botOpenId:'bot'});await handlers.onMessage(event,{botOpenId:'bot'});
    for(let n=0;sends===0 && n<120;n++)await new Promise(r=>setTimeout(r,100));
    assert.equal(sends,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM channel_messages').get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM copilot_runs').get().n,1);
    assert.equal(f.db.prepare('SELECT status FROM copilot_runs').get().status,'completed');
    assert.equal(f.db.prepare('SELECT status FROM channel_deliveries').get().status,'delivered');
    assert.equal(f.accounts.getOutbox(legacy.id)?.status,'pending');
  }finally{await app.close();assert.equal(closed,1);}
  await handlers?.onMessage?.({},{botOpenId:'bot'}); // stale closure after DB close must be inert
});

it('preserves pending deliveries across reopen and quarantines expired sending claims',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'fb-delivery-reopen-'));const path=join(dir,'state.db');const f=inboxFixture(path);
  try {
    completedInput(f);const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,async()=>({status:'delivered',messageId:'om'}));worker.project();
    f.db.close();const db=new Sqlite(path);
    try {
      let sends=0;const reopened=new NativeChannelDelivery(db,f.user.id,f.key,async input=>{input.authorize();sends++;return {status:'delivered',messageId:'om'};});
      await reopened.runOnce(new AbortController().signal);assert.equal(sends,1);
      db.prepare("UPDATE channel_deliveries SET status='sending',claim_token='old',lease_until=0").run();
      await reopened.runOnce(new AbortController().signal);assert.equal(sends,1);
      assert.equal(db.prepare('SELECT status FROM channel_deliveries').get().status,'unknown');
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{db.close();}
  }finally{if(f.db.open)f.db.close();rmSync(dir,{recursive:true,force:true});}
});

for(const outcome of ['success','rejected','missing','network'] as const) it(`classifies official send ${outcome} without automatic replay`,async()=>{
  const f=inboxFixture();let sends=0;
  try {
    completedInput(f);
    const sender=createFeishuNativeSender(f.db,f.user.id,f.key,{validate:async()=>{},fetch:async url=>{
      if(String(url).includes('/auth/'))return Response.json({code:0,tenant_access_token:'fixture'});
      sends++;
      if(outcome==='network')throw new Error('private network failure');
      return Response.json(outcome==='success'?{code:0,data:{message_id:'om-ok'}}:outcome==='rejected'?{code:230002,msg:'private error'}:{code:0});
    }});
    const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,sender);
    await worker.runOnce(new AbortController().signal);await worker.runOnce(new AbortController().signal);
    assert.equal(sends,1);
    assert.equal(f.db.prepare('SELECT status FROM channel_deliveries').get().status,outcome==='success'?'delivered':outcome==='rejected'?'failed':'unknown');
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM channel_deliveries').all()).includes('private'),false);
  }finally{f.db.close();}
});
it('does not let a late receipt overwrite an expired claim',async()=>{
  const f=inboxFixture();let release!:()=>void;const gate=new Promise<void>(r=>release=r);let started!:()=>void;const began=new Promise<void>(r=>started=r);
  try {
    completedInput(f);const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,async input=>{input.authorize();started();await gate;return {status:'delivered',messageId:'late'};});
    const running=worker.runOnce(new AbortController().signal);await began;
    f.db.prepare('UPDATE channel_deliveries SET lease_until=0').run();worker.records.claim();release();await running;
    assert.equal(f.db.prepare('SELECT status FROM channel_deliveries').get().status,'unknown');
  }finally{release?.();f.db.close();}
});
it('bounds encoded reply size and skips already projected history',async()=>{
  const f=inboxFixture();
  try {
    const run=completedInput(f);
    new CopilotRunLedger(f.db,f.user.id).append(run.runId,{role:'assistant',kind:'text',content:'汉字"\\\n'.repeat(20_000)});
    let sent='';const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,async input=>{sent=input.text;return {status:'delivered',messageId:'om'};});
    await worker.runOnce(new AbortController().signal);assert.ok(Buffer.byteLength(JSON.stringify({text:sent}))<=12_000);assert.ok(sent.includes('截断'));
    for(let n=0;n<25;n++) {completedInput(f,`history-${n}`);await worker.runOnce(new AbortController().signal);}
    completedInput(f,'latest');await worker.runOnce(new AbortController().signal);
    assert.equal(f.db.prepare("SELECT count(*) n FROM channel_deliveries WHERE status='delivered'").get().n,27);
    assert.equal(new ChannelDeliveryRepository(f.db,f.other.id).claim(),undefined);
  }finally{f.db.close();}
});
it('upgrades populated native inbox through the grant removal, clears the route FK chain and keeps the delivery ledger tenant-scoped',()=>{
  const directory=mkdtempSync(join(tmpdir(),'fb-delivery-upgrade-'));const prior=join(directory,'prior');cpSync(migrationsFolder,prior,{recursive:true});
  const journalFile=join(prior,'meta/_journal.json');const journal=JSON.parse(readFileSync(journalFile,'utf8'));journal.entries=entriesBefore(journal.entries,'0080_native_channel_deliveries');writeFileSync(journalFile,JSON.stringify(journal));
  const f=fixture(':memory:',prior);
  try {
    const identity=f.pair();
    // Pre-0105 routes bound a grant column the new service layer no longer writes; replay the historical rows with raw SQL.
    f.db.prepare("INSERT INTO copilot_grants(id,user_id,actor_user_id,name,status,revision,scope_json,expires_at,max_actions,max_concurrency,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run('historical-grant',f.user.id,f.user.id,'historical','active',1,'[]',Date.now()+600000,5,1,Date.now());
    f.db.prepare("INSERT INTO copilot_conversations(id,user_id,title,status,created_at,updated_at) VALUES (?,?,'Channel Copilot','active',?,?)").run('historical-channel-conversation',f.user.id,Date.now(),Date.now());
    f.db.prepare('INSERT INTO channel_routes(id,user_id,identity_id,grant_id,grant_revision,conversation_id,created_at) VALUES (?,?,?,?,?,?,?)').run('historical-channel-route',f.user.id,identity.id,'historical-grant',1,'historical-channel-conversation',Date.now());
    f.db.prepare("INSERT INTO channel_messages(id,user_id,route_id,account_id,event_id,message_id,payload_encrypted,payload_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run('historical-channel-message',f.user.id,'historical-channel-route',f.account.id,'upgrade-event','upgrade-message','fixture','fixture',Date.now());
    f.db.prepare('INSERT INTO channel_message_events(user_id,account_id,event_id,inbox_id) VALUES (?,?,?,?)').run(f.user.id,f.account.id,'upgrade-event','historical-channel-message');
    f.db.prepare("INSERT INTO platform_action_intents(id,user_id,actor_user_id,grant_id,grant_revision,authority,command_id,input_json,digest,resources_json,policy_version,expires_at,idempotency_key,status,created_at) VALUES ('upgrade-intent',?,?,?,1,'delegated_grant','test','{}','digest','{}',1,?,'upgrade-step','approved',?)").run(f.user.id,f.user.id,'historical-grant',Date.now()+60000,Date.now());
    migrate(drizzle(f.db),{migrationsFolder});
    assert.equal(f.db.prepare('SELECT count(*) n FROM channel_routes').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM channel_messages').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM channel_message_events').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM channel_deliveries').get().n,0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name IN ('copilot_grants','copilot_conversation_grants')").get().n,0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM platform_action_intents WHERE id='upgrade-intent'").get().n,1);
    assert.equal(f.db.prepare("SELECT count(*) n FROM pragma_table_info('platform_action_intents') WHERE name IN ('grant_id','grant_revision')").get().n,0);
    f.projects.setCopilotAutonomy(f.project.id,true);
    f.service.createRoute({identityId:identity.id,projectId:f.project.id});
    const message=new NativeChannelInbox(f.db,f.user.id,f.key).receive(f.peer,incoming('post-upgrade'));
    assert.throws(()=>new ChannelDeliveryRepository(f.db,f.other.id).enqueue(message.id,'terminal','encrypted'));
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.db.close();rmSync(directory,{recursive:true,force:true});}
});

import { FeishuChannelRuntime } from '../src/services/integrations/feishu-channel-runtime.js';
it('fences suspended delivery after shutdown drain timeout and database close',async()=>{
  const f=inboxFixture();completedInput(f);let tick!:()=>void;let release!:()=>void;const gate=new Promise<void>(r=>release=r);let started!:()=>void;const began=new Promise<void>(r=>started=r);let requests=0;
  const sender=createFeishuNativeSender(f.db,f.user.id,f.key,{validate:async()=>{},fetch:async url=>{
    if(String(url).includes('/auth/')){started();await gate;return Response.json({code:0,tenant_access_token:'fixture'});}
    requests++;return Response.json({code:0,data:{message_id:'om'}});
  }});
  const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,sender);let running:Promise<void>|undefined;
  const runtime=new FeishuChannelRuntime({supervisor:{start:async()=>{},stop:async()=>{},reconcileAccount:async()=>{},getHealth:()=>({state:'stopped',accountId:null,configRevision:null,reconnectAttempt:0,lastConnectedAt:null,lastErrorMessage:null})},
    workers:[signal=>running=worker.runOnce(signal)],setInterval:callback=>{tick=callback;return 1;},clearInterval:()=>{},drainTimeoutMs:100});
  try {
    await runtime.start();tick();await began;await assert.rejects(runtime.stop(),/TIMEOUT/);
    f.db.close();release();await running;assert.equal(requests,0);
  }finally{release?.();if(f.db.open)f.db.close();}
});

for(const [raw,expected] of [
  ['<think>private reasoning</think>项目1，任务0','项目1，任务0'],
  ['前言<think>one<think>nested</think>two</think>结果','前言结果'],
  ['<THINK>private</THINK>结果<think>unfinished','结果'],
  ['<think>first</think>正文<think>second</think>结束','正文结束'],
  ['<think>unfinished','任务已完成，请在 Web Copilot 查看详情。']
])it('projects only final answer from provider inline reasoning: '+expected,async()=>{
  const f=inboxFixture();let sent='';
  try {
    const input=completedInput(f);new CopilotRunLedger(f.db,f.user.id).append(input.runId,{role:'assistant',kind:'text',content:raw!});
    const worker=new NativeChannelDelivery(f.db,f.user.id,f.key,async message=>{sent=message.text;return {status:'delivered',messageId:'fixture'};});
    await worker.runOnce(new AbortController().signal);assert.equal(sent,expected);
    assert.equal(new CopilotRunLedger(f.db,f.user.id).log.listRunMessages(input.runId).at(-1)?.content,raw);
  }finally{f.db.close();}
});
it('filters inline reasoning from delivery payloads queued before the fix',async()=>{
  const f=inboxFixture();let sent='';
  try {
    const input=completedInput(f);
    const {encryptSecret}=await import('../src/crypto/secret-box.js');
    new ChannelDeliveryRepository(f.db,f.user.id).enqueue(input.id,'terminal',JSON.stringify(encryptSecret('<think>private</think>queued result',{key:f.key})));
    await new NativeChannelDelivery(f.db,f.user.id,f.key,async message=>{sent=message.text;return {status:'delivered',messageId:'fixture'};}).runOnce(new AbortController().signal);
    assert.equal(sent,'queued result');
  }finally{f.db.close();}
});

function entriesBefore<T extends {tag:string}>(entries:T[],tag:string):T[] {
  const index=entries.findIndex(entry=>entry.tag===tag);
  assert.ok(index>0,`Migration boundary missing: ${tag}`);
  return entries.slice(0,index);
}

it('admits a route with project autonomy on and rejects the same route immediately after the switch turns off',()=>{
 const f=fixture();
 try {
  const identity=f.pair();const route=f.service.createRoute({identityId:identity.id,projectId:f.project.id});
  assert.ok(f.service.admit(route.id,f.peer));
  f.projects.setCopilotAutonomy(f.project.id,false);assert.throws(()=>f.service.admit(route.id,f.peer));
 }finally{f.db.close();}
});
it('persists the project autonomy switch across reopen without letting another tenant toggle it',()=>{
 const directory=mkdtempSync(join(tmpdir(),'fb-project-autonomy-'));const file=join(directory,'db.sqlite');const f=fixture(file);
 try {
  f.projects.setCopilotAutonomy(f.project.id,true);
  f.db.close();const reopened=new Sqlite(file);
  try {
   const own=new ProjectRepository(reopened,f.user.id);assert.equal(own.getCopilotAutonomy(f.project.id),true);
   assert.equal(new ProjectRepository(reopened,f.other.id).setCopilotAutonomy(f.project.id,false),undefined);
   assert.equal(own.getCopilotAutonomy(f.project.id),true);
  }finally{reopened.close();}
 }finally{if(f.db.open)f.db.close();rmSync(directory,{recursive:true,force:true});}
});
