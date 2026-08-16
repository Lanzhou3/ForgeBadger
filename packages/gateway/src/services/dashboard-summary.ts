import { ApiKeyRepository } from "../db/repositories/api-key-repository.js";
import { ModelProviderRepository } from "../db/repositories/model-provider-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { SessionRepository } from "../db/repositories/session-repository.js";
import { SkillRepository } from "../db/repositories/skill-repository.js";
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

export function getDashboardSummary(
  db: Database,
  userId: string,
  masterKey: string
): DashboardSummary {
  const projects = new ProjectRepository(db, userId).list();
  const sessions = new SessionRepository(db, userId).list();
  const skills = new SkillRepository(db, userId).list();
  const models = new ModelProviderRepository(db, userId, masterKey).listModelProfiles();
  const apiKeys = new ApiKeyRepository(db, userId, masterKey).list();
  const templateRepo = new TemplateRepository(db, userId);
  const templates = [...templateRepo.listBuiltIn(), ...templateRepo.list()];
  const runningSessions = sessions.filter((session) => session.status === "running");

  const stats: DashboardStats = {
    projects: projects.length,
    sessions: sessions.length,
    runningSessions: runningSessions.length,
    skills: skills.length,
    models: models.length,
    apiKeys: apiKeys.length,
    templates: templates.length
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
