import express from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";

import { InMemoryApiKeyStore } from "./secrets/api-key-store.js";
import { InMemorySessionManager } from "./services/session-manager.js";
import { CodexAppServerManager } from "./services/codex-app-server-manager.js";
import { OpenForgeEventBus } from "./services/event-bus.js";
import { attachNotificationPersistence } from "./services/notification-events.js";
import { attachCodexAppServerNotificationPersistence } from "./services/codex-app-server-events.js";
import { attachTerminalWebSocket } from "./websocket/terminal.js";
import { attachEventsWebSocket } from "./websocket/events.js";
import type { Database } from "./db/types.js";
import type { CommandRunner } from "./lib/dependency-check.js";

import { mountRoutes } from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.js";

export interface ServerDeps {
  db: Database;
  jwtSecret: string;
  masterKey: string;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: OpenForgeEventBus;
  codexAppServerManager: CodexAppServerManager;
  appVersion: string;
  adapterCommandRunner?: CommandRunner | undefined;
}

export interface GatewayApp {
  app: express.Express;
  server: Server;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: OpenForgeEventBus;
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
  codexAppServerManager?: CodexAppServerManager;
  appVersion?: string;
  adapterCommandRunner?: CommandRunner | undefined;
}

export function createServer(deps: ServerDeps): express.Express {
  const app = express();
  app.locals.jwtSecret = deps.jwtSecret;

  app.use((request, response, next) => {
    const origin = request.headers.origin;
    if (isAllowedLocalWebOrigin(origin)) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
    }
    response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    response.setHeader("access-control-allow-headers", "authorization,content-type");
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
  const codexAppServerManager = options.codexAppServerManager ?? new CodexAppServerManager({
    runtimeRoot: defaultRuntimeRoot()
  });
  const recoveryReady = Promise.resolve();

  const app = createServer({
    db: options.db,
    jwtSecret,
    masterKey: options.masterKey,
    sessionManager,
    apiKeyStore,
    eventBus,
    codexAppServerManager,
    appVersion: options.appVersion ?? "0.0.0",
    adapterCommandRunner: options.adapterCommandRunner
  });

  const server = createHttpServer(app);
  let closed = false;
  attachNotificationPersistence({ db: options.db, eventBus });
  attachCodexAppServerNotificationPersistence({
    db: options.db,
    manager: codexAppServerManager,
    eventBus
  });
  attachTerminalWebSocket({ server, sessionManager, jwtSecret });
  attachEventsWebSocket({ server, eventBus, jwtSecret });

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

      try {
        codexAppServerManager.stopAll();
        await closeServerIfListening(server);
      } finally {
        options.db.close();
      }
    }
  };
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

function defaultRuntimeRoot(): string {
  return path.join(process.env.OPENFORGE_STATE_DIR?.trim() || path.join(homedir(), ".openforge"), "runtime");
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
