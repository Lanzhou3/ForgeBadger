/**
 * Aggregate all platform tool seams for the Copilot harness.
 *
 * The whole platform is the copilot's tool surface: projects, sessions,
 * portfolio, and memory. Each seam returns an AgentTool[] that the orchestration
 * layer merges into a single registry.
 */
import type { AgentTool } from "../tool-registry.js";
import { createProjectTools } from "./projects.js";
import { createSessionTools } from "./sessions.js";
import { createPortfolioTools } from "./portfolio.js";
import { createMemoryTools } from "./memory.js";

export function createPlatformTools(): AgentTool[] {
  return [
    ...createProjectTools(),
    ...createSessionTools(),
    ...createPortfolioTools(),
    ...createMemoryTools()
  ];
}
