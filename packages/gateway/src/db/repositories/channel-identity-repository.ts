import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';

export interface ChannelPairing {
  id: string; channel: string; accountId: string; accountRevision: number;
  status: string; revision: number; externalUserId: string | null; chatId: string | null;
  expiresAt: number; createdAt: number;
}
export interface ChannelIdentity {
  id: string; channel: string; accountId: string; accountRevision: number;
  externalUserId: string; chatId: string; status: string; revision: number; createdAt: number;
}
export interface ChannelSession {
  routeId: string; chatType: 'p2p' | 'group'; chatId: string; threadId: string; conversationId: string;
  modelProfileId: string | null;
}
export interface ChannelRoute {
  id: string; identityId: string; projectId: string;
  conversationId: string; status: string; revision: number; createdAt: number;
}
const pairingColumns = 'id,channel,account_id AS accountId,account_revision AS accountRevision,status,revision,external_user_id AS externalUserId,chat_id AS chatId,expires_at AS expiresAt,created_at AS createdAt';
const identityColumns = 'id,channel,account_id AS accountId,account_revision AS accountRevision,external_user_id AS externalUserId,chat_id AS chatId,status,revision,created_at AS createdAt';
const routeColumns = 'id,identity_id AS identityId,project_id AS projectId,conversation_id AS conversationId,status,revision,created_at AS createdAt';
// Table names are picked from a closed literal set, never from request input.
function channelAccountTable(channel: string): 'feishu_channel_accounts' | 'telegram_channel_accounts' {
  return channel === 'telegram' ? 'telegram_channel_accounts' : 'feishu_channel_accounts';
}

export class ChannelIdentityRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}
  transaction<T>(fn: () => T): T { return this.db.transaction(fn).immediate(); }
  actorActive(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(this.userId));
  }
  listPairings(): ChannelPairing[] {
    return this.db.prepare(`SELECT ${pairingColumns} FROM channel_pairings WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(this.userId) as ChannelPairing[];
  }
  pairing(id: string): ChannelPairing | undefined {
    return this.db.prepare(`SELECT ${pairingColumns} FROM channel_pairings WHERE user_id=? AND id=?`).get(this.userId, id) as ChannelPairing | undefined;
  }
  pairingByHash(hash: string): ChannelPairing | undefined {
    return this.db.prepare(`SELECT ${pairingColumns} FROM channel_pairings WHERE user_id=? AND token_hash=?`).get(this.userId, hash) as ChannelPairing | undefined;
  }
  createPairing(input: { channel: string; accountId: string; accountRevision: number; tokenHash: string; expiresAt: number }): ChannelPairing {
    this.cancelAccountPairings(input.accountId);
    const id = randomUUID();
    this.db.prepare('INSERT INTO channel_pairings(id,user_id,channel,account_id,account_revision,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, this.userId, input.channel, input.accountId, input.accountRevision, input.tokenHash, input.expiresAt, Date.now());
    return this.pairing(id)!;
  }
  claim(id: string, revision: number, peer: { externalUserId: string; chatId: string }): boolean {
    return this.db.prepare("UPDATE channel_pairings SET status='claimed',revision=revision+1,external_user_id=?,chat_id=? WHERE user_id=? AND id=? AND status='pending' AND revision=? AND expires_at>?")
      .run(peer.externalUserId, peer.chatId, this.userId, id, revision, Date.now()).changes === 1;
  }
  confirm(id: string, revision: number): boolean {
    return this.db.prepare("UPDATE channel_pairings SET status='confirmed',revision=revision+1 WHERE user_id=? AND id=? AND status='claimed' AND revision=? AND expires_at>?")
      .run(this.userId, id, revision, Date.now()).changes === 1;
  }
  cancelPairing(id: string): void {
    this.db.prepare("UPDATE channel_pairings SET status='cancelled',revision=revision+1 WHERE user_id=? AND id=? AND status IN ('pending','claimed')").run(this.userId, id);
  }
  cancelAccountPairings(accountId: string): void {
    this.db.prepare("UPDATE channel_pairings SET status='cancelled',revision=revision+1 WHERE user_id=? AND account_id=? AND status IN ('pending','claimed')").run(this.userId, accountId);
  }
  listIdentities(): ChannelIdentity[] {
    return this.db.prepare(`SELECT ${identityColumns} FROM channel_identities WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(this.userId) as ChannelIdentity[];
  }
  identity(id: string): ChannelIdentity | undefined {
    return this.db.prepare(`SELECT ${identityColumns} FROM channel_identities WHERE user_id=? AND id=?`).get(this.userId, id) as ChannelIdentity | undefined;
  }
  createIdentity(input: { channel: string; accountId: string; accountRevision: number; externalUserId: string; chatId: string }): ChannelIdentity {
    const id = randomUUID();
    this.db.prepare('INSERT INTO channel_identities(id,user_id,channel,account_id,account_revision,external_user_id,chat_id,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, this.userId, input.channel, input.accountId, input.accountRevision, input.externalUserId, input.chatId, Date.now());
    return this.identity(id)!;
  }
  revokeIdentity(id: string): void {
    this.db.prepare("UPDATE channel_identities SET status='revoked',revision=revision+1 WHERE user_id=? AND id=? AND status='active'").run(this.userId, id);
    this.db.prepare("UPDATE channel_routes SET status='revoked',revision=revision+1 WHERE user_id=? AND identity_id=? AND status='active'").run(this.userId, id);
  }
  listRoutes(): ChannelRoute[] {
    return this.db.prepare(`SELECT ${routeColumns} FROM channel_routes WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(this.userId) as ChannelRoute[];
  }
  route(id: string): ChannelRoute | undefined {
    return this.db.prepare(`SELECT ${routeColumns} FROM channel_routes WHERE user_id=? AND id=?`).get(this.userId, id) as ChannelRoute | undefined;
  }
  accountMetadata(channel: string, accountId: string): { enabled: boolean; configRevision: number } | undefined {
    const table = channelAccountTable(channel);
    const row = this.db.prepare(`SELECT enabled,config_revision AS configRevision FROM ${table} WHERE user_id=? AND id=?`).get(this.userId,accountId) as {enabled:number;configRevision:number}|undefined;
    return row ? {...row,enabled:row.enabled===1} : undefined;
  }
  conversationRoute(conversationId: string): ChannelRoute | undefined {
    const session = this.sessionByConversation(conversationId);
    return session ? this.route(session.routeId) : undefined;
  }
  sessionByConversation(conversationId: string): ChannelSession | undefined {
    return this.db.prepare('SELECT route_id AS routeId,chat_type AS chatType,chat_id AS chatId,thread_id AS threadId,conversation_id AS conversationId,model_profile_id AS modelProfileId FROM channel_route_sessions WHERE user_id=? AND conversation_id=?')
      .get(this.userId,conversationId) as ChannelSession | undefined;
  }
  session(routeId: string, peer: {chatType: string; chatId: string; threadId?: string | undefined}): ChannelSession | undefined {
    return this.db.prepare('SELECT route_id AS routeId,chat_type AS chatType,chat_id AS chatId,thread_id AS threadId,conversation_id AS conversationId,model_profile_id AS modelProfileId FROM channel_route_sessions WHERE user_id=? AND route_id=? AND chat_type=? AND chat_id=? AND thread_id=?')
      .get(this.userId,routeId,peer.chatType,peer.chatId,peer.threadId ?? '') as ChannelSession | undefined;
  }
  createSession(routeId: string, peer: {chatType: string; chatId: string; threadId?: string | undefined}, conversationId: string): void {
    this.db.prepare('UPDATE copilot_conversations SET channel_owned=1 WHERE user_id=? AND id=?').run(this.userId,conversationId);
    this.db.prepare('INSERT INTO channel_route_sessions(user_id,route_id,chat_type,chat_id,thread_id,conversation_id) VALUES (?,?,?,?,?,?)')
      .run(this.userId,routeId,peer.chatType,peer.chatId,peer.threadId ?? '',conversationId);
  }
  conversationIsChannelOwned(conversationId: string): boolean {
    return (this.db.prepare('SELECT channel_owned FROM copilot_conversations WHERE user_id=? AND id=?').get(this.userId,conversationId) as {channel_owned:number}|undefined)?.channel_owned===1;
  }
  replaceSession(routeId: string, peer: {chatType:string;chatId:string;threadId?:string|undefined}, previous: string, next: string): void {
    this.db.prepare('UPDATE copilot_conversations SET channel_owned=1 WHERE user_id=? AND id=?').run(this.userId,next);
    const changed=this.db.prepare(`UPDATE channel_route_sessions SET conversation_id=?
      WHERE user_id=? AND route_id=? AND chat_type=? AND chat_id=? AND thread_id=? AND conversation_id=?`)
      .run(next,this.userId,routeId,peer.chatType,peer.chatId,peer.threadId??'',previous);
    if(changed.changes!==1)throw new Error('CHANNEL_SESSION_CHANGED');
  }
  setSessionModel(conversationId: string, modelProfileId: string|null): void {
    const changed=this.db.prepare('UPDATE channel_route_sessions SET model_profile_id=? WHERE user_id=? AND conversation_id=?')
      .run(modelProfileId,this.userId,conversationId);
    if(changed.changes!==1)throw new Error('CHANNEL_SESSION_CHANGED');
  }
  peerRoute(peer: {channel:string;accountId:string;accountRevision:number;externalUserId:string;chatId:string;chatType?:string}): ChannelRoute | undefined {
    // Group peers deliver to the group chatId but bind to the pairing user's private-chat identity.
    const group = peer.chatType === 'group';
    const row = this.db.prepare(`SELECT r.id FROM channel_routes r JOIN channel_identities i ON i.user_id=r.user_id AND i.id=r.identity_id
      WHERE r.user_id=? AND r.status='active' AND i.status='active' AND i.channel=? AND i.account_id=? AND i.account_revision=? AND i.external_user_id=?${group ? '' : ' AND i.chat_id=?'}`)
      .get(...(group
        ? [this.userId,peer.channel,peer.accountId,peer.accountRevision,peer.externalUserId]
        : [this.userId,peer.channel,peer.accountId,peer.accountRevision,peer.externalUserId,peer.chatId])) as {id:string}|undefined;
    return row ? this.route(row.id) : undefined;
  }
  createRoute(input: { identityId: string; projectId: string; conversationId: string }): ChannelRoute {
    const id = randomUUID();
    this.db.prepare('UPDATE copilot_conversations SET channel_owned=1 WHERE user_id=? AND id=?').run(this.userId,input.conversationId);
    this.db.prepare('INSERT INTO channel_routes(id,user_id,identity_id,project_id,conversation_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, this.userId, input.identityId, input.projectId, input.conversationId, Date.now());
    this.createSession(id, {chatType:'p2p',chatId:this.identity(input.identityId)!.chatId}, input.conversationId);
    return this.route(id)!;
  }
  revokeRoute(id: string): void {
    this.db.prepare("UPDATE channel_routes SET status='revoked',revision=revision+1 WHERE user_id=? AND id=? AND status='active'").run(this.userId, id);
  }
}
