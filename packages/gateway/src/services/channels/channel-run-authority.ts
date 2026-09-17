import type { Database } from '../../db/types.js';
import { ChannelIdentityRepository } from '../../db/repositories/channel-identity-repository.js';
import { ChannelIdentityService, ChannelIdentityError } from './channel-identity-service.js';

/** Durable channel ownership survives missing route joins; callers cannot opt out through TurnInput. */
export function assertChannelConversationAuthority(db: Database, userId: string, conversationId: string): void {
  const records = new ChannelIdentityRepository(db,userId);
  const route = records.conversationRoute(conversationId);
  if (!route && !records.conversationIsChannelOwned(conversationId)) return;
  if (!route) throw new ChannelIdentityError();
  const identity = records.identity(route.identityId);
  if (!identity) throw new ChannelIdentityError();
  new ChannelIdentityService(db,userId).admit(route.id, {
    channel: 'feishu', accountId: identity.accountId, accountRevision: identity.accountRevision,
    externalUserId: identity.externalUserId, chatId: identity.chatId, chatType: 'p2p'
  });
}
