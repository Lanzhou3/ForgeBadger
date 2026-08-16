import type { Database } from "../../../db/types.js";
import { PortfolioFeishuChannelRepository } from "../../../db/repositories/portfolio-feishu-channel-repository.js";
import { PortfolioFeishuRegistryRepository } from "../../../db/repositories/portfolio-feishu-registry-repository.js";
import { sha256, stableJson } from "./codec.js";

export interface PortfolioFeishuControlFacade {
  forOwner(input: { userId: string; actorUserId: string }): PortfolioFeishuOwnerControl;
}

export interface PortfolioFeishuOwnerControl {
  provisionActiveBinding(input: {
    providerAccountId: string;
    externalIdentity: string;
    conversationId: string;
    isOwner: boolean;
    projectId?: string;
    idempotencyKey: string;
  }): { bindingId: string; providerAccountId: string; status: "active" };
}

/** Restricted owner-only administration surface for Phase 6 HTTP adapters. */
export function createPortfolioFeishuControlFacade(db: Database): PortfolioFeishuControlFacade {
  return Object.freeze<PortfolioFeishuControlFacade>({
    forOwner({ userId, actorUserId }: { userId: string; actorUserId: string }): PortfolioFeishuOwnerControl {
      if (!userId || actorUserId !== userId) throw new Error("PORTFOLIO_FEISHU_OWNER_REQUIRED");
      const registry = new PortfolioFeishuRegistryRepository(db);
      const channels = new PortfolioFeishuChannelRepository(db, userId);
      return Object.freeze<PortfolioFeishuOwnerControl>({
        provisionActiveBinding(input) {
          return idempotent(db, userId, "feishu.binding.provision", input, () => {
            const account = registry.getOwnedById(input.providerAccountId, userId);
            if (!account || account.lifecycleState !== "verified" || account.handlerKind !== "portfolio") {
              throw new Error("PORTFOLIO_FEISHU_ACCOUNT_NOT_ELIGIBLE");
            }
            const existing = channels.resolveActiveBinding({ providerAccountId: account.id, externalIdentity: input.externalIdentity, conversationId: input.conversationId });
            if (existing && existing.isOwner !== input.isOwner) throw new Error("PORTFOLIO_FEISHU_BINDING_PROVISIONING_DRIFT");
            const binding = existing ?? channels.createBinding({ provider: account.provider, providerAccountId: account.id,
              externalIdentity: input.externalIdentity, conversationId: input.conversationId, isOwner: input.isOwner,
              ...(input.projectId ? { projectId: input.projectId } : {}) });
            writeAudit(db, userId, "portfolio.feishu.binding.provision", "portfolio_channel_binding", binding.id, { providerAccountId: account.id, isOwner: binding.isOwner });
            return { bindingId: binding.id, providerAccountId: account.id, status: "active" as const };
          });
        }
      });
    }
  });
}

function idempotent<T>(db: Database, userId: string, operation: string, input: { idempotencyKey: string }, create: () => T): T {
  if (!input.idempotencyKey.trim()) throw new Error("PORTFOLIO_FEISHU_IDEMPOTENCY_REQUIRED");
  const digest = sha256(stableJson(input));
  return db.transaction(() => {
    const existing = db.prepare(`SELECT payload_digest, result_json FROM portfolio_operation_records
      WHERE user_id = ? AND operation = ? AND idempotency_key = ?`).get(userId, operation, input.idempotencyKey) as { payload_digest: string; result_json: string } | undefined;
    if (existing) {
      if (existing.payload_digest !== digest) throw new Error("PORTFOLIO_IDEMPOTENCY_CONFLICT");
      return JSON.parse(existing.result_json) as T;
    }
    const result = create();
    db.prepare(`INSERT INTO portfolio_operation_records (id, user_id, operation, idempotency_key, payload_digest, result_json, created_at)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?)`)
      .run(userId, operation, input.idempotencyKey, digest, JSON.stringify(result), Date.now());
    return result;
  })();
}

function writeAudit(db: Database, userId: string, action: string, resourceType: string, resourceId: string, details: Record<string, unknown>): void {
  db.prepare(`INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)`)
    .run(userId, action, resourceType, resourceId, JSON.stringify(details), Date.now());
}
