import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { ChannelIdentityRepository, type ChannelIdentity } from '../../db/repositories/channel-identity-repository.js';
import { FeishuIntegrationRepository } from '../../db/repositories/feishu-integration-repository.js';
import { TelegramIntegrationRepository } from '../../db/repositories/telegram-integration-repository.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { AuditLogRepository } from '../../db/repositories/audit-log-repository.js';
import { CopilotConversationLog } from '../agent/conversation-log.js';

const id = z.string().trim().min(1).max(128);
export const channelPlatforms = ['feishu', 'telegram'] as const;
export type ChannelPlatform = typeof channelPlatforms[number];
export const channelPairingInput = z.object({ channel: z.enum(channelPlatforms), accountId: id }).strict();
export const channelConfirmationInput = z.object({ revision: z.number().int().positive(), externalUserId: id, chatId: id }).strict();
export const channelRouteInput = z.object({ identityId: id, projectId: id }).strict();
const peerBase = { channel: z.enum(channelPlatforms), accountId: id, accountRevision: z.number().int().positive(), externalUserId: id, chatId: id, threadId: id.optional(), replyToMessageId: id.optional() };
const peerSchema = z.discriminatedUnion('chatType', [
  z.object({ ...peerBase, chatType: z.literal('p2p') }).strict(),
  z.object({ ...peerBase, chatType: z.literal('group'), mentionedBot: z.literal(true) }).strict()
]);
/** Only SDK-authenticated, normalized transport events may populate this input. Never accept it from HTTP/model JSON. */
export type TrustedChannelPeer = z.infer<typeof peerSchema>;
export class ChannelIdentityError extends Error {
  constructor() { super('CHANNEL_AUTHORITY_REJECTED'); }
}
const requireAuthority = (condition: unknown): void => { if (!condition) throw new ChannelIdentityError(); };
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Integration-config gate shared by every channel platform. */
interface ChannelIntegrationGate {
  getConfig(): { enabled: boolean; emergencyDisabled: boolean; allowedChatIds: string[] };
}

export class ChannelIdentityService {
  readonly records: ChannelIdentityRepository;
  private readonly conversations: CopilotConversationLog;
  constructor(private readonly db: Database, private readonly userId: string, _masterKey?: string) {
    this.records = new ChannelIdentityRepository(db, userId);
    this.conversations = new CopilotConversationLog(db, userId);
  }

  createPairing(raw: unknown) {
    const value = channelPairingInput.parse(raw);
    return this.records.transaction(() => {
      const account = this.account(value.channel, value.accountId);
      const token = randomBytes(32).toString('base64url');
      const pairing = this.records.createPairing({ ...value, accountRevision: account.configRevision, tokenHash: tokenHash(token), expiresAt: Date.now() + 600_000 });
      this.audit('channel.pairing.create', pairing.id);
      return { pairing, token };
    });
  }

  /** Internal seam only: token possession and authenticated private peer nominate a candidate, not an authority. */
  claimPairing(token: string, rawPeer: TrustedChannelPeer) {
    const peer = peerSchema.parse(rawPeer);
    z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(token);
    return this.records.transaction(() => {
      requireAuthority(peer.chatType === 'p2p' && !peer.threadId);
      this.checkPeer(peer);
      const pairing = this.records.pairingByHash(tokenHash(token));
      requireAuthority(pairing && pairing.status === 'pending' && pairing.expiresAt > Date.now()
        && pairing.channel === peer.channel && pairing.accountId === peer.accountId && pairing.accountRevision === peer.accountRevision);
      requireAuthority(this.records.claim(pairing!.id, pairing!.revision, peer));
      this.audit('channel.pairing.claim', pairing!.id);
      return this.records.pairing(pairing!.id)!;
    });
  }

  confirmPairing(pairingId: string, raw: unknown) {
    id.parse(pairingId);
    const value = channelConfirmationInput.parse(raw);
    return this.records.transaction(() => {
      const pairing = this.records.pairing(pairingId);
      requireAuthority(pairing && pairing.status === 'claimed' && pairing.expiresAt > Date.now()
        && pairing.revision === value.revision && pairing.externalUserId === value.externalUserId && pairing.chatId === value.chatId);
      const peer = peerSchema.parse({ channel: pairing!.channel, accountId: pairing!.accountId, accountRevision: pairing!.accountRevision, externalUserId: value.externalUserId, chatId: value.chatId, chatType: 'p2p' });
      this.checkPeer(peer);
      requireAuthority(this.records.confirm(pairingId, value.revision));
      const identity = this.records.createIdentity(peer);
      this.audit('channel.identity.confirm', identity.id);
      return identity;
    });
  }

  cancelPairing(pairingId: string): void {
    id.parse(pairingId);
    this.records.transaction(() => {
      this.actor(); requireAuthority(this.records.pairing(pairingId));
      this.records.cancelPairing(pairingId); this.audit('channel.pairing.cancel', pairingId);
    });
  }

  revokeIdentity(identityId: string): void {
    id.parse(identityId);
    this.records.transaction(() => {
      this.actor(); const identity = this.records.identity(identityId); requireAuthority(identity);
      this.records.revokeIdentity(identityId);
      this.records.cancelAccountPairings(identity!.accountId);
      this.audit('channel.identity.revoke', identityId);
    });
  }

  createRoute(raw: unknown) {
    const value = channelRouteInput.parse(raw);
    return this.records.transaction(() => {
      this.currentIdentity(value.identityId);
      const project = new ProjectRepository(this.db, this.userId).getById(value.projectId);
      requireAuthority(project !== undefined);
      const conversation = this.conversations.createConversation('Channel Copilot');
      const route = this.records.createRoute({ identityId: value.identityId, projectId: value.projectId, conversationId: conversation.id });
      this.audit('channel.route.create', route.id);
      return route;
    });
  }

  revokeRoute(routeId: string): void {
    id.parse(routeId);
    this.records.transaction(() => {
      this.actor(); requireAuthority(this.records.route(routeId));
      this.records.revokeRoute(routeId); this.audit('channel.route.revoke', routeId);
    });
  }

  /** Read-only base route authority, not proof of chat allowlist access or live delivery. */
  listRouteStatuses() {
    return this.records.listRoutes().map(route => {
      try {
        this.admitRoute(route.id);
        return { ...route, authorityValid: true };
      } catch (error) {
        if (!(error instanceof ChannelIdentityError)) throw error;
        return { ...route, authorityValid: false };
      }
    });
  }

  /** Revalidate parent authority and the target chat scope for run admission and effects. */
  admitRoute(routeId: string, conversationId?: string) {
    id.parse(routeId);
    return this.records.transaction(() => {
      const route = this.currentRoute(routeId);
      const identity = this.currentIdentity(route!.identityId);
      const session = conversationId ? this.records.sessionByConversation(conversationId) : undefined;
      if (conversationId) {
        requireAuthority(session?.routeId === routeId);
        this.checkPeer({ channel: identity.channel as ChannelPlatform, accountId: identity.accountId,
          accountRevision: identity.accountRevision, externalUserId: identity.externalUserId,
          chatId: session!.chatId, ...(session!.chatType === 'group' ? {chatType: 'group', mentionedBot: true} : {chatType: 'p2p'}) });
      }
      const targetConversation = session?.conversationId ?? route!.conversationId;
      requireAuthority(this.conversations.getConversation(targetConversation)?.status === 'active');
      return { userId: this.userId, actorUserId: this.userId, routeId: route!.id, routeRevision: route!.revision,
        identityId: identity.id, identityRevision: identity.revision,
        conversationId: targetConversation, projectIds: [route!.projectId] };
    });
  }

  /** Point-in-time routing decision, not an execution or disclosure permit. Revalidate before each effect/delivery. */
  admit(routeId: string, rawPeer: TrustedChannelPeer, operation?: { capability: string; projectIds: string[] }) {
    id.parse(routeId);
    const peer = peerSchema.parse(rawPeer);
    const scope = operation === undefined ? undefined : z.object({ capability: id, projectIds: z.array(id).max(100) }).strict().parse(operation);
    return this.records.transaction(() => {
      this.checkPeer(peer);
      const route = this.currentRoute(routeId);
      const identity = this.currentIdentity(route!.identityId);
      requireAuthority(identity.channel === peer.channel && identity.accountId === peer.accountId
        && identity.accountRevision === peer.accountRevision && identity.externalUserId === peer.externalUserId
        && (peer.chatType === 'group' || identity.chatId === peer.chatId));
      if (scope) requireAuthority(scope.projectIds.includes(route!.projectId));
      let session = this.records.session(routeId, peer);
      if (!session) {
        const conversation = this.conversations.createConversation(peer.chatType === 'group' ? 'Channel group' : 'Channel topic');
        this.records.createSession(routeId, peer, conversation.id);
        session = this.records.session(routeId, peer)!;
      }
      requireAuthority(this.conversations.getConversation(session.conversationId)?.status === 'active');
      return { userId: this.userId, actorUserId: this.userId, routeId: route!.id, routeRevision: route!.revision,
        identityId: identity.id, identityRevision: identity.revision,
        conversationId: session.conversationId, projectIds: [route!.projectId] };
    });
  }

  /** Every descendant inherits its parent route's conversation and project authority. */
  private currentRoute(routeId: string) {
    const route = this.records.route(routeId);
    requireAuthority(route?.status === 'active');
    const project = new ProjectRepository(this.db, this.userId).getById(route!.projectId);
    requireAuthority(this.conversations.getConversation(route!.conversationId)?.status === 'active'
      && project?.copilotAutonomy === true);
    return route!;
  }

  private actor(): void { requireAuthority(this.records.actorActive()); }
  private integrationFor(channel: ChannelPlatform): ChannelIntegrationGate {
    return channel === 'telegram'
      ? new TelegramIntegrationRepository(this.db, this.userId)
      : new FeishuIntegrationRepository(this.db, this.userId);
  }
  private account(channel: ChannelPlatform, accountId: string) {
    this.actor();
    const account = this.records.accountMetadata(channel, accountId);
    const config = this.integrationFor(channel).getConfig();
    requireAuthority(account?.enabled && config.enabled && !config.emergencyDisabled);
    return account!;
  }
  private checkPeer(peer: TrustedChannelPeer): void {
    requireAuthority(this.account(peer.channel, peer.accountId).configRevision === peer.accountRevision);
    const allowed = this.integrationFor(peer.channel).getConfig().allowedChatIds;
    // p2p keeps the legacy "empty = unrestricted" semantics; group chats default
    // to deny and must be present in the integration allowlist.
    requireAuthority(peer.chatType === 'group' ? allowed.includes(peer.chatId) : allowed.length === 0 || allowed.includes(peer.chatId));
  }
  private currentIdentity(identityId: string): ChannelIdentity {
    const identity = this.records.identity(identityId); requireAuthority(identity?.status === 'active');
    this.checkIdentityAccount(identity!);
    return identity!;
  }
  /** Account fence for a stored identity: enabled/config/emergency plus revision. The chat allowlist is enforced on the presenting peer, never on the identity's own private chat. */
  private checkIdentityAccount(identity: ChannelIdentity): void {
    requireAuthority(this.account(identity.channel as ChannelPlatform, identity.accountId).configRevision === identity.accountRevision);
  }
  private audit(action: string, resourceId: string): void {
    new AuditLogRepository(this.db, this.userId).create({ action, resourceType: 'channel_authority', resourceId, details: {} });
  }
}
