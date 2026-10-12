import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../auth/middleware.js";
import type { Database } from "../db/types.js";
import type { GitHubRequestOptions } from "../services/github-skill-source.js";
import { SkillDiscoveryService } from "../services/skill-discovery.js";
import {
  skillInstallService,
  SkillLifecycleError,
} from "../services/skill-install-service.js";
import { skillLocatorSchema } from "../services/skill-registry-package.js";

const searchSchema = z.object({
  q: z.string().trim().max(160).default(""),
  provider: z.enum(["all", "github", "clawhub", "skills-sh"]).default("all"),
  page: z.coerce.number().int().min(0).max(100).default(0),
  includeSkillsSh: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});
const previewSchema = z
  .object({
    locator: skillLocatorSchema.optional(),
    skillId: z.string().uuid().optional(),
    revisionId: z.string().uuid().optional(),
  })
  .strict();
const installSchema = z
  .object({
    token: z.string().uuid(),
    skillId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    operation: z.enum(["install", "update", "rollback"]),
  })
  .strict();
const sourceSchema = z
  .object({ repo: z.string().trim().min(3).max(200) })
  .strict();

export function createSkillRegistryRoutes(
  db: Database,
  options: GitHubRequestOptions = {},
): Router {
  const router = Router();
  const discovery = new SkillDiscoveryService(db, options);
  const installer = skillInstallService(db, options);
  const user = (req: Request) => (req as AuthenticatedRequest).userId;
  const action =
    (handler: (req: Request) => unknown | Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try {
        res.json({ code: 0, data: await handler(req), message: "" });
      } catch (error) {
        const status =
          error instanceof SkillLifecycleError ? error.status : 400;
        res
          .status(status)
          .json({
            code: 1,
            message:
              error instanceof z.ZodError
                ? "Invalid Skill request"
                : error instanceof Error
                  ? error.message
                  : "Skill operation failed",
          });
      }
    };
  router.get(
    "/skills/registry/search",
    action((req) => discovery.search(user(req), searchSchema.parse(req.query))),
  );
  router.get(
    "/skills/registry/sources",
    action((req) => ({ sources: discovery.sources(user(req)) })),
  );
  router.post(
    "/skills/registry/bootstrap",
    action((req) => {
      discovery.bootstrap(user(req));
      return { sources: discovery.sources(user(req)) };
    }),
  );
  router.post(
    "/skills/registry/sources",
    action((req) =>
      discovery.refresh(user(req), sourceSchema.parse(req.body).repo),
    ),
  );
  router.delete(
    "/skills/registry/sources/:id",
    action((req) => {
      discovery.remove(user(req), req.params.id!);
      return {};
    }),
  );
  router.post(
    "/skills/registry/preview",
    action((req) =>
      installer.preview(user(req), previewSchema.parse(req.body)),
    ),
  );
  router.post(
    "/skills/registry/install",
    action((req) => {
      const { token, ...input } = installSchema.parse(req.body);
      return installer.consume(user(req), token, input);
    }),
  );
  router.get(
    "/skills/:id/revisions",
    action((req) => ({
      revisions: installer.history(user(req), req.params.id!),
    })),
  );
  return router;
}
