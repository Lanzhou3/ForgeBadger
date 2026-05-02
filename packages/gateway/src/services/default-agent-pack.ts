import type { Database } from "../db/types.js";
import { AgentRepository, type Agent } from "../db/repositories/agent-repository.js";
import { ProjectAgentSequenceRepository, type ProjectAgentSequenceItem } from "../db/repositories/project-agent-sequence-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { listAgentTemplates } from "./agent-templates.js";

export interface DefaultAgentPackResult {
  agents: Agent[];
  created: Agent[];
  skipped: Agent[];
  sequence: ProjectAgentSequenceItem[];
}

export function createDefaultAgentPack(
  db: Database,
  userId: string,
  projectId: string
): DefaultAgentPackResult | undefined {
  const project = new ProjectRepository(db, userId).getById(projectId);
  if (!project) return undefined;

  const agentRepo = new AgentRepository(db, userId);
  const existingProjectAgents = agentRepo
    .list()
    .filter((agent) => agent.projectId === projectId);
  const existingByName = new Map(existingProjectAgents.map((agent) => [agent.name, agent]));
  const created: Agent[] = [];
  const skipped: Agent[] = [];

  for (const template of listAgentTemplates()) {
    const existing = existingByName.get(template.name);
    if (existing) {
      skipped.push(existing);
      continue;
    }

    const agent = agentRepo.create({
      projectId,
      name: template.name,
      description: template.description,
      tools: template.tools,
      allowedDirs: template.allowedDirs,
      customPrompt: template.customPrompt
    });
    created.push(agent);
    existingByName.set(agent.name, agent);
  }

  const orderedAgents = listAgentTemplates()
    .map((template) => existingByName.get(template.name))
    .filter((agent): agent is Agent => Boolean(agent));
  const sequence = new ProjectAgentSequenceRepository(db, userId).replace(
    projectId,
    orderedAgents.map((agent) => agent.id)
  );

  return {
    agents: orderedAgents,
    created,
    skipped,
    sequence
  };
}
