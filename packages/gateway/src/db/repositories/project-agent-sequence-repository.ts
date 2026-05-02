import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { agents, projectAgentSequences, projects } from "../schema.js";
import type { Database } from "../types.js";

export interface ProjectAgentSequenceItem {
  userId: string;
  projectId: string;
  agentId: string;
  position: number;
  name: string;
  description: string | null;
  modelId: string | null;
  tools: string | null;
  allowedDirs: string | null;
  customPrompt: string | null;
  status: string;
}

export class ProjectAgentSequenceRepository {
  private drizzle;

  constructor(
    private readonly db: Database,
    private readonly userId: string
  ) {
    this.drizzle = drizzle(db);
  }

  list(projectId: string): ProjectAgentSequenceItem[] {
    return this.db
      .prepare(`
        SELECT
          pas.user_id AS userId,
          pas.project_id AS projectId,
          pas.agent_id AS agentId,
          pas.position AS position,
          a.name AS name,
          a.description AS description,
          a.model_id AS modelId,
          a.tools AS tools,
          a.allowed_dirs AS allowedDirs,
          a.custom_prompt AS customPrompt,
          a.status AS status
        FROM project_agent_sequences pas
        INNER JOIN agents a ON a.id = pas.agent_id
        WHERE pas.user_id = ? AND pas.project_id = ?
        ORDER BY pas.position ASC
      `)
      .all(this.userId, projectId) as ProjectAgentSequenceItem[];
  }

  replace(projectId: string, agentIds: string[]): ProjectAgentSequenceItem[] {
    this.assertProjectOwned(projectId);
    this.assertUniqueAgentIds(agentIds);
    this.assertAgentsBelongToProject(projectId, agentIds);

    const transaction = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM project_agent_sequences WHERE user_id = ? AND project_id = ?")
        .run(this.userId, projectId);
      const insert = this.db.prepare(
        "INSERT INTO project_agent_sequences (user_id, project_id, agent_id, position) VALUES (?, ?, ?, ?)"
      );
      agentIds.forEach((agentId, position) => {
        insert.run(this.userId, projectId, agentId, position);
      });
    });
    transaction();

    return this.list(projectId);
  }

  private assertProjectOwned(projectId: string): void {
    const project = this.drizzle
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, this.userId)))
      .get();
    if (!project) {
      throw new Error("Project not found");
    }
  }

  private assertUniqueAgentIds(agentIds: string[]): void {
    if (new Set(agentIds).size !== agentIds.length) {
      throw new Error("Duplicate Agent ids are not allowed");
    }
  }

  private assertAgentsBelongToProject(projectId: string, agentIds: string[]): void {
    for (const agentId of agentIds) {
      const agent = this.drizzle
        .select({ id: agents.id, projectId: agents.projectId })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.userId, this.userId)))
        .get();
      if (!agent || agent.projectId !== projectId) {
        throw new Error("Agent must belong to the project");
      }
    }
  }
}
