import express from "express";
import { createServer as createHttpServer, type Server } from "node:http";

import { InMemoryApiKeyStore } from "./secrets/api-key-store.js";
import { InMemorySessionManager } from "./services/session-manager.js";
import { ForgeBadgerEventBus } from "./services/event-bus.js";
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
import { buildAgentStack, type AgentStackDeps } from "./services/agent/agent-stack.js";
import { DshProcessManager, type DshProcessManagerOptions } from "./services/dsh-copilot/process-manager.js";
import { createDshCopilotBff, type DshCopilotBff } from "./services/dsh-copilot/bff-service.js";
import { createCordisConfigRenderer } from "./services/dsh-copilot/dsh-config.js";
import type { DispatchConfirmOptions } from "./services/copilot-bridge/delivery-confirm.js";
import type { FeishuSdkFactory } from "./services/integrations/feishu-sdk.js";
import type { RegistrationMode } from "./routes/auth.js";
import { drainFeishuCopilotChatQueues } from "./services/integrations/feishu-copilot-channel.js";

import { mountRoutes } from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.js";

export interface ServerDeps {
  db: Database;
  jwtSecret: string;
  masterKey: string;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: ForgeBadgerEventBus;
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
  /** One production-composed dependency set shared by HTTP and Feishu transports. */
  agentDeps?: AgentStackDeps | undefined;
  /** Test-only external SDK boundary for signed Feishu webhook delivery. */
  feishuWebhookSdkFactory?: FeishuSdkFactory | undefined;
  registrationMode?: RegistrationMode | undefined;
  dispatchConfirm?: DispatchConfirmOptions | undefined;
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
  eventBus: ForgeBadgerEventBus;
  internalServices: GatewayInternalServices;
  recoveryReady: Promise<void>;
  /**
   * Proactive Copilot reactive loop handle; present only when opted in via
   * FORGEBADGER_COPILOT_REACTIVE_ENABLED. close() stops it automatically.
   */
  reactiveLoop?: ReturnType<typeof attachCopilotReactiveLoop> | undefined;
  close(): Promise<void>;
}

export interface GatewayAppOptions {
  jwtSecret: string;
  masterKey: string;
  db: Database;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus?: ForgeBadgerEventBus;
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
  /** Test-only external SDK boundary for signed Feishu webhook delivery. */
  feishuWebhookSdkFactory?: FeishuSdkFactory | undefined;
  /**
   * Opt-in (FORGEBADGER_COPILOT_REACTIVE_ENABLED, default off): attach the
   * proactive Copilot reactive loop. When off, Copilot never self-starts
   * report conversations.
   */
  copilotReactiveEnabled?: boolean | undefined;
  /** Delivery read-back budget for the bridge dispatch path (from env in start-gateway). */
  dispatchConfirm?: DispatchConfirmOptions | undefined;
  registrationMode?: RegistrationMode | undefined;
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
  const eventBus = options.eventBus ?? new ForgeBadgerEventBus();
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
      ...(options.llmFetch ? { llmFetch: options.llmFetch } : {}),
      ...(options.dispatchConfirm ? { dispatchConfirm: options.dispatchConfirm } : {})
    })
    : undefined;
  const agentDeps: AgentStackDeps = {
    db: options.db,
    masterKey: options.masterKey,
    eventBus,
    portfolioApi,
    sessionManager,
    ...(options.adapterCommandRunner ? { adapterCommandRunner: options.adapterCommandRunner } : {}),
    ...(dshBff ? { dshBff } : {}),
    ...(options.llmFetch ? { llmFetch: options.llmFetch } : {})
  };

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
    agentDeps,
    registrationMode: options.registrationMode,
    dispatchConfirm: options.dispatchConfirm,
    ...(options.feishuWebhookSdkFactory ? { feishuWebhookSdkFactory: options.feishuWebhookSdkFactory } : {}),
    ...(dshBff ? { dshBff } : {}),
    ...(options.llmFetch ? { llmFetch: options.llmFetch } : {})
  });

  const server = createHttpServer(app);
  let closed = false;
  attachNotificationPersistence({ db: options.db, eventBus });
  attachTerminalWebSocket({ server, sessionManager, jwtSecret, db: options.db });
  attachEventsWebSocket({ server, eventBus, jwtSecret, db: options.db });
  // Proactive copilot: opt-in via FORGEBADGER_COPILOT_REACTIVE_ENABLED. When
  // off, no listener is attached — Copilot never wakes itself on events.
  const reactiveLoop = options.copilotReactiveEnabled
    ? attachCopilotReactiveLoop({
      deps: agentDeps,
      buildAgentStack
    })
    : undefined;
  // Feishu Copilot channel: the runtime is built in startup before the
  // Portfolio facade exists, so its agent deps attach here once in scope.
  options.feishuChannelRuntime?.attachAgentDeps(agentDeps);
  // Opening the provider connection is intentionally last: an inbound event
  // can only arrive after the complete shared AgentStackDeps are visible.
  void options.feishuChannelRuntime?.start().catch(() => {
    console.error("[feishu-runtime] startup failed", { code: "FEISHU_RUNTIME_START_FAILED" });
  });

  return {
    app,
    server,
    sessionManager,
    apiKeyStore,
    eventBus,
    internalServices,
    recoveryReady,
    reactiveLoop,
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
      const httpResult = await httpCloseResult;
      if (!httpResult.ok) {
        failures.push(httpResult.error);
      }
      await runShutdownStage(failures, () => drainFeishuCopilotChatQueues(options.db));
      await runShutdownStage(failures, () => reactiveLoop?.stop());
      await runShutdownStage(failures, () => options.operationsRuntime?.stop());
      await runShutdownStage(failures, () => dshProcessManager?.disposeAll());
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
