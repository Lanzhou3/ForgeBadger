import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { ApiKeyRepository, type ApiKey } from "../db/repositories/api-key-repository.js";
import type { Database } from "../db/types.js";

const createApiKeySchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  plaintextKey: z.string().min(1)
});

const rotateApiKeySchema = z.object({
  plaintextKey: z.string().min(1)
});

export function createApiKeyRoutes(db: Database, masterKey: string): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ApiKeyRepository(db, userId, masterKey);
    const apiKeys = repo.list();
    res.json({
      code: 0,
      data: { apiKeys },
      message: ""
    });
  });

  router.post("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = createApiKeySchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid API key payload" });
      return;
    }

    try {
      const { provider, name, plaintextKey } = parseResult.data;
      const repo = new ApiKeyRepository(db, userId, masterKey);
      const apiKey = redactApiKey(repo.create({ provider, label: name, plaintextKey }));
      res.status(201).json({
        code: 0,
        data: { apiKey },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to create API key"
      });
    }
  });

  router.post("/:id/rotate", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = rotateApiKeySchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid API key payload" });
      return;
    }

    try {
      const repo = new ApiKeyRepository(db, userId, masterKey);
      const apiKey = repo.rotate(req.params.id, parseResult.data.plaintextKey);
      if (!apiKey) {
        res.status(404).json({ code: 1, message: "API key not found" });
        return;
      }

      res.json({
        code: 0,
        data: { apiKey: redactApiKey(apiKey) },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to rotate API key"
      });
    }
  });

  router.delete("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ApiKeyRepository(db, userId, masterKey);
    const deleted = repo.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ code: 1, message: "API key not found" });
      return;
    }

    res.json({
      code: 0,
      data: {},
      message: ""
    });
  });

  return router;
}

function redactApiKey(apiKey: ApiKey): Omit<ApiKey, "keyEncrypted"> {
  const { keyEncrypted: _keyEncrypted, ...safe } = apiKey;
  return safe;
}
