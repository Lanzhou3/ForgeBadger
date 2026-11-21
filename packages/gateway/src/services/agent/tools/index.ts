import { createNativeLifecycleTools } from '../../mcp/lifecycle-tools.js';
import { createProjectDiffTools } from './project-diff.js';
import { createResearchTools } from "./research.js";
import { createResearchReportTool } from "./research-report.js";
import { createSourceSearchTools } from "./source-search.js";
import { createMachineSearchTools } from "./machine-search.js";
import { createMachineRootTools, createMachineRootListTools } from "./machine-roots.js";
import { createDeepResearchTools } from "./deep-research.js";
import { createProjectFileTools } from './project-files.js';
import { createPlatformCoverageTools } from "./platform-coverage.js";
import { createToolResultTools } from "./tool-results.js";
import { createPlatformManagementTools } from "./platform-management.js";
/**
 * Aggregate all platform tool seams for the Copilot harness.
 *
 * The whole platform is the copilot's tool surface: projects, sessions,
 * Project Manager, memory, and usage statistics. Each seam returns an AgentTool[]
 * that the orchestration layer merges into a single registry.
 */
import type { AgentTool } from "../tool-registry.js";
import { createProjectTools } from "./projects.js";
import { createSessionTools } from "./sessions.js";
import { createTerminalTools } from "./terminal.js";
import { createMemoryTools } from "./memory.js";
import { createUsageTools } from "./usage.js";
import { createProjectManagerTools } from "./project-manager.js";
import { createSkillTools } from "./skills.js";
import { createGraphTools } from "./graph.js";
import { createGoalTools } from "./goals.js";
import { createGoalSandboxTools } from "./goal-sandbox.js";
import { createGoalDelegateTools } from "./goal-delegate.js";
import { createGoalIntegrateTools } from "./goal-integrate.js";
import { createGoalReviewTools } from "./goal-review.js";
import { createFleetTools } from "./fleet.js";
import { createPlanTools } from "./plan.js";
import { createModeTools } from "./mode.js";

export function createPlatformTools(): AgentTool[] {
  return [
    ...createProjectDiffTools(),
    ...createResearchTools(),
    createResearchReportTool(),
    ...createSourceSearchTools(),
    ...createMachineSearchTools(),
    ...createMachineRootTools(),
    ...createMachineRootListTools(),
    ...createDeepResearchTools(),
    ...createProjectFileTools(),
    ...createPlatformCoverageTools(),
    ...createToolResultTools(),
    ...createPlatformManagementTools(),
    ...createNativeLifecycleTools(),
    ...createSkillTools(),
    ...createProjectTools(),
    ...createSessionTools(),
    ...createTerminalTools(),
    ...createMemoryTools(),
    ...createUsageTools(),
    ...createProjectManagerTools(),
    ...createGraphTools(),
    ...createGoalTools(),
    ...createGoalSandboxTools(),
    ...createGoalDelegateTools(),
    ...createGoalIntegrateTools(),
    ...createGoalReviewTools(),
    ...createFleetTools(),
    ...createPlanTools(),
    ...createModeTools(),
  ];
}
