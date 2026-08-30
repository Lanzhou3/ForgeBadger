/**
 * Aggregate all platform tool seams for the Copilot harness.
 *
 * The whole platform is the copilot's tool surface: projects, sessions,
 * portfolio, memory, and usage statistics. Each seam returns an AgentTool[]
 * that the orchestration layer merges into a single registry.
 */
import type { AgentTool } from "../tool-registry.js";
import { createProjectTools } from "./projects.js";
import { createSessionTools } from "./sessions.js";
import { createPortfolioTools } from "./portfolio.js";
import { createMemoryTools } from "./memory.js";
import { createUsageTools } from "./usage.js";
import { createProjectManagerTools } from "./project-manager.js";
import { createSkillTools } from "./skills.js";
import { createGraphTools } from "./graph.js";

export function createPlatformTools(): AgentTool[] {
  return [
    ...createSkillTools(),
    ...createProjectTools(),
    ...createSessionTools(),
    ...createPortfolioTools(),
    ...createMemoryTools(),
    ...createUsageTools(),
    ...createProjectManagerTools(),
    ...createGraphTools()
  ];
}
