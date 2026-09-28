import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { ProjectRepository, type Project } from "../db/repositories/project-repository.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import {
  ProjectGraphPathError,
  getChangedPathsImpact,
  getFileGraph,
  getGraphOverview,
  getSymbolDetail,
  getSymbolImpact,
  searchGraphSymbols
} from "../services/project-graph.js";
import type { Database } from "../db/types.js";

/**
 * Read-only project graph endpoints backed by the project's local CodeGraph
 * index (`{projectRoot}/.codegraph/codegraph.db`). Degraded states (index
 * absent / unsupported schema) are returned as
 * `200 { available: false, reason }` so clients can render setup guidance;
 * unsafe configured roots map to 400.
 */

const DEFAULT_FILE_GRAPH_LIMIT = 80;
const DEFAULT_AFFECTED_DEPTH = 2;

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  kind: z.string().trim().min(1).max(32).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

const impactQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(3).optional()
});

const fileGraphQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const affectedBodySchema = z.object({
  // Changed file paths, project-relative (typically from git status).
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
});

type GraphHandler = (req: Request, res: Response) => void;

export function createProjectGraphRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  // Read-only SQLite aggregates are cheap; the limiter only guards against
  // request floods, so it is generous compared to credential endpoints.
  const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 120 });

  function resolveProject(req: Request, res: Response): Project | null {
    const userId = (req as AuthenticatedRequest).userId;
    const projectId = req.params.id ?? "";
    const project = new ProjectRepository(db, userId).getById(projectId);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return null;
    }
    return project;
  }

  /** Wraps a service call: tenant check first, then structured error mapping. */
  function handler(
    serviceCall: (projectRoot: string, req: Request) => unknown
  ): GraphHandler {
    return (req, res) => {
      const project = resolveProject(req, res);
      if (!project) return;
      try {
        const data = serviceCall(project.path, req);
        res.status(200).json({ code: 0, data, message: "" });
      } catch (error) {
        if (error instanceof ProjectGraphPathError) {
          res.status(400).json({ code: 1, message: "Invalid project path configuration" });
          return;
        }
        res.status(500).json({ code: 1, message: "Failed to read project graph" });
      }
    };
  }

  router.get("/:id/graph/overview", limiter, handler((root) => getGraphOverview(root)));

  router.get("/:id/graph/search", limiter, (req, res) => {
    const parseResult = searchQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const { q, kind, limit } = parseResult.data;
    handler((root) =>
      searchGraphSymbols(root, {
        q,
        ...(kind !== undefined ? { kind } : {}),
        ...(limit !== undefined ? { limit } : {})
      })
    )(req, res);
  });

  router.get("/:id/graph/symbols/:symbolId", limiter, handler((root, req) => {
    return getSymbolDetail(root, req.params.symbolId ?? "");
  }));

  router.get("/:id/graph/symbols/:symbolId/impact", limiter, (req, res) => {
    const parseResult = impactQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const depth = parseResult.data.depth ?? 2;
    handler((root, req) => getSymbolImpact(root, req.params.symbolId ?? "", depth))(req, res);
  });

  router.get("/:id/graph/file-graph", limiter, (req, res) => {
    const parseResult = fileGraphQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const limit = parseResult.data.limit ?? DEFAULT_FILE_GRAPH_LIMIT;
    handler((root) => getFileGraph(root, limit))(req, res);
  });

  router.post("/:id/graph/affected", limiter, (req, res) => {
    const parseResult = affectedBodySchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const { paths } = parseResult.data;
    const depth = parseResult.data.depth ?? DEFAULT_AFFECTED_DEPTH;
    handler((root) => getChangedPathsImpact(root, paths, depth))(req, res);
  });

  return router;
}
