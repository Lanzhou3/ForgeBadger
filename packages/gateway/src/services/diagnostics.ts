import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { AnySQLiteColumn, AnySQLiteTable } from "drizzle-orm/sqlite-core";

import {
  agents,
  apiKeys,
  auditLogs,
  models,
  notifications,
  projects,
  sessions,
  skills,
  templates
} from "../db/schema.js";
import type { Database } from "../db/types.js";
import { getDashboardSummary } from "./dashboard-summary.js";
import { listAdapterDefinitions } from "./adapter-discovery.js";

export interface LocalDiagnosticsExportInput {
  db: Database;
  userId: string;
  masterKey: string;
  appVersion: string;
  now?: Date;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
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
  copilot: {
    capabilities: {
      enabled: boolean;
      toolExecutionEnabled: boolean;
      approvalRequiredForWrites: boolean;
    };
  };
  environment: Record<string, unknown>;
}

const sensitivePattern = /(secret|token|key|password|credential|authorization)/i;
const sensitiveValuePattern = /(sk-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+)/i;

export function buildLocalDiagnosticsExport(
  input: LocalDiagnosticsExportInput
): LocalDiagnosticsExport {
  const now = input.now ?? new Date();
  const summary = getDashboardSummary(input.db, input.userId, input.masterKey);
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
      agents: countTable(input.db, agents, agents.userId, input.userId),
      skills: countTable(input.db, skills, skills.userId, input.userId),
      templates: countTable(input.db, templates, templates.userId, input.userId),
      models: countTable(input.db, models, models.userId, input.userId),
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
    copilot: {
      capabilities: {
        enabled: true,
        toolExecutionEnabled: true,
        approvalRequiredForWrites: true
      }
    },
    environment: redactDiagnosticValue(pickDiagnosticEnv(input.env ?? process.env)) as Record<string, unknown>
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
