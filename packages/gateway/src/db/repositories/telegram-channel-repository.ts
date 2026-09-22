import { randomUUID } from "node:crypto";

import { decryptSecret, encryptSecret, type EncryptedSecret } from "../../crypto/secret-box.js";
import type { Database } from "../types.js";

export interface TelegramAccountSummary {
  id: string;
  botUsername: string | null;
  enabled: boolean;
  secretConfigured: boolean;
  connectionState: string;
  configRevision: number;
  lastConnectedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: Date;
}

interface AccountRow {
  id: string;
  user_id: string;
  bot_token_encrypted: string;
  bot_username: string | null;
  enabled: number;
  connection_state: string;
  last_connected_at: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  config_revision: number;
  created_at: number;
  updated_at: number;
}

export class TelegramChannelRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly masterKey: string
  ) {}

  upsertAccount(input: { botToken?: string; botUsername?: string; enabled: boolean }): TelegramAccountSummary {
    const existing = this.getAccountRow();
    if (!existing && !input.botToken) throw new Error("TELEGRAM_BOT_TOKEN_REQUIRED");
    const encrypted = input.botToken
      ? JSON.stringify(encryptSecret(input.botToken, { key: this.masterKey }))
      : existing!.bot_token_encrypted;
    const botUsername = input.botUsername ?? existing?.bot_username ?? null;
    const now = Date.now();
    if (existing) {
      this.db.prepare(`
        UPDATE telegram_channel_accounts
        SET bot_token_encrypted = ?, bot_username = ?, enabled = ?, connection_state = ?,
            config_revision = config_revision + 1, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(encrypted, botUsername, input.enabled ? 1 : 0, input.enabled ? "pending" : "disabled", now, existing.id, this.userId);
      return this.getAccount(existing.id) as TelegramAccountSummary;
    }
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO telegram_channel_accounts (
        id, user_id, bot_token_encrypted, bot_username, enabled, connection_state,
        config_revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, this.userId, encrypted, botUsername, input.enabled ? 1 : 0, input.enabled ? "pending" : "disabled", now, now);
    return this.getAccount(id) as TelegramAccountSummary;
  }

  getAccount(id?: string): TelegramAccountSummary | undefined {
    const row = id
      ? this.db.prepare("SELECT * FROM telegram_channel_accounts WHERE id = ? AND user_id = ?").get(id, this.userId) as AccountRow | undefined
      : this.getAccountRow();
    return row ? toAccount(row) : undefined;
  }

  updateAccountHealth(id: string, input: {
    state: string;
    lastConnectedAt?: Date | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): TelegramAccountSummary {
    const result = this.db.prepare(`
      UPDATE telegram_channel_accounts SET connection_state = ?, last_connected_at = ?,
        last_error_code = ?, last_error_message = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(input.state.slice(0, 64), input.lastConnectedAt?.getTime() ?? null,
      input.errorCode?.slice(0, 128) ?? null, input.errorMessage?.slice(0, 500) ?? null,
      Date.now(), id, this.userId);
    if (result.changes !== 1) throw new Error("TELEGRAM_ACCOUNT_NOT_FOUND");
    return this.getAccount(id) as TelegramAccountSummary;
  }

  setBotUsername(id: string, botUsername: string): void {
    const result = this.db.prepare(
      "UPDATE telegram_channel_accounts SET bot_username = ? WHERE id = ? AND user_id = ?"
    ).run(botUsername.slice(0, 128), id, this.userId);
    if (result.changes !== 1) throw new Error("TELEGRAM_ACCOUNT_NOT_FOUND");
  }

  decryptAccountCredentials(id: string): { botToken: string } {
    const row = this.db.prepare(
      "SELECT * FROM telegram_channel_accounts WHERE id = ? AND user_id = ?"
    ).get(id, this.userId) as AccountRow | undefined;
    if (!row) throw new Error("TELEGRAM_ACCOUNT_NOT_FOUND");
    return {
      botToken: decryptSecret(JSON.parse(row.bot_token_encrypted) as EncryptedSecret, { key: this.masterKey })
    };
  }

  private getAccountRow(): AccountRow | undefined {
    return this.db.prepare("SELECT * FROM telegram_channel_accounts WHERE user_id = ?")
      .get(this.userId) as AccountRow | undefined;
  }
}

function toAccount(row: AccountRow): TelegramAccountSummary {
  return {
    id: row.id,
    botUsername: row.bot_username,
    enabled: row.enabled === 1,
    secretConfigured: row.bot_token_encrypted.length > 0,
    connectionState: row.connection_state,
    configRevision: row.config_revision,
    lastConnectedAt: row.last_connected_at === null ? null : new Date(row.last_connected_at),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    updatedAt: new Date(row.updated_at)
  };
}
