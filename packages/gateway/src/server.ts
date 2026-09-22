import { createNativeFeishuRuntime, type NativeFeishuIO } from './services/channels/native-feishu-runtime.js';
import { createNativeTelegramRuntime, type NativeTelegramIO, type NativeTelegramRuntime } from './services/channels/native-telegram-runtime.js';
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
import type { AgentStackDeps } from "./services/agent/agent-stack.js";
import { startAutomationScheduler, type AutomationScheduler } from "./services/automation/scheduler.js";
import { startCopilotRuntime } from "./services/agent/runtime.js";
import { attachDispatchSupervisor, type DispatchSupervisor } from "./services/agent/dispatch-supervisor.js";
import { cliAutonomyAdapters, configureCliAutonomyAdapters } from "./services/adapter-autonomy.js";
import { RuntimeAuthorizationInvalidator } from "./services/runtime-authorization-invalidation.js";
import {
  createRuntimeSettingsStore,
  type RuntimeSettingsEffective,
  type RuntimeSettingsStore
} from "./services/runtime-settings.js";
import type { GatewayEnv } from "./config/env.js";

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
  nativeFeishuIO?: NativeFeishuIO;
  telegramChannelRuntime?: NativeTelegramRuntime | undefined;
  nativeTelegramIO?: NativeTelegramIO;
  registrationMode?: RegistrationMode | (() => RegistrationMode) | undefined;
  accountRecovery?: LocalAccountRecovery | undefined;
  copilotAgent?: AgentStackDeps | undefined;
  runtimeAuthorizationInvalidator: RuntimeAuthorizationInvalidator;
  /** Mounts the external MCP endpoint (/mcp) and its token management routes. */
  mcpEnabled?: boolean | undefined;
  /** DB-backed runtime settings (absent in minimal test apps → API 503). */
  runtimeSettings?: RuntimeSettingsStore | undefined;
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
  nativeFeishuIO?: NativeFeishuIO;
  telegramChannelRuntime?: NativeTelegramRuntime | undefined;
  nativeTelegramIO?: NativeTelegramIO;
  registrationMode?: RegistrationMode | undefined;
  accountRecovery?: LocalAccountRecovery | undefined;
  runtimeAuthorizationInvalidator?: RuntimeAuthorizationInvalidator | undefined;
  /** Session Server IPC endpoint for WebSocket terminal I/O (required: it is the single terminal backend). */
  sessionServerIpcPath: string;
  /**
   * Explicit Session Server handshake token for the terminal I/O stream.
   * Production leaves this unset — SessionServerPty reads the state-dir token
   * file (which survives daemon token rotation). Tests inject it directly.
   */
  sessionServerToken?: string | undefined;
  sessionServerTokenPath?: string | undefined;
  /** Test-only model transport seam for the native Copilot runtime. */
  llmFetch?: typeof fetch | undefined;
  /** Mounts the external MCP endpoint (/mcp) and its token management routes. */
  mcpEnabled?: boolean | undefined;
  /** Enables the dispatch supervisor: hook-driven PM work-item auto-advance for programmatically dispatched tasks. */
  pmAutoDispatchEnabled?: boolean | undefined;
  /**
   * Full process env; when provided the Gateway builds the DB-backed runtime
   * settings store (settings page overrides on top of these defaults) and
   * hot-applies autonomy adapters / session prefix / registration mode /
   * dispatch supervisor changes.
   */
  env?: GatewayEnv | undefined;
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

  // The Claude route data plane carries Anthropic payloads with inlined image
  // blocks (multi-MB); keep the management API at the default body limit.
  // Workspace file edits can carry up to 1 MB of content (plus JSON overhead).
  app.use("/v1", express.json({ limit: "64mb" }));
  app.use("/api/v1/projects/*/workspace/file", express.json({ limit: "2mb" }));
  app.use("/api/v1/copilot/skills", express.json({ limit: "8mb" }));
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

  // DB-backed runtime settings (settings page). The apply hook pushes hot
  // changes into the live process: autonomy whitelist, session name prefix,
  // registration mode (read per request via the getter below) and the
  // dispatch supervisor. mcp_enabled is restart-only (route mounting).
  let dispatchSupervisor: DispatchSupervisor | undefined;
  const runtimeSettings: RuntimeSettingsStore | undefined = options.env
    ? createRuntimeSettingsStore(options.db, {
        env: options.env,
        apply: (effective: RuntimeSettingsEffective) => {
          configureCliAutonomyAdapters([...effective.cliAutonomyAdapters]);
          options.sessionManager.setSessionPrefix(effective.sessionPrefix);
          const wantSupervisor = effective.pmAutoDispatch && cliAutonomyAdapters().length > 0;
          if (wantSupervisor && !dispatchSupervisor) {
            dispatchSupervisor = attachDispatchSupervisor({ db: options.db, eventBus });
          } else if (!wantSupervisor && dispatchSupervisor) {
            dispatchSupervisor.stop();
            dispatchSupervisor = undefined;
          }
        }
      })
    : undefined;
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
  const feishuChannelRuntime = options.feishuChannelRuntime ?? createNativeFeishuRuntime(options.db,options.masterKey,options.nativeFeishuIO);
  const telegramChannelRuntime = options.telegramChannelRuntime ?? createNativeTelegramRuntime(options.db,options.masterKey,options.nativeTelegramIO);

  const app = createServer({
    db: options.db,
    jwtSecret,
    masterKey: options.masterKey,
    sessionManager,
    apiKeyStore,
    eventBus,
    appVersion: options.appVersion ?? "0.0.0",
    adapterCommandRunner: options.adapterCommandRunner,
    feishuChannelRuntime,
    telegramChannelRuntime,
    registrationMode: runtimeSettings
      ? () => runtimeSettings.effective().registration
      : options.registrationMode,
    accountRecovery: options.accountRecovery,
    copilotAgent,
    runtimeAuthorizationInvalidator,
    mcpEnabled: options.mcpEnabled,
    runtimeSettings
  });

  const server = createHttpServer(app);
  let closed = false;
  attachNotificationPersistence({ db: options.db, eventBus });
  // The automation scheduler runs only when the native Copilot harness is
  // mounted (same gate as the /api/v1/copilot routes).
  const automationScheduler: AutomationScheduler | undefined = copilotAgent
    ? startAutomationScheduler(copilotAgent)
    : undefined;
  // The dispatch supervisor advances grant-dispatched PM work items on CLI
  // completion hooks; it requires both operator opt-ins. The runtime settings
  // applier may already have attached (or detached) it, so only fill in the
  // env-driven default when nothing is attached yet.
  if (!dispatchSupervisor) {
    dispatchSupervisor =
      options.pmAutoDispatchEnabled && cliAutonomyAdapters().length > 0
        ? attachDispatchSupervisor({ db: options.db, eventBus })
        : undefined;
  }

  // The Session Server is the single terminal backend; the terminal
  // WebSocket handler relays browser I/O to it over IPC.
  attachTerminalWebSocket({
    server,
    sessionManager,
    jwtSecret,
    db: options.db,
    runtimeAuthorizationInvalidator,
    sessionServerIpcPath: options.sessionServerIpcPath,
    ...(options.sessionServerTokenPath ? { sessionServerTokenPath: options.sessionServerTokenPath } : {}),
    ...(options.sessionServerToken !== undefined
      ? { sessionServerToken: options.sessionServerToken }
      : {})
  });

  attachEventsWebSocket({ server, eventBus, jwtSecret, db: options.db, runtimeAuthorizationInvalidator });
  // Opening the provider connection is intentionally last.
  void feishuChannelRuntime.start().catch(() => {
    console.error("[feishu-runtime] startup failed", { code: "FEISHU_RUNTIME_START_FAILED" });
  });
  void telegramChannelRuntime.start().catch(() => {
    console.error("[telegram-runtime] startup failed", { code: "TELEGRAM_RUNTIME_START_FAILED" });
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
      await runShutdownStage(failures, () => typeof app.locals.stopDelivery === "function" ? app.locals.stopDelivery() : undefined);
      await runShutdownStage(failures, () => feishuChannelRuntime.stop());
      await runShutdownStage(failures, () => telegramChannelRuntime.stop());
      automationScheduler?.stop();
      dispatchSupervisor?.stop();
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
