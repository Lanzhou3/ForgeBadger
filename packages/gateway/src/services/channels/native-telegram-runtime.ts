import type { Database } from "../../db/types.js";
import { TelegramChannelRepository } from "../../db/repositories/telegram-channel-repository.js";
import { TelegramIntegrationRepository } from "../../db/repositories/telegram-integration-repository.js";
import {
  TelegramConnectionSupervisor,
  type TelegramConnectionHealth,
  type TelegramSupervisorAccount
} from "../integrations/telegram-connection-supervisor.js";
import { createTelegramPollingClient } from "../integrations/telegram-polling-client.js";
import { redactTelegramError } from "../integrations/telegram-error-redaction.js";
import { createTelegramNativeIngress } from "./native-channel-inbox.js";

export interface NativeTelegramIO {
  fetch?: typeof fetch;
  validate?: typeof import("../network-policy.js").assertResolvedPublicHttpsEndpoint;
}

interface TelegramRuntimeSupervisor {
  start(): Promise<void>;
  stop(): Promise<void>;
  reconcileAccount(userId: string): Promise<void>;
  getHealth(userId: string): TelegramConnectionHealth;
}

/**
 * Outbound-only channel runtime: the polling supervisor keeps the getUpdates
 * stream alive, while the Feishu runtime's worker lanes deliver replies for
 * every channel (see createNativeChannelSender).
 */
export class NativeTelegramRuntime {
  private started = false;
  private stopped = false;

  constructor(private readonly dependencies: { supervisor: TelegramRuntimeSupervisor }) {}

  async start(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    // Neither Telegram connectivity nor delivery recovery may delay HTTP readiness.
    void Promise.resolve().then(() => {
      if (!this.started || this.stopped) return undefined;
      return this.dependencies.supervisor.start();
    }).catch(() => {
      console.error("[telegram-runtime] supervisor startup failed", { code: "TELEGRAM_SUPERVISOR_START_FAILED" });
    });
  }

  async reconcileAccount(userId: string): Promise<void> {
    if (!this.started || this.stopped) throw new Error("TELEGRAM_RUNTIME_NOT_RUNNING");
    await this.dependencies.supervisor.reconcileAccount(userId);
  }

  getHealth(userId: string): TelegramConnectionHealth {
    const health = this.dependencies.supervisor.getHealth(userId);
    return {
      ...health,
      lastErrorMessage: health.lastErrorMessage
        ? redactTelegramError(new Error(health.lastErrorMessage))
        : null
    };
  }

  async emergencyStop(): Promise<void> {
    await this.shutdown();
  }

  async stop(): Promise<void> {
    await this.shutdown();
  }

  private shutdown(): Promise<void> {
    this.stopped = true;
    this.started = false;
    return this.dependencies.supervisor.stop();
  }
}

/** The system scheduler enumerates tenant IDs; every subsequent business read is tenant-scoped. */
export function createNativeTelegramRuntime(db: Database, key: string, io: NativeTelegramIO = {}): NativeTelegramRuntime {
  const userIds = (): string[] =>
    (db.prepare("SELECT id FROM users WHERE status='active' ORDER BY id").all() as { id: string }[]).map((u) => u.id);
  const account = (userId: string): TelegramSupervisorAccount | undefined => {
    if (!db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(userId)) return undefined;
    const repository = new TelegramChannelRepository(db, userId, key);
    const saved = repository.getAccount();
    const config = new TelegramIntegrationRepository(db, userId).getConfig();
    if (!saved?.enabled || !config.enabled || config.emergencyDisabled) return undefined;
    return {
      userId,
      accountId: saved.id,
      botUsername: saved.botUsername,
      configRevision: saved.configRevision,
      enabled: true,
      ...repository.decryptAccountCredentials(saved.id)
    };
  };
  const supervisor = new TelegramConnectionSupervisor({
    createPollingClient: (config, callbacks, handlers) => createTelegramPollingClient({
      token: config.botToken,
      callbacks,
      handlers,
      ...(io.fetch ? { fetch: io.fetch } : {}),
      ...(io.validate ? { validate: io.validate } : {})
    }),
    createHandlers: (entry) => ({
      onMessage: createTelegramNativeIngress({ db, userId: entry.userId, masterKey: key, accountId: entry.accountId, accountRevision: entry.configRevision })
    }),
    accounts: {
      listEnabled: () => userIds().flatMap((userId) => { try { const found = account(userId); return found ? [found] : []; } catch { return []; } }),
      get: account,
      updateHealth: (userId, health) => {
        if (!db.open || !health.accountId) return;
        const repository = new TelegramChannelRepository(db, userId, key);
        if (repository.getAccount(health.accountId)?.configRevision !== health.configRevision) return;
        repository.updateAccountHealth(health.accountId, {
          state: health.state,
          lastConnectedAt: health.lastConnectedAt,
          errorCode: health.lastErrorMessage ? "TELEGRAM_CONNECTION_FAILED" : null,
          errorMessage: health.lastErrorMessage
        });
      },
      updateBotUsername: (userId, botUsername) => {
        if (botUsername === null) return;
        const repository = new TelegramChannelRepository(db, userId, key);
        const current = repository.getAccount();
        if (current && current.botUsername !== botUsername) repository.setBotUsername(current.id, botUsername);
      }
    }
  });
  return new NativeTelegramRuntime({ supervisor });
}
