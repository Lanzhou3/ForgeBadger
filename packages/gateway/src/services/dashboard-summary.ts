import { AgentRepository } from "../db/repositories/agent-repository.js";
import { ApiKeyRepository } from "../db/repositories/api-key-repository.js";
import { ModelRepository } from "../db/repositories/model-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { SessionRepository } from "../db/repositories/session-repository.js";
import { SkillRepository } from "../db/repositories/skill-repository.js";
import { TemplateRepository } from "../db/repositories/template-repository.js";
import type { Database } from "../db/types.js";

export interface DashboardStats {
  projects: number;
  sessions: number;
  runningSessions: number;
  agents: number;
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
  agents: DashboardHealthItem;
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
  const agents = new AgentRepository(db, userId).list();
  const skills = new SkillRepository(db, userId).list();
  const models = new ModelRepository(db, userId).list();
  const apiKeys = new ApiKeyRepository(db, userId, masterKey).list();
  const templateRepo = new TemplateRepository(db, userId);
  const templates = [...templateRepo.listBuiltIn(), ...templateRepo.list()];
  const runningSessions = sessions.filter((session) => session.status === "running");

  const stats: DashboardStats = {
    projects: projects.length,
    sessions: sessions.length,
    runningSessions: runningSessions.length,
    agents: agents.length,
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
      agents: {
        healthy: stats.agents > 0,
        count: stats.agents,
        message: stats.agents > 0 ? "Agents are configured" : "Create a project Agent"
      },
      skills: {
        healthy: stats.skills > 0,
        count: stats.skills,
        message: stats.skills > 0 ? "Skills are configured" : "Create a Skill"
      }
    }
  };
}
