/**
 * Project graph tools for the Copilot harness — read-only access to a
 * project's local CodeGraph index. Lets the model answer "who calls this",
 * "what breaks if we touch X", and "which symbols do these changed files
 * affect" from real dependency data instead of guessing.
 *
 * All queries go through services/copilot-bridge/bridge-service.ts so the
 * internal HTTP surface and these tools share one tenant-scoped
 * implementation.
 */
import { z } from "zod";
import {
  getProjectGraphAffectedPaths,
  getProjectGraphSymbol,
  getProjectGraphSymbolImpact,
  searchProjectGraphSymbols
} from "../../copilot-bridge/bridge-service.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";

const searchInput = z.object({
  projectId: z.string().min(1).max(128),
  q: z.string().trim().min(1).max(100),
  kind: z.string().trim().min(1).max(32).optional(),
  limit: z.number().int().min(1).max(20).optional()
}).strict();

const symbolDetailInput = z.object({
  projectId: z.string().min(1).max(128),
  symbolId: z.string().min(1).max(256)
}).strict();

const impactInput = z.object({
  projectId: z.string().min(1).max(128),
  symbolId: z.string().min(1).max(256),
  depth: z.number().int().min(1).max(3).optional()
}).strict();

const affectedPathsInput = z.object({
  projectId: z.string().min(1).max(128),
  paths: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(256)
        .refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), {
          message: "paths must be project-relative without traversal segments"
        })
    )
    .min(1)
    .max(50),
  depth: z.number().int().min(1).max(3).optional()
}).strict();

export function createGraphTools(): AgentTool[] {
  return [
    {
      name: "project_graph_search",
      description:
        "Search code symbols in one project's CodeGraph index by name (functions, classes, interfaces, routes). Returns symbol ids usable with project_graph_symbol_detail / project_graph_impact. Unavailable when the project has no index (codegraph init not run).",
      risk: "read",
      requiresApproval: false,
      inputSchema: searchInput,
      async execute(input, context) {
        const parsed = searchInput.parse(input);
        const result = searchProjectGraphSymbols(context.db, context.userId, parsed.projectId, {
          q: parsed.q,
          ...(parsed.kind !== undefined ? { kind: parsed.kind } : {}),
          ...(parsed.limit !== undefined ? { limit: parsed.limit } : {})
        });
        return result;
      }
    },
    {
      name: "project_graph_symbol_detail",
      description:
        "Get one code symbol's definition (file + line) plus its direct callers and callees from the project's CodeGraph index.",
      risk: "read",
      requiresApproval: false,
      inputSchema: symbolDetailInput,
      async execute(input, context) {
        const parsed = symbolDetailInput.parse(input);
        return getProjectGraphSymbol(context.db, context.userId, parsed.projectId, parsed.symbolId);
      }
    },
    {
      name: "project_graph_impact",
      description:
        "Compute the blast radius of changing one code symbol: the reverse call/reference closure up to `depth` hops, with affected file paths and lines.",
      risk: "read",
      requiresApproval: false,
      inputSchema: impactInput,
      async execute(input, context) {
        const parsed = impactInput.parse(input);
        const depth = parsed.depth ?? 2;
        return getProjectGraphSymbolImpact(context.db, context.userId, parsed.projectId, parsed.symbolId, depth);
      }
    },
    {
      name: "project_graph_affected_paths",
      description:
        "Compute which code symbols are affected by changes to given files (project-relative paths, e.g. from git status): multi-file reverse blast radius with per-symbol depth.",
      risk: "read",
      requiresApproval: false,
      inputSchema: affectedPathsInput,
      async execute(input, context) {
        const parsed = affectedPathsInput.parse(input);
        const depth = parsed.depth ?? 2;
        return getProjectGraphAffectedPaths(context.db, context.userId, parsed.projectId, parsed.paths, depth);
      }
    }
  ];
}
