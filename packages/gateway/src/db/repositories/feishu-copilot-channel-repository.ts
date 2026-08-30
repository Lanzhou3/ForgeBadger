import type { Database } from "../types.js";

export interface FeishuCopilotChannelMapping {
  conversationId: string;
  senderIdentity: string | null;
}

export interface FeishuCopilotOwnerClaim extends FeishuCopilotChannelMapping {
  owned: boolean;
  created: boolean;
}

interface ChannelRow {
  conversation_id: string;
  sender_identity: string | null;
}

/** Tenant-scoped persistence for one Feishu chat's Copilot owner and conversation pointer. */
export class FeishuCopilotChannelRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  get(chatId: string): FeishuCopilotChannelMapping | undefined {
    const row = this.db.prepare(`SELECT conversation_id, sender_identity
      FROM feishu_copilot_channels WHERE user_id = ? AND chat_id = ?`)
      .get(this.userId, chatId) as ChannelRow | undefined;
    return row ? toMapping(row) : undefined;
  }

  /**
   * Atomically creates an owner binding, or claims a pre-0044 NULL-owner row.
   * Existing non-NULL ownership is immutable, so concurrent channel instances
   * all observe the same first successful sender.
   */
  claimOwner(input: {
    chatId: string;
    conversationId: string;
    senderIdentity: string;
    now?: Date;
  }): FeishuCopilotOwnerClaim {
    const claim = this.db.transaction(() => {
      const now = input.now?.getTime() ?? Date.now();
      const inserted = this.db.prepare(`INSERT INTO feishu_copilot_channels (
        user_id, chat_id, conversation_id, sender_identity, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, chat_id) DO NOTHING`)
        .run(this.userId, input.chatId, input.conversationId, input.senderIdentity, now, now);

      if (inserted.changes === 0) {
        this.db.prepare(`UPDATE feishu_copilot_channels
          SET sender_identity = ?, updated_at = ?
          WHERE user_id = ? AND chat_id = ? AND sender_identity IS NULL`)
          .run(input.senderIdentity, now, this.userId, input.chatId);
      }

      const mapping = this.get(input.chatId);
      if (!mapping) throw new Error("FEISHU_COPILOT_OWNER_CLAIM_MISSING");
      return {
        ...mapping,
        owned: mapping.senderIdentity === input.senderIdentity,
        created: inserted.changes > 0
      };
    });
    return claim();
  }

  pointAtConversation(input: {
    chatId: string;
    conversationId: string;
    senderIdentity: string;
    now?: Date;
  }): boolean {
    const result = this.db.prepare(`UPDATE feishu_copilot_channels
      SET conversation_id = ?, updated_at = ?
      WHERE user_id = ? AND chat_id = ? AND sender_identity = ?`)
      .run(input.conversationId, input.now?.getTime() ?? Date.now(), this.userId, input.chatId, input.senderIdentity);
    return result.changes > 0;
  }
}

function toMapping(row: ChannelRow): FeishuCopilotChannelMapping {
  return {
    conversationId: row.conversation_id,
    senderIdentity: row.sender_identity
  };
}
