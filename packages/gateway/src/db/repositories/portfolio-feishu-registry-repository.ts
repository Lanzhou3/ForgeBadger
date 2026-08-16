import { randomUUID } from "node:crypto";

import type { Database } from "../types.js";

export type PortfolioFeishuAccountState = "verified" | "disabled" | "retired";

export interface PortfolioFeishuProviderAccount {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  lifecycleState: PortfolioFeishuAccountState;
  handlerKind: "portfolio";
  auditSafeMetadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface Row extends Record<string, unknown> {}

/** A global registry deliberately has no ambient tenant; claims supply an owner explicitly. */
export class PortfolioFeishuRegistryRepository {
  constructor(private readonly db: Database) {}

  register(input: {
    userId: string;
    provider: string;
    providerAccountId: string;
    auditSafeMetadata?: Record<string, unknown>;
    now?: Date;
  }): PortfolioFeishuProviderAccount {
    const provider = bounded(input.provider, 64, "PORTFOLIO_FEISHU_PROVIDER_INVALID");
    const providerAccountId = bounded(input.providerAccountId, 256, "PORTFOLIO_FEISHU_PROVIDER_ACCOUNT_INVALID");
    const now = input.now?.getTime() ?? Date.now();
    const existing = this.resolve(provider, providerAccountId);
    if (existing) {
      if (existing.userId !== input.userId) throw new Error("PORTFOLIO_FEISHU_ACCOUNT_ALREADY_CLAIMED");
      return existing;
    }
    try {
      const id = randomUUID();
      this.db.prepare(`INSERT INTO portfolio_provider_accounts (
        id, user_id, provider, provider_account_id, lifecycle_state, handler_kind,
        audit_safe_metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'verified', ?, ?, ?, ?)`)
        .run(id, input.userId, provider, providerAccountId, "portfolio",
          JSON.stringify(redactAuditMetadata(input.auditSafeMetadata ?? {})), now, now);
      return this.getById(id) as PortfolioFeishuProviderAccount;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const claimed = this.resolve(provider, providerAccountId);
        if (claimed?.userId === input.userId) return claimed;
        throw new Error("PORTFOLIO_FEISHU_ACCOUNT_ALREADY_CLAIMED");
      }
      throw error;
    }
  }

  resolve(provider: string, providerAccountId: string): PortfolioFeishuProviderAccount | undefined {
    const row = this.db.prepare(`SELECT * FROM portfolio_provider_accounts
      WHERE provider = ? AND provider_account_id = ?`).get(provider, providerAccountId) as Row | undefined;
    return row ? toAccount(row) : undefined;
  }

  getById(id: string): PortfolioFeishuProviderAccount | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_provider_accounts WHERE id = ?").get(id) as Row | undefined;
    return row ? toAccount(row) : undefined;
  }

  getOwnedById(id: string, userId: string): PortfolioFeishuProviderAccount | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_provider_accounts WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
    return row ? toAccount(row) : undefined;
  }

  disable(id: string, userId: string, now = new Date()): boolean {
    return this.db.prepare(`UPDATE portfolio_provider_accounts
      SET lifecycle_state = 'disabled', updated_at = ?
      WHERE id = ? AND user_id = ? AND lifecycle_state = 'verified'`)
      .run(now.getTime(), id, userId).changes === 1;
  }
}

function toAccount(row: Row): PortfolioFeishuProviderAccount {
  const isPortfolioHandler = stringValue(row, "handler_kind") === "portfolio";
  return {
    id: stringValue(row, "id"), userId: stringValue(row, "user_id"), provider: stringValue(row, "provider"),
    providerAccountId: stringValue(row, "provider_account_id"),
    // Historical non-Portfolio rows are deliberately represented as retired.
    // They cannot be selected or reactivated through the Portfolio boundary.
    lifecycleState: isPortfolioHandler ? stringValue(row, "lifecycle_state") as PortfolioFeishuAccountState : "retired",
    handlerKind: "portfolio",
    auditSafeMetadata: parseObject(row.audit_safe_metadata_json), createdAt: new Date(numberValue(row, "created_at")), updatedAt: new Date(numberValue(row, "updated_at"))
  };
}

function redactAuditMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|credential|password|authorization|signature/i.test(key)) continue;
    if (typeof item === "string") safe[key] = item.slice(0, 256);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) safe[key] = item;
  }
  return safe;
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : undefined;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function bounded(value: string, max: number, code: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(code);
  return normalized;
}
function stringValue(row: Row, key: string): string { return typeof row[key] === "string" ? row[key] : ""; }
function numberValue(row: Row, key: string): number { return typeof row[key] === "number" ? row[key] : 0; }
function isUniqueViolation(error: unknown): boolean { return error instanceof Error && error.message.includes("UNIQUE constraint failed"); }
