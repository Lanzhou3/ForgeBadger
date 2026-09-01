import { TemplateRepository } from "../db/repositories/template-repository.js";
import type { Database } from "../db/types.js";

export interface DashboardStats {
  projects: number;
  sessions: number;
  runningSessions: number;
  skills: number;
  models: number;
  apiKeys: number;
  templates: number;
}

export interface DashboardHealthItem {
  healthy: boolean;
  count?: number;
  message: string;
}

export interface DashboardHealth {
  gateway: DashboardHealthItem;
  database: DashboardHealthItem;
  projectConfig: DashboardHealthItem;
  models: DashboardHealthItem;
  credentials: DashboardHealthItem;
  sessions: DashboardHealthItem;
  skills: DashboardHealthItem;
}

export interface DashboardSummary {
  stats: DashboardStats;
  health: DashboardHealth;
}

type DashboardResourceCounts = Omit<DashboardStats, "templates">;

export function getDashboardResourceCounts(db: Database, userId: string): DashboardResourceCounts {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM projects WHERE user_id = @userId) AS projects,
      (SELECT COUNT(*) FROM sessions WHERE user_id = @userId) AS sessions,
      (SELECT COUNT(*) FROM sessions WHERE user_id = @userId AND status = 'running') AS runningSessions,
      (
        SELECT COUNT(*) FROM skills
        WHERE user_id = @userId OR visibility = 'shared'
          OR (visibility = 'admin' AND EXISTS (
            SELECT 1 FROM users WHERE id = @userId AND role = 'admin'
          ))
      ) AS skills,
      (SELECT COUNT(*) FROM model_profiles WHERE user_id = @userId) AS models,
      (SELECT COUNT(*) FROM api_keys WHERE user_id = @userId) AS apiKeys
  `).get({ userId }) as DashboardResourceCounts;
  return row;
}

export function getDashboardSummary(
  db: Database,
  userId: string
): DashboardSummary {
  const stats: DashboardStats = {
    ...getDashboardResourceCounts(db, userId),
    templates: new TemplateRepository(db, userId).countReadable()
  };

  return {
    stats,
    health: {
      gateway: { healthy: true, message: "Gateway is responding" },
      database: { healthy: true, message: "Database query completed" },
      projectConfig: {
        healthy: stats.projects > 0 && stats.templates > 0,
        count: stats.projects,
        message: stats.projects > 0 ? "Projects can use available templates" : "Create or import a project"
      },
      models: {
        healthy: stats.models > 0,
        count: stats.models,
        message: stats.models > 0 ? "Models are configured" : "Add a model before launching stored sessions"
      },
      credentials: {
        healthy: stats.apiKeys > 0,
        count: stats.apiKeys,
        message: stats.apiKeys > 0 ? "Encrypted API keys are available" : "Add an API key for stored credentials"
      },
      sessions: {
        healthy: stats.sessions > 0,
        count: stats.sessions,
        message: stats.sessions > 0 ? "Sessions exist" : "Create a session from a project"
      },
      skills: {
        healthy: stats.skills > 0,
        count: stats.skills,
        message: stats.skills > 0 ? "Skills are configured" : "Create a Skill"
      }
    }
  };
}
