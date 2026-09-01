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
import { createDiagnosticsRoutes } from "./diagnostics.js";
import { createFeishuIntegrationRoutes } from "./integrations-feishu.js";
import { createCopilotRoutes } from "./copilot.js";
import { UserRepository } from "../db/repositories/user-repository.js";

export function mountRoutes(app: Express, deps: ServerDeps): void {
  app.use("/api/v1/health", createHealthRoutes());
  app.use("/api/v1/gate-a/dependencies", createDependencyRoutes());
  app.use("/api/v1/adapters", createAdapterRoutes());
  app.use(
    "/api/v1/auth",
    createAuthRouter(new UserRepository(deps.db), deps.jwtSecret, {
      db: deps.db,
      ...(deps.accountRecovery ? { accountRecovery: deps.accountRecovery } : {}),
      ...(deps.registrationMode ? { registrationMode: deps.registrationMode } : {})
    })
  );
  app.use("/api/v1/admin/users", createAdminUserRoutes(deps.db, deps.runtimeAuthorizationInvalidator));
  app.use(
    "/api/v1/session-hooks",
    createSessionHookRoutes(deps.db, deps.eventBus)
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
    masterKey: deps.masterKey,
    ...(deps.adapterCommandRunner ? { adapterCommandRunner: deps.adapterCommandRunner } : {})
  }));
  app.use("/api/v1/projects", createProjectRoutes(
    deps.db,
    deps.runtimeAuthorizationInvalidator,
    deps.sessionManager,
    deps.eventBus
  ));
  app.use("/api/v1/projects", createProjectGraphRoutes(deps.db));
  app.use("/api/v1/sessions", createSessionRoutes(
    deps.db,
    deps.masterKey,
    deps.sessionManager,
    deps.runtimeAuthorizationInvalidator,
    deps.eventBus,
    deps.adapterCommandRunner
  ));
  app.use("/api/v1/gate-a/sessions", createGateASessionRoutes(deps.sessionManager));
  app.use("/api/v1/templates", createTemplateRoutes(deps.db, deps.eventBus));
  app.use("/api/v1/usage", createUsageRoutes(deps.db, deps.masterKey));
  app.use("/api/v1/model-providers", createModelProviderRoutes(deps.db, deps.masterKey));
  app.use("/api/v1/integrations/feishu", createFeishuIntegrationRoutes({
    db: deps.db,
    masterKey: deps.masterKey,
    ...(deps.feishuChannelRuntime ? { channelRuntime: deps.feishuChannelRuntime } : {})
  }));
  app.use("/api/v1", createSkillRoutes(deps.db));
  app.use("/api/v1/notifications", createNotificationRoutes(deps.db));
  app.use("/api/v1/api-keys", createApiKeyRoutes(deps.db, deps.masterKey));
  app.use("/api/v1/cli-config", createCliConfigRoutes(deps.db, deps.masterKey));
  app.use("/api/v1/dashboard", createDashboardRoutes(deps.db));
  if (deps.copilotAgent) {
    app.use("/api/v1/copilot", createCopilotRoutes(deps.copilotAgent));
  }
  app.use("/api/v1/diagnostics", createDiagnosticsRoutes({
    db: deps.db,
    masterKey: deps.masterKey,
    appVersion: deps.appVersion
  }));
}
