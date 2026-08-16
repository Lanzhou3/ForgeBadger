import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { AnySQLiteColumn, AnySQLiteTable } from "drizzle-orm/sqlite-core";

import {
  apiKeys,
  auditLogs,
  modelProfiles,
  notifications,
  projects,
  sessions,
  skills,
  templates
} from "../db/schema.js";
import { ModelProviderRepository } from "../db/repositories/model-provider-repository.js";
import { ProjectManagerRepository, type ProjectManagerSummary } from "../db/repositories/project-manager-repository.js";
import type { Database } from "../db/types.js";
import { getDashboardSummary } from "./dashboard-summary.js";
import { listAdapterDefinitions } from "./adapter-discovery.js";
import type { FeishuCliStatus } from "./integrations/feishu-cli.js";

export interface LocalDiagnosticsExportInput {
  db: Database;
  userId: string;
  masterKey: string;
  appVersion: string;
  now?: Date;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  feishuStatus?: FeishuCliStatus;
}

export interface LocalDiagnosticsExport {
  generatedAt: string;
  app: {
    name: "OpenForge";
    version: string;
  };
  runtime: {
    node: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  counts: Record<string, number>;
  dashboardHealth: unknown;
  adapters: Array<{
    id: string;
    command: string;
    runtimeModes: string[];
  }>;
  modelProviders: ModelProviderDiagnostics;
  integrations: {
    feishu: FeishuIntegrationDiagnostics;
  };
  projectManager: ProjectManagerSummary;
  environment: Record<string, unknown>;
}

export interface FeishuIntegrationDiagnostics {
  available: boolean;
  version?: string;
  authState: FeishuCliStatus["authState"];
  identityMode: FeishuCliStatus["identityMode"];
  enabled: boolean;
  emergencyDisabled?: boolean;
}

export interface ModelProviderDiagnostics {
  counts: {
    providers: number;
    activeProviders: number;
    models: number;
    activeModels: number;
    credentials: number;
    activeCredentials: number;
    defaultModels: number;
  };
  apiFormats: Record<string, number>;
  providers: Array<{
    id: string;
    name: string;
    providerKey: string;
    apiFormat: string;
    authType: string;
    status: string;
    modelCount: number;
    activeModelCount: number;
    credentialCount: number;
    activeCredentialCount: number;
    hasDefaultModel: boolean;
    readyForUse: boolean;
  }>;
}

const sensitivePattern = /(secret|token|key|password|credential|authorization)/i;
const sensitiveValuePattern = /(sk-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+)/i;

export function buildLocalDiagnosticsExport(
  input: LocalDiagnosticsExportInput
): LocalDiagnosticsExport {
  const now = input.now ?? new Date();
  const summary = getDashboardSummary(input.db, input.userId, input.masterKey);
  const modelProviderDiagnostics = buildModelProviderDiagnostics(input.db, input.userId, input.masterKey);
  return {
    generatedAt: now.toISOString(),
    app: {
      name: "OpenForge",
      version: input.appVersion
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    counts: {
      projects: countTable(input.db, projects, projects.userId, input.userId),
      sessions: countTable(input.db, sessions, sessions.userId, input.userId),
      skills: countTable(input.db, skills, skills.userId, input.userId),
      templates: countTable(input.db, templates, templates.userId, input.userId),
      models: countTable(input.db, modelProfiles, modelProfiles.userId, input.userId),
      apiKeys: countTable(input.db, apiKeys, apiKeys.userId, input.userId),
      notifications: countTable(input.db, notifications, notifications.userId, input.userId),
      auditLogs: countTable(input.db, auditLogs, auditLogs.userId, input.userId)
    },
    dashboardHealth: summary.health,
    adapters: listAdapterDefinitions().map((adapter) => ({
      id: adapter.id,
      command: adapter.command,
      runtimeModes: [...adapter.runtimeModes]
    })),
    modelProviders: modelProviderDiagnostics,
    integrations: {
      feishu: buildFeishuIntegrationDiagnostics(input.feishuStatus)
    },
    projectManager: new ProjectManagerRepository(input.db, input.userId).getSummary(),
    environment: redactDiagnosticValue(pickDiagnosticEnv(input.env ?? process.env)) as Record<string, unknown>
  };
}

function buildFeishuIntegrationDiagnostics(
  status?: FeishuCliStatus
): FeishuIntegrationDiagnostics {
  return {
    available: status?.available ?? false,
    ...(status?.version ? { version: status.version } : {}),
    authState: status?.authState ?? "unknown",
    identityMode: status?.identityMode ?? "unknown",
    enabled: status?.enabled ?? false,
    ...(status?.emergencyDisabled !== undefined ? { emergencyDisabled: status.emergencyDisabled } : {})
  };
}

function buildModelProviderDiagnostics(
  db: Database,
  userId: string,
  masterKey: string
): ModelProviderDiagnostics {
  const repo = new ModelProviderRepository(db, userId, masterKey);
  const providers = repo.listProviderProfiles();
  const models = repo.listModelProfiles();
  const credentials = repo.listCredentials();
  const activeModels = models.filter((model) => model.status === "active");
  const activeCredentials = credentials.filter((credential) => credential.status === "active");

  return {
    counts: {
      providers: providers.length,
      activeProviders: providers.filter((provider) => provider.status === "active").length,
      models: models.length,
      activeModels: activeModels.length,
      credentials: credentials.length,
      activeCredentials: activeCredentials.length,
      defaultModels: models.filter((model) => model.isDefault).length
    },
    apiFormats: countBy(providers, (provider) => provider.apiFormat),
    providers: providers
      .map((provider) => {
        const providerModels = models.filter((model) => model.providerProfileId === provider.id);
        const providerCredentials = credentials.filter((credential) => credential.providerProfileId === provider.id);
        const activeModelCount = providerModels.filter((model) => model.status === "active").length;
        const activeCredentialCount = providerCredentials.filter((credential) => credential.status === "active").length;
        const hasDefaultModel = providerModels.some((model) => model.isDefault);
        return {
          id: provider.id,
          name: provider.name,
          providerKey: provider.providerKey,
          apiFormat: provider.apiFormat,
          authType: provider.authType,
          status: provider.status,
          modelCount: providerModels.length,
          activeModelCount,
          credentialCount: providerCredentials.length,
          activeCredentialCount,
          hasDefaultModel,
          readyForUse: provider.status === "active" &&
            activeModelCount > 0 &&
            (provider.authType === "none" || activeCredentialCount > 0)
        };
      })
      .sort((a, b) => Number(b.readyForUse) - Number(a.readyForUse) || a.name.localeCompare(b.name))
  };
}

export function redactDiagnosticValue(value: unknown, key = ""): unknown {
  if (sensitivePattern.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    if (sensitiveValuePattern.test(value)) {
      return "[redacted]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticValue(item, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactDiagnosticValue(entryValue, entryKey)
      ])
    );
  }
  return value;
}

function pickDiagnosticEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Record<string, string | undefined> {
  return {
    OPENFORGE_HOST: env.OPENFORGE_HOST,
    OPENFORGE_PORT: env.OPENFORGE_PORT,
    OPENFORGE_WEB_HOST: env.OPENFORGE_WEB_HOST,
    OPENFORGE_WEB_PORT: env.OPENFORGE_WEB_PORT,
    OPENFORGE_GATEWAY_URL: env.OPENFORGE_GATEWAY_URL,
    OPENFORGE_DB_PATH: env.OPENFORGE_DB_PATH,
    OPENFORGE_TMUX_PREFIX: env.OPENFORGE_TMUX_PREFIX
  };
}

function countBy<T>(items: T[], keyFor: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countTable(
  db: Database,
  table: AnySQLiteTable,
  userIdColumn: AnySQLiteColumn,
  userId: string
): number {
  const drizzleDb = drizzle(db);
  const row = drizzleDb
    .select({ value: count() })
    .from(table)
    .where(eq(userIdColumn, userId))
    .get();
  return row?.value ?? 0;
}
