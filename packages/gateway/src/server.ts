import express from "express";
import { createServer as createHttpServer, type Server } from "node:http";

import { InMemoryApiKeyStore } from "./secrets/api-key-store.js";
import { InMemorySessionManager } from "./services/session-manager.js";
import { ForgeBadgerEventBus } from "./services/event-bus.js";
import { attachNotificationPersistence } from "./services/notification-events.js";
import { attachTerminalWebSocket } from "./websocket/terminal.js";
import { attachEventsWebSocket } from "./websocket/events.js";
import type { Database } from "./db/types.js";
import type { CommandRunner } from "./lib/dependency-check.js";
import type { FeishuChannelRuntime } from "./services/integrations/feishu-channel-runtime.js";
import type { RegistrationMode } from "./routes/auth.js";
import type { LocalAccountRecovery } from "./services/local-account-recovery.js";
import type { TerminalMultiplexerRuntime } from "./services/terminal-multiplexer-runtime.js";
import type { AgentStackDeps } from "./services/agent/agent-stack.js";
import { startAutomationScheduler, type AutomationScheduler } from "./services/automation/scheduler.js";
import { startCopilotRuntime } from "./services/agent/runtime.js";
import { RuntimeAuthorizationInvalidator } from "./services/runtime-authorization-invalidation.js";

import { mountRoutes } from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.js";

export interface ServerDeps {
  db: Database;
  jwtSecret: string;
  masterKey: string;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: ForgeBadgerEventBus;
  appVersion: string;
  adapterCommandRunner?: CommandRunner | undefined;
  feishuChannelRuntime?: FeishuChannelRuntime | undefined;
  registrationMode?: RegistrationMode | undefined;
  accountRecovery?: LocalAccountRecovery | undefined;
  copilotAgent?: AgentStackDeps | undefined;
  runtimeAuthorizationInvalidator: RuntimeAuthorizationInvalidator;
}

export interface GatewayApp {
  app: express.Express;
  server: Server;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: ForgeBadgerEventBus;
  recoveryReady: Promise<void>;
  close(): Promise<void>;
}

export interface GatewayAppOptions {
  jwtSecret: string;
  masterKey: string;
  db: Database;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus?: ForgeBadgerEventBus;
  appVersion?: string;
  adapterCommandRunner?: CommandRunner | undefined;
  feishuChannelRuntime?: FeishuChannelRuntime | undefined;
  registrationMode?: RegistrationMode | undefined;
  accountRecovery?: LocalAccountRecovery | undefined;
  terminalRuntime?: TerminalMultiplexerRuntime | undefined;
  runtimeAuthorizationInvalidator?: RuntimeAuthorizationInvalidator | undefined;
  /** Test-only model transport seam for the native Copilot runtime. */
  llmFetch?: typeof fetch | undefined;
}

export function createServer(deps: ServerDeps): express.Express {
  const app = express();
  app.locals.jwtSecret = deps.jwtSecret;
  app.locals.db = deps.db;

  app.use((request, response, next) => {
    const origin = request.headers.origin;
    if (isAllowedLocalWebOrigin(origin)) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
    }
    response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    response.setHeader("access-control-allow-headers", "authorization,content-type,idempotency-key");
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json());

  mountRoutes(app, deps);
  app.use(errorHandler);

  return app;
}

export function createGatewayApp(options: GatewayAppOptions): GatewayApp {
  const jwtSecret = options.jwtSecret;
  const sessionManager = options.sessionManager;
  const apiKeyStore = options.apiKeyStore;
  const eventBus = options.eventBus ?? new ForgeBadgerEventBus();
  const runtimeAuthorizationInvalidator = options.runtimeAuthorizationInvalidator
    ?? new RuntimeAuthorizationInvalidator();
  const copilotAgent: AgentStackDeps = {
    db: options.db,
    masterKey: options.masterKey,
    eventBus,
    sessionManager,
    ...(options.adapterCommandRunner ? { adapterCommandRunner: options.adapterCommandRunner } : {}),
    ...(options.llmFetch ? { llmFetch: options.llmFetch } : {})
  };

  const copilotRuntime = startCopilotRuntime(copilotAgent);
  const recoveryReady = copilotRuntime.ready;

  const app = createServer({
    db: options.db,
    jwtSecret,
    masterKey: options.masterKey,
    sessionManager,
    apiKeyStore,
    eventBus,
    appVersion: options.appVersion ?? "0.0.0",
    adapterCommandRunner: options.adapterCommandRunner,
    feishuChannelRuntime: options.feishuChannelRuntime,
    registrationMode: options.registrationMode,
    accountRecovery: options.accountRecovery,
    copilotAgent,
    runtimeAuthorizationInvalidator
  });

  const server = createHttpServer(app);
  let closed = false;
  attachNotificationPersistence({ db: options.db, eventBus });
  // The automation scheduler runs only when the native Copilot harness is
  // mounted (same gate as the /api/v1/copilot routes).
  const automationScheduler: AutomationScheduler | undefined = copilotAgent
    ? startAutomationScheduler(copilotAgent)
    : undefined;
  attachTerminalWebSocket({
    server,
    sessionManager,
    jwtSecret,
    db: options.db,
    runtimeAuthorizationInvalidator,
    ...(options.terminalRuntime ? { terminalRuntime: options.terminalRuntime } : {})
  });
  attachEventsWebSocket({ server, eventBus, jwtSecret, db: options.db });
  // Opening the provider connection is intentionally last.
  void options.feishuChannelRuntime?.start().catch(() => {
    console.error("[feishu-runtime] startup failed", { code: "FEISHU_RUNTIME_START_FAILED" });
  });

  return {
    app,
    server,
    sessionManager,
    apiKeyStore,
    eventBus,
    recoveryReady,
    async close() {
      if (closed) {
        return;
      }
      closed = true;

      const failures: unknown[] = [];
      const httpCloseResult = beginServerClose(server).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await runShutdownStage(failures, () => options.feishuChannelRuntime?.stop());
      automationScheduler?.stop();
      await runShutdownStage(failures, () => copilotRuntime.stop());
      const httpResult = await httpCloseResult;
      if (!httpResult.ok) {
        failures.push(httpResult.error);
      }
      await runShutdownStage(failures, () => options.db.close());

      if (failures.length > 0) {
        throw new AggregateError(failures, "GATEWAY_SHUTDOWN_FAILED");
      }
    }
  };
}

async function runShutdownStage(
  failures: unknown[],
  stage: () => unknown | Promise<unknown>
): Promise<void> {
  try {
    await stage();
  } catch (error) {
    failures.push(error);
  }
}

function beginServerClose(server: Server, timeoutMs = 5_000): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, Math.max(1, timeoutMs));
    server.close((error) => {
      if (error) {
        finish(error);
        return;
      }
      finish();
    });
  });
}

export function isAllowedLocalWebOrigin(origin: string | undefined): origin is string {
  if (!origin) {
    return false;
  }

  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}
