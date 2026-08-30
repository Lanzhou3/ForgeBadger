import type { Express } from "express";

import { loadEnv } from "../config/env.js";

import type { ServerDeps } from "../server.js";
import { createHealthRoutes } from "./health.js";
import { createDependencyRoutes } from "./dependencies.js";
import { createAdapterRoutes } from "./adapters.js";
import { createAuthRouter } from "./auth.js";
import { createActivityRoutes } from "./activities.js";
import { createAdminUserRoutes } from "./admin-users.js";
import { createAuditLogRoutes } from "./audit-logs.js";
import { createCatalogRoutes } from "./catalog.js";
import { createProjectRoutes } from "./projects.js";
import { createProjectGraphRoutes } from "./projects-graph.js";
import { createProjectManagerRoutes } from "./project-manager.js";
import { createSessionRoutes, createGateASessionRoutes } from "./sessions.js";
import { createTemplateRoutes } from "./templates.js";
import { createUsageRoutes } from "./usage.js";
import { createModelProviderRoutes } from "./model-providers.js";
import { createSkillRoutes } from "./skills.js";
import { createApiKeyRoutes } from "./api-keys.js";
import { createCliConfigRoutes } from "./cli-config.js";
import { createDashboardRoutes } from "./dashboard.js";
import { createNotificationRoutes } from "./notifications.js";
import { createSessionHookRoutes } from "./session-hooks.js";
import { createSnapshotRoutes } from "./snapshots.js";
import { createCodexSubscriptionRoutes } from "./codex-subscription.js";
import { createDiagnosticsRoutes } from "./diagnostics.js";
import { createFeishuIntegrationRoutes } from "./integrations-feishu.js";
import { createPortfolioRoutes } from "./portfolio.js";
import { createCopilotRoutes } from "./copilot.js";
import { createCopilotBridgeRoutes } from "./internal-copilot-bridge.js";
import { UserRepository } from "../db/repositories/user-repository.js";
import type { AgentStackDeps } from "../services/agent/agent-stack.js";

export function mountRoutes(app: Express, deps: ServerDeps): void {
  const agentDeps: AgentStackDeps = deps.agentDeps ?? {
    db: deps.db,
    masterKey: deps.masterKey,
    eventBus: deps.eventBus,
    sessionManager: deps.sessionManager,
    ...(deps.adapterCommandRunner ? { adapterCommandRunner: deps.adapterCommandRunner } : {}),
    ...(deps.dshBff ? { dshBff: deps.dshBff } : {}),
    ...(deps.portfolioApi ? { portfolioApi: deps.portfolioApi } : {}),
    ...(deps.llmFetch ? { llmFetch: deps.llmFetch } : {})
  };
  app.use("/api/v1/health", createHealthRoutes());
  // Guarded internal API for the deepseek-harness openforge-bridge plugin:
  // mounted only when its service token is configured.
  if (deps.copilotBridgeToken && deps.portfolioApi) {
    const env = loadEnv();
    app.use("/api/internal/v1/copilot-bridge", createCopilotBridgeRoutes({
      db: deps.db,
      sessionManager: deps.sessionManager,
      portfolioApi: deps.portfolioApi,
      bridgeToken: deps.copilotBridgeToken,
      dispatchConfirm: {
        timeoutMs: env.OPENFORGE_DISPATCH_CONFIRM_TIMEOUT_MS,
        intervalMs: env.OPENFORGE_DISPATCH_CONFIRM_INTERVAL_MS
      },
      launchSessionRuntime: async (userId, sessionId) => {
        const { startSessionRuntime } = await import("../services/session-runtime.js");
        try {
          await startSessionRuntime({
            db: deps.db,
            userId,
            masterKey: deps.masterKey,
            eventBus: deps.eventBus,
            sessionManager: deps.sessionManager,
            ...(deps.adapterCommandRunner ? { adapterCommandRunner: deps.adapterCommandRunner } : {})
          }, sessionId);
          return true;
        } catch {
          return false;
        }
      }
    }));
  }
  app.use("/api/v1/gate-a/dependencies", createDependencyRoutes());
  app.use("/api/v1/adapters", createAdapterRoutes());
  app.use(
    "/api/v1/auth",
    createAuthRouter(new UserRepository(deps.db), deps.jwtSecret, {
      db: deps.db,
      registrationMode: loadEnv().OPENFORGE_REGISTRATION
    })
  );
  app.use("/api/v1/admin/users", createAdminUserRoutes(deps.db));
  app.use(
    "/api/v1/session-hooks",
    createSessionHookRoutes(deps.db, deps.eventBus, deps.claudePortfolioWorker)
  );
  app.use("/api/v1/activities", createActivityRoutes(deps.db));
  app.use("/api/v1/audit-logs", createAuditLogRoutes(deps.db));
  app.use("/api/v1/catalog", createCatalogRoutes(deps.db));
  app.use("/api/v1/snapshots", createSnapshotRoutes(
    deps.db,
    deps.masterKey,
    deps.sessionManager,
    deps.eventBus,
    deps.adapterCommandRunner
  ));
  app.use("/api/v1/projects", createProjectManagerRoutes(deps.db, {
    ...(deps.adapterCommandRunner ? { adapterCommandRunner: deps.adapterCommandRunner } : {})
  }));
  app.use("/api/v1/projects", createProjectRoutes(deps.db, deps.sessionManager, deps.eventBus));
  app.use("/api/v1/projects", createProjectGraphRoutes(deps.db));
  app.use("/api/v1/sessions", createSessionRoutes(
    deps.db,
    deps.masterKey,
    deps.sessionManager,
    deps.eventBus,
    deps.adapterCommandRunner
  ));
  app.use("/api/v1/gate-a/sessions", createGateASessionRoutes(deps.sessionManager));
  app.use("/api/v1/templates", createTemplateRoutes(deps.db, deps.eventBus));
  app.use("/api/v1/usage", createUsageRoutes(deps.db, deps.masterKey));
  app.use("/api/v1/model-providers", createModelProviderRoutes(deps.db, deps.masterKey));
  // The signed Feishu callback is intentionally public. Mount it before the
  // broad /api/v1 Skill router, whose router-level auth middleware otherwise
  // rejects unmatched anonymous requests before they reach this route.
  app.use("/api/v1/integrations/feishu", createFeishuIntegrationRoutes({
    db: deps.db,
    masterKey: deps.masterKey,
    ...(deps.feishuChannelRuntime ? { channelRuntime: deps.feishuChannelRuntime } : {}),
    resolveAgentDeps: () => agentDeps,
    ...(deps.feishuWebhookSdkFactory ? { sdkFactory: deps.feishuWebhookSdkFactory } : {})
  }));
  app.use("/api/v1", createSkillRoutes(deps.db));
  app.use("/api/v1/notifications", createNotificationRoutes(deps.db));
  app.use("/api/v1/api-keys", createApiKeyRoutes(deps.db, deps.masterKey));
  app.use("/api/v1/cli-config", createCliConfigRoutes());
  app.use("/api/v1/dashboard", createDashboardRoutes(deps.db, deps.masterKey));
  app.use("/api/v1/codex/subscription", createCodexSubscriptionRoutes());
  if (deps.portfolioApi) {
    app.use("/api/v1/portfolio", createPortfolioRoutes(deps.portfolioApi));
  }
  app.use("/api/v1/copilot", createCopilotRoutes({
    db: deps.db,
    masterKey: deps.masterKey,
    eventBus: deps.eventBus,
    ...(deps.sessionManager ? { sessionManager: deps.sessionManager } : {}),
    ...(deps.adapterCommandRunner ? { adapterCommandRunner: deps.adapterCommandRunner } : {}),
    ...(deps.dshBff ? { dshBff: deps.dshBff } : {}),
    ...(deps.portfolioApi ? { portfolioApi: deps.portfolioApi } : {}),
    ...(deps.llmFetch ? { llmFetch: deps.llmFetch } : {})
  }));
  app.use("/api/v1/diagnostics", createDiagnosticsRoutes({
    db: deps.db,
    masterKey: deps.masterKey,
    appVersion: deps.appVersion
  }));
}
