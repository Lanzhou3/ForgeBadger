import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { ChannelIdentityRepository, type ChannelIdentity } from '../../db/repositories/channel-identity-repository.js';
import { CopilotGrantRepository } from '../../db/repositories/copilot-grant-repository.js';
import { FeishuIntegrationRepository } from '../../db/repositories/feishu-integration-repository.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { AuditLogRepository } from '../../db/repositories/audit-log-repository.js';
import { CopilotConversationLog } from '../agent/conversation-log.js';

const id = z.string().trim().min(1).max(128);
export const channelPairingInput = z.object({ channel: z.literal('feishu'), accountId: id }).strict();
export const channelConfirmationInput = z.object({ revision: z.number().int().positive(), externalUserId: id, chatId: id }).strict();
export const channelRouteInput = z.object({ identityId: id, grantId: id }).strict();
const peerSchema = channelPairingInput.extend({ accountRevision: z.number().int().positive(), externalUserId: id, chatId: id, chatType: z.literal('p2p') }).strict();
/** Only SDK-authenticated, normalized transport events may populate this input. Never accept it from HTTP/model JSON. */
export type TrustedChannelPeer = z.infer<typeof peerSchema>;
export class ChannelIdentityError extends Error {
  constructor() { super('CHANNEL_AUTHORITY_REJECTED'); }
}
const requireAuthority = (condition: unknown): void => { if (!condition) throw new ChannelIdentityError(); };
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export class ChannelIdentityService {
  readonly records: ChannelIdentityRepository;
  private readonly grants: CopilotGrantRepository;
  private readonly conversations: CopilotConversationLog;
  constructor(private readonly db: Database, private readonly userId: string, _masterKey?: string) {
    this.records = new ChannelIdentityRepository(db, userId);
    this.grants = new CopilotGrantRepository(db, userId);
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
      const grant = this.currentGrant(value.grantId);
      const conversation = this.conversations.createConversation('Channel Copilot');
      this.grants.bind(conversation.id, grant.id);
      const route = this.records.createRoute({ ...value, grantRevision: grant.revision, conversationId: conversation.id });
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

  /** Point-in-time routing decision, not an execution or disclosure permit. Revalidate before each effect/delivery. */
  admit(routeId: string, rawPeer: TrustedChannelPeer, operation?: { capability: string; projectIds: string[] }) {
    id.parse(routeId);
    const peer = peerSchema.parse(rawPeer);
    const scope = operation === undefined ? undefined : z.object({ capability: id, projectIds: z.array(id).max(100) }).strict().parse(operation);
    return this.records.transaction(() => {
      this.checkPeer(peer);
      const route = this.records.route(routeId); requireAuthority(route?.status === 'active');
      const identity = this.currentIdentity(route!.identityId);
      requireAuthority(identity.channel === peer.channel && identity.accountId === peer.accountId
        && identity.accountRevision === peer.accountRevision && identity.externalUserId === peer.externalUserId && identity.chatId === peer.chatId);
      const grant = this.currentGrant(route!.grantId);
      requireAuthority(grant.revision === route!.grantRevision && this.conversations.getConversation(route!.conversationId)?.status === 'active'
        && this.grants.binding(route!.conversationId) === grant.id);
      if (scope) requireAuthority(grant.scope.capabilities.includes(scope.capability) && scope.projectIds.every(projectId => grant.scope.projectIds.includes(projectId)));
      return { userId: this.userId, actorUserId: this.userId, routeId: route!.id, routeRevision: route!.revision,
        identityId: identity.id, identityRevision: identity.revision, grantId: grant.id, grantRevision: grant.revision,
        conversationId: route!.conversationId, projectIds: grant.scope.projectIds };
    });
  }

  private actor(): void { requireAuthority(this.records.actorActive()); }
  private account(channel: string, accountId: string) {
    this.actor(); requireAuthority(channel === 'feishu');
    const account = this.records.accountMetadata(accountId);
    const config = new FeishuIntegrationRepository(this.db, this.userId).getConfig();
    requireAuthority(account?.enabled && config.enabled && !config.emergencyDisabled);
    return account!;
  }
  private checkPeer(peer: TrustedChannelPeer): void {
    requireAuthority(this.account(peer.channel, peer.accountId).configRevision === peer.accountRevision);
    const allowed = new FeishuIntegrationRepository(this.db, this.userId).getConfig().allowedChatIds;
    requireAuthority(allowed.length === 0 || allowed.includes(peer.chatId));
  }
  private currentIdentity(identityId: string): ChannelIdentity {
    const identity = this.records.identity(identityId); requireAuthority(identity?.status === 'active');
    this.checkPeer(peerSchema.parse({ channel: identity!.channel, accountId: identity!.accountId, accountRevision: identity!.accountRevision,
      externalUserId: identity!.externalUserId, chatId: identity!.chatId, chatType: 'p2p' }));
    return identity!;
  }
  private currentGrant(grantId: string) {
    this.actor(); const grant = this.grants.get(grantId);
    requireAuthority(grant?.status === 'active' && grant.actorUserId === this.userId && (grant.expiresAt === null || grant.expiresAt > Date.now()));
    const projects = new ProjectRepository(this.db, this.userId);
    requireAuthority(grant!.scope.projectIds.every(projectId => projects.getById(projectId)));
    return grant!;
  }
  private audit(action: string, resourceId: string): void {
    new AuditLogRepository(this.db, this.userId).create({ action, resourceType: 'channel_authority', resourceId, details: {} });
  }
}
