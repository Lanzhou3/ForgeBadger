import {createTeamRoutes} from './teams.js';
import {TeamService} from '../services/teams/service.js';
import {createDeliveryActionsRoutes} from './collaboration-delivery-actions.js';
import { homedir } from 'node:os';
import path from 'node:path';
import { createTaskArtifactLinkRoutes } from './task-artifact-links.js';
import { createCollaborationRoutes } from './collaboration.js';
import { DeliveryService } from '../services/collaboration/delivery-service.js';
import { createCopilotChannelRoutes } from "./copilot-channels.js";
import { createChannelDiagnosticsRoutes } from "./channel-diagnostics.js";
import { createPlatformActionRoutes } from "./platform-actions.js";
import { createProjectManagementRoutes } from "./project-management.js";
import { PlatformActions } from "../services/platform-commands/actions.js";
import { createPlatformCommands } from "../services/platform-commands/catalog.js";
import { randomUUID } from "node:crypto";
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
import { createCliAccountRoutes } from "./cli-accounts.js";
import { createSkillRoutes } from "./skills.js";
import { createApiKeyRoutes } from "./api-keys.js";
import { createCliConfigRoutes } from "./cli-config.js";
import { createClaudeRouteRoutes } from "./claude-route.js";
import { createDashboardRoutes } from "./dashboard.js";
import { createNotificationRoutes } from "./notifications.js";
import { createSessionHookRoutes } from "./session-hooks.js";
import { createSnapshotRoutes } from "./snapshots.js";
import { createDiagnosticsRoutes } from "./diagnostics.js";
import { createFeishuIntegrationRoutes } from "./integrations-feishu.js";
import { createTelegramIntegrationRoutes } from "./integrations-telegram.js";
import { createCopilotRoutes } from "./copilot.js";
import { createAutomationRoutes } from "./automations.js";
import { createMcpRoutes } from "./mcp.js";
import { createMcpStatusRoutes } from "./mcp-status.js";
import { createMcpTokenRoutes } from "./mcp-tokens.js";
import { createSystemRoutes } from "./system.js";
import { createRuntimeSettingsRoutes } from "./runtime-settings.js";
import { UserRepository } from "../db/repositories/user-repository.js";

export function mountRoutes(app: Express, deps: ServerDeps): void {
  app.use("/api/v1/health", createHealthRoutes());
  const collaborationOptions = {db:deps.db,sessionManager:deps.sessionManager,invalidator:deps.runtimeAuthorizationInvalidator,
    workspacesRoot:path.join(process.env.FORGEBADGER_STATE_DIR ?? path.join(homedir(),'.forgebadger'),'workspaces')};
  const delivery = new DeliveryService(collaborationOptions);
  delivery.recoverInterrupted();
  const teams=new TeamService(delivery);
  delivery.afterSweep=()=>teams.sweep();
  const deliverySweep = setInterval(() => {
    if(!deps.db.open) { clearInterval(deliverySweep);return; }
    void delivery.sweep().catch(() => { if(deps.db.open) console.error('[collaboration] recovery sweep failed'); });
  },1000);
  deliverySweep.unref();
  app.locals.stopDelivery = async () => { clearInterval(deliverySweep); await delivery.shutdown(); };
  app.use('/api/v1/collaboration',createCollaborationRoutes(collaborationOptions,delivery));
  app.use('/api/v1/collaboration',createDeliveryActionsRoutes(delivery));
  app.use('/api/v1/collaboration',createTaskArtifactLinkRoutes(deps.db));
  app.use('/api/v1/teams',createTeamRoutes(delivery));
  app.use("/api/v1/gate-a/dependencies", createDependencyRoutes(deps.sessionManager));
  app.use("/api/v1/adapters", createAdapterRoutes(deps.sessionManager));
  app.use(
    "/api/v1/auth",
    createAuthRouter(new UserRepository(deps.db), deps.jwtSecret, {
      db: deps.db,
      invalidator:deps.runtimeAuthorizationInvalidator,
      ...(deps.accountRecovery ? { accountRecovery: deps.accountRecovery } : {}),
      ...(deps.registrationMode ? { registrationMode: deps.registrationMode } : {})
    })
  );
  app.use("/api/v1/admin/users", createAdminUserRoutes(deps.db, deps.runtimeAuthorizationInvalidator));
  app.use("/api/v1/runtime-settings", createRuntimeSettingsRoutes(deps.db, deps.runtimeSettings));
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
    sessionManager: deps.sessionManager,
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
  app.use("/api/v1/model-providers", createModelProviderRoutes(deps.db, deps.masterKey, {
    eventBus: deps.eventBus
  }));
  app.use("/api/v1/cli-accounts", createCliAccountRoutes());
  app.use("/api/v1/integrations/feishu", createFeishuIntegrationRoutes({
    db: deps.db,
    masterKey: deps.masterKey,
    ...(deps.feishuChannelRuntime ? { channelRuntime: deps.feishuChannelRuntime } : {})
  }));
  app.use("/api/v1/integrations/telegram", createTelegramIntegrationRoutes({
    db: deps.db,
    masterKey: deps.masterKey,
    ...(deps.telegramChannelRuntime ? { channelRuntime: deps.telegramChannelRuntime } : {})
  }));
  app.use("/api/v1", createSkillRoutes(deps.db));
  app.use("/api/v1/notifications", createNotificationRoutes(deps.db));
  app.use("/api/v1/api-keys", createApiKeyRoutes(deps.db, deps.masterKey));
  app.use("/api/v1/cli-config", createCliConfigRoutes(deps.db, deps.masterKey, {
    eventBus: deps.eventBus
  }));
  app.use("/api/v1/dashboard", createDashboardRoutes(deps.db));
  app.use("/api/v1/copilot/channels", createCopilotChannelRoutes({ db: deps.db, masterKey: deps.masterKey }));
  app.use("/api/v1/channels", createChannelDiagnosticsRoutes({ db: deps.db, masterKey: deps.masterKey }));
  app.use("/api/v1", createPlatformActionRoutes({db:deps.db,masterKey:deps.masterKey,sessionManager:deps.sessionManager,adapterCommandRunner:deps.adapterCommandRunner,eventBus:deps.eventBus}));
  app.use("/api/v1", createProjectManagementRoutes(deps.db, (userId,commandId,input) => new PlatformActions({db:deps.db,userId},createPlatformCommands()).executeOwner(commandId,input,randomUUID())));
  if (deps.copilotAgent) {
    app.use("/api/v1/copilot", createCopilotRoutes(deps.copilotAgent));
    app.use("/api/v1/copilot", createAutomationRoutes(deps.copilotAgent));
  }
  app.use("/api/v1/diagnostics", createDiagnosticsRoutes({
    db: deps.db,
    masterKey: deps.masterKey,
    appVersion: deps.appVersion
  }));
  app.use("/api/v1/system", createSystemRoutes());
  // Status probe is unconditional so the console can render the disabled state.
  app.use("/api/v1/mcp", createMcpStatusRoutes({ mcpEnabled: deps.mcpEnabled }));
  if (deps.mcpEnabled) {
    app.use("/api/v1/mcp/tokens", createMcpTokenRoutes(deps.db));
    app.use("/mcp", createMcpRoutes(deps));
  }
  // Claude Code protocol routing data plane (route-token auth, not JWT).
  app.use("/v1", createClaudeRouteRoutes(deps.db, deps.masterKey));
}
