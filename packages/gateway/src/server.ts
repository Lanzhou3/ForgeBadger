import express from "express";
import { createServer as createHttpServer, type Server } from "node:http";

import { InMemoryApiKeyStore } from "./secrets/api-key-store.js";
import { InMemorySessionManager } from "./services/session-manager.js";
import { OpenForgeEventBus } from "./services/event-bus.js";
import type { ClaudePortfolioWorker } from "./services/portfolio/claude-portfolio-worker.js";
import type { OperationsRuntime } from "./services/portfolio/operations-runtime.js";
import type { PortfolioExecutionRuntime } from "./services/startup.js";
import { attachNotificationPersistence } from "./services/notification-events.js";
import { attachTerminalWebSocket } from "./websocket/terminal.js";
import { attachEventsWebSocket } from "./websocket/events.js";
import type { Database } from "./db/types.js";
import type { CommandRunner } from "./lib/dependency-check.js";
import type { FeishuChannelRuntime } from "./services/integrations/feishu-channel-runtime.js";
import { createPortfolioApiFacade, createPortfolioEventFacade, type PortfolioApiFacade } from "./services/portfolio/portfolio-api-service.js";
import { attachCopilotReactiveLoop } from "./services/agent/reactive-loop.js";
import { buildAgentStack } from "./services/agent/agent-stack.js";
import { DshProcessManager, type DshProcessManagerOptions } from "./services/dsh-copilot/process-manager.js";
import { createDshCopilotBff, type DshCopilotBff } from "./services/dsh-copilot/bff-service.js";
import { createCordisConfigRenderer } from "./services/dsh-copilot/dsh-config.js";

import { mountRoutes } from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.js";

export interface ServerDeps {
  db: Database;
  jwtSecret: string;
  masterKey: string;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: OpenForgeEventBus;
  /** The only Portfolio object exposed to HTTP routes; no execution runtime leaks here. */
  portfolioApi?: PortfolioApiFacade | undefined;
  /** Service token guarding the internal copilot-bridge API; unset disables the route group. */
  copilotBridgeToken?: string | undefined;
  claudePortfolioWorker?: ClaudePortfolioWorker | undefined;
  portfolioExecution?: PortfolioExecutionRuntime | undefined;
  operationsRuntime?: Pick<OperationsRuntime, "stop"> | undefined;
  appVersion: string;
  adapterCommandRunner?: CommandRunner | undefined;
  feishuChannelRuntime?: FeishuChannelRuntime | undefined;
  /** Test-only: overrides the Copilot LLM client fetch so tests can stub model responses. */
  llmFetch?: typeof fetch;
  /** M2: constructed dsh copilot BFF; present only when the flag is on. */
  dshBff?: DshCopilotBff | undefined;
}

/**
 * Process-only access to the composed Portfolio dispatcher. This is not
 * exposed through Express, WebSocket, app.locals, or event dispatch; an
 * in-process owner must explicitly obtain it to call core's launch boundary.
 */
export interface GatewayInternalServices {
  getPortfolioExecution(): PortfolioExecutionRuntime;
}

export interface GatewayApp {
  app: express.Express;
  server: Server;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: OpenForgeEventBus;
  internalServices: GatewayInternalServices;
  recoveryReady: Promise<void>;
  close(): Promise<void>;
}

export interface GatewayAppOptions {
  jwtSecret: string;
  masterKey: string;
  db: Database;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus?: OpenForgeEventBus;
  claudePortfolioWorker?: ClaudePortfolioWorker | undefined;
  portfolioExecution?: PortfolioExecutionRuntime | undefined;
  operationsRuntime?: Pick<OperationsRuntime, "stop"> | undefined;
  /** Service token guarding the internal copilot-bridge API; unset disables the route group. */
  copilotBridgeToken?: string | undefined;
  appVersion?: string;
  adapterCommandRunner?: CommandRunner | undefined;
  feishuChannelRuntime?: FeishuChannelRuntime | undefined;
  /** Test-only: overrides the Copilot LLM client fetch so tests can stub model responses. */
  llmFetch?: typeof fetch;
  /** M2: dsh copilot kernel process config; present only when the flag is on. */
  dshCopilot?: DshProcessManagerOptions | undefined;
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

  app.use(express.json({
    verify: (request, _response, buffer) => {
      const pathname = (request as express.Request).originalUrl ?? request.url ?? "";
      if (pathname.startsWith("/api/v1/integrations/feishu/webhook/")) {
        (request as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      }
    }
  }));

  mountRoutes(app, deps);
  app.use(errorHandler);

  return app;
}

export function createGatewayApp(options: GatewayAppOptions): GatewayApp {
  const jwtSecret = options.jwtSecret;
  const sessionManager = options.sessionManager;
  const apiKeyStore = options.apiKeyStore;
  const eventBus = options.eventBus ?? new OpenForgeEventBus();
  const internalServices = createGatewayInternalServices(options.portfolioExecution);
  const portfolioApi = createPortfolioApiFacade({ db: options.db, events: createPortfolioEventFacade(eventBus) });
  const recoveryReady = Promise.resolve();

  // M2 dsh copilot kernel: per-user runtime processes + BFF. Constructed only
  // when the flag is on; with it absent the copilot stack is byte-identical.
  const dshProcessManager = options.dshCopilot ? new DshProcessManager({
    ...options.dshCopilot,
    // M4: render the per-user cordis.yml (plugin toggles) at spawn. The
    // template ships inside the dsh-bridge package next to the launcher; when
    // it is absent (tests with a fake launcher) the runtime keeps the default
    // composition.
    renderConfig: createCordisConfigRenderer(options.db, options.dshCopilot.launcherPath, options.dshCopilot.configTemplatePath)
  }) : undefined;
  const dshBff = dshProcessManager
    ? createDshCopilotBff({
      db: options.db,
      masterKey: options.masterKey,
      eventBus,
      processManager: dshProcessManager,
      sessionManager,
      portfolioApi,
      ...(options.llmFetch ? { llmFetch: options.llmFetch } : {})
    })
    : undefined;

  const app = createServer({
    db: options.db,
    jwtSecret,
    masterKey: options.masterKey,
    sessionManager,
    apiKeyStore,
    eventBus,
    portfolioApi,
    claudePortfolioWorker: options.claudePortfolioWorker,
    portfolioExecution: options.portfolioExecution,
    operationsRuntime: options.operationsRuntime,
    copilotBridgeToken: options.copilotBridgeToken,
    appVersion: options.appVersion ?? "0.0.0",
    adapterCommandRunner: options.adapterCommandRunner,
    feishuChannelRuntime: options.feishuChannelRuntime,
    ...(dshBff ? { dshBff } : {}),
    ...(options.llmFetch ? { llmFetch: options.llmFetch } : {})
  });

  const server = createHttpServer(app);
  let closed = false;
  attachNotificationPersistence({ db: options.db, eventBus });
  attachTerminalWebSocket({ server, sessionManager, jwtSecret, db: options.db });
  attachEventsWebSocket({ server, eventBus, jwtSecret, db: options.db });
  // Proactive copilot: wake on platform events, report in fresh conversations.
  const reactiveLoop = attachCopilotReactiveLoop({
    deps: { db: options.db, masterKey: options.masterKey, eventBus, portfolioApi, ...(dshBff ? { dshBff } : {}) },
    buildAgentStack
  });
  // Feishu Copilot channel: the runtime is built in startup before the
  // Portfolio facade exists, so its agent deps attach here once in scope.
  options.feishuChannelRuntime?.attachAgentDeps({
    db: options.db,
    masterKey: options.masterKey,
    eventBus,
    portfolioApi,
    ...(dshBff ? { dshBff } : {})
  });

  return {
    app,
    server,
    sessionManager,
    apiKeyStore,
    eventBus,
    internalServices,
    recoveryReady,
    async close() {
      if (closed) {
        return;
      }
      closed = true;

      try {
        reactiveLoop.stop();
        await dshProcessManager?.disposeAll();
        await options.operationsRuntime?.stop();
        await options.feishuChannelRuntime?.stop();
        await closeServerIfListening(server);
      } finally {
        options.db.close();
      }
    }
  };
}

function createGatewayInternalServices(
  portfolioExecution: PortfolioExecutionRuntime | undefined
): GatewayInternalServices {
  return Object.freeze({
    getPortfolioExecution(): PortfolioExecutionRuntime {
      if (!portfolioExecution) {
        throw new Error("PORTFOLIO_EXECUTION_RUNTIME_UNAVAILABLE");
      }
      return portfolioExecution;
    }
  });
}

async function closeServerIfListening(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
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
