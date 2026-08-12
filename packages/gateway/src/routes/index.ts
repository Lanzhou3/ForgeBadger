import type { Express } from "express";

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
import { createProjectManagerRoutes } from "./project-manager.js";
import { createSessionRoutes, createGateASessionRoutes } from "./sessions.js";
import { createTemplateRoutes } from "./templates.js";
import { createUsageRoutes } from "./usage.js";
import { createModelRoutes } from "./models.js";
import { createModelProviderRoutes } from "./model-providers.js";
import { createAgentRoutes } from "./agents.js";
import { createSkillRoutes } from "./skills.js";
import { createApiKeyRoutes } from "./api-keys.js";
import { createCliConfigRoutes } from "./cli-config.js";
import { createDashboardRoutes } from "./dashboard.js";
import { createNotificationRoutes } from "./notifications.js";
import { createSessionHookRoutes } from "./session-hooks.js";
import { createSnapshotRoutes } from "./snapshots.js";
import {
  createCodexAppServerRoutes,
  isCodexAppServerTurnInputEnabled
} from "./codex-app-server.js";
import { createCodexSubscriptionRoutes } from "./codex-subscription.js";
import { createDiagnosticsRoutes } from "./diagnostics.js";
import { createCopilotRoutes } from "./copilot.js";
import { createFeishuIntegrationRoutes } from "./integrations-feishu.js";
import { UserRepository } from "../db/repositories/user-repository.js";

export function mountRoutes(app: Express, deps: ServerDeps): void {
  app.use("/api/v1/health", createHealthRoutes());
  app.use("/api/v1/gate-a/dependencies", createDependencyRoutes());
  app.use("/api/v1/adapters", createAdapterRoutes());
  app.use("/api/v1/auth", createAuthRouter(new UserRepository(deps.db), deps.jwtSecret));
  app.use("/api/v1/admin/users", createAdminUserRoutes(deps.db));
  app.use("/api/v1/session-hooks", createSessionHookRoutes(deps.db, deps.eventBus));
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
  app.use("/api/v1/projects", createProjectManagerRoutes(deps.db));
  app.use("/api/v1/projects", createProjectRoutes(deps.db, deps.sessionManager, deps.eventBus));
  app.use("/api/v1/sessions", createSessionRoutes(
    deps.db,
    deps.masterKey,
    deps.sessionManager,
    deps.eventBus,
    deps.adapterCommandRunner
  ));
  app.use("/api/v1/gate-a/sessions", createGateASessionRoutes(deps.sessionManager));
  app.use("/api/v1/templates", createTemplateRoutes(deps.db, deps.eventBus));
  app.use("/api/v1/usage", createUsageRoutes(deps.db));
  app.use("/api/v1/models", createModelRoutes(deps.db));
  app.use("/api/v1/model-providers", createModelProviderRoutes(deps.db, deps.masterKey));
  app.use("/api/v1/agents", createAgentRoutes(deps.db));
  app.use("/api/v1", createSkillRoutes(deps.db));
  app.use("/api/v1/notifications", createNotificationRoutes(deps.db));
  app.use("/api/v1/api-keys", createApiKeyRoutes(deps.db, deps.masterKey));
  app.use("/api/v1/cli-config", createCliConfigRoutes());
  app.use("/api/v1/dashboard", createDashboardRoutes(deps.db, deps.masterKey));
  app.use("/api/v1/codex/app-server", createCodexAppServerRoutes({
    db: deps.db,
    manager: deps.codexAppServerManager,
    masterKey: deps.masterKey,
    eventBus: deps.eventBus,
    turnInput: {
      enabled: isCodexAppServerTurnInputEnabled()
    }
  }));
  app.use("/api/v1/codex/subscription", createCodexSubscriptionRoutes());
  app.use("/api/v1/integrations/feishu", createFeishuIntegrationRoutes({
    db: deps.db,
    masterKey: deps.masterKey,
    sessionManager: deps.sessionManager,
    ...(deps.adapterCommandRunner ? { adapterCommandRunner: deps.adapterCommandRunner } : {})
  }));
  app.use("/api/v1/diagnostics", createDiagnosticsRoutes({
    db: deps.db,
    masterKey: deps.masterKey,
    appVersion: deps.appVersion
  }));
  app.use("/api/v1/copilot", createCopilotRoutes({
    db: deps.db,
    masterKey: deps.masterKey,
    appVersion: deps.appVersion,
    sessionManager: deps.sessionManager,
    eventBus: deps.eventBus,
    ...(deps.adapterCommandRunner ? { adapterCommandRunner: deps.adapterCommandRunner } : {})
  }));
}
