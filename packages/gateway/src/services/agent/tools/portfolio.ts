/**
 * Portfolio tools for the Copilot harness — the "portfolio progress" seam.
 * Read tools expose portfolio progress (overview, requests, dossiers, work
 * items) via the Portfolio API facade. The operate tool (advance a work item
 * state) is approval-gated and only fires after the owner approves it.
 */
import { z } from "zod";
import type { PortfolioUserApi } from "../../portfolio/portfolio-api-service.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";

const listRequestsInput = z.object({
  projectId: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(100).optional()
}).strict();

const getDossierInput = z.object({
  projectId: z.string().min(1).max(128)
}).strict();

const getWorkItemInput = z.object({
  workItemId: z.string().min(1).max(128)
}).strict();

const advanceWorkItemInput = z.object({
  workItemId: z.string().min(1).max(128),
  toState: z.enum(["in_progress", "ready_for_review", "done", "blocked", "cancelled"]),
  attemptId: z.string().optional(),
  idempotencyKey: z.string().min(1).max(200)
}).strict();

function portfolioApi(context: AgentToolContext): PortfolioUserApi | undefined {
  return context.portfolioApi as PortfolioUserApi | undefined;
}

export function createPortfolioTools(): AgentTool[] {
  return [
    {
      name: "portfolio_overview",
      description: "Get portfolio overview: enrolled projects, open work items, and recent activity.",
      risk: "read",
      requiresApproval: false,
      inputSchema: z.object({}).strict(),
      async execute(_input, context) {
        const api = portfolioApi(context);
        if (!api) return { available: false, reason: "Portfolio is not enabled" };
        return { available: true, overview: api.getOverview({}) };
      }
    },
    {
      name: "list_portfolio_requests",
      description: "List portfolio requests, optionally filtered by project.",
      risk: "read",
      requiresApproval: false,
      inputSchema: listRequestsInput,
      async execute(input, context) {
        const api = portfolioApi(context);
        if (!api) return { available: false, reason: "Portfolio is not enabled" };
        const { projectId, limit } = listRequestsInput.parse(input);
        const requests = api.listRequests({ ...(projectId !== undefined ? { projectId } : {}), limit: limit ?? 50 });
        return { requests, count: Array.isArray(requests) ? requests.length : 0 };
      }
    },
    {
      name: "get_project_dossier",
      description: "Get a project's portfolio dossier (objective, intended outcome, current evidence).",
      risk: "read",
      requiresApproval: false,
      inputSchema: getDossierInput,
      async execute(input, context) {
        const api = portfolioApi(context);
        if (!api) return { available: false, reason: "Portfolio is not enabled" };
        const { projectId } = getDossierInput.parse(input);
        return { dossier: api.getDossier(projectId) };
      }
    },
    {
      name: "get_work_item",
      description: "Get a portfolio work item by id.",
      risk: "read",
      requiresApproval: false,
      inputSchema: getWorkItemInput,
      async execute(input, context) {
        const api = portfolioApi(context);
        if (!api) return { available: false, reason: "Portfolio is not enabled" };
        const { workItemId } = getWorkItemInput.parse(input);
        return { workItem: api.getWorkItem(workItemId) };
      }
    },
    {
      name: "advance_work_item",
      description: "Advance a portfolio work item's state (approval required).",
      risk: "operate",
      requiresApproval: true,
      riskClass: "high",
      inputSchema: advanceWorkItemInput,
      async execute(input, context) {
        const api = portfolioApi(context);
        if (!api) throw new Error("PORTFOLIO_UNAVAILABLE");
        const parsed = advanceWorkItemInput.parse(input);
        const transition = api.transition({
          recordType: "work_item",
          recordId: parsed.workItemId,
          toState: parsed.toState,
          expectedProjectionVersion: 1,
          ...(parsed.attemptId ? { attemptId: parsed.attemptId } : {}),
          idempotencyKey: parsed.idempotencyKey
        });
        return { advanced: true, transition };
      }
    }
  ];
}
