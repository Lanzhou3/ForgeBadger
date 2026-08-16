import { Router } from "express";
import { z } from "zod";

import { authenticate } from "../auth/middleware.js";
import { isAdapterId, type AdapterId } from "../services/adapter-discovery.js";
import {
  applyCliConfigFieldPatch,
  listCliConfigAdapters,
  readCliConfig,
  readCliConfigFieldValues,
  readCliConfigFile,
  removeCliModel,
  removeCliProvider,
  setCliDefaultModel,
  upsertCliModel,
  upsertCliProvider,
  writeCliConfigFile
} from "../services/cli-config.js";
import { listCliConfigFields } from "../services/cli-config-fields.js";

const providerBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  protocol: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().max(512).optional(),
  apiKey: z.string().max(512).optional(),
  envKey: z.string().trim().max(120).optional()
}).strict();

const modelBodySchema = z.object({
  alias: z.string().trim().min(1).max(128),
  provider: z.string().trim().min(1).max(64),
  modelId: z.string().trim().min(1).max(200)
}).strict();

const removeModelBodySchema = z.object({
  alias: z.string().trim().min(1).max(128)
}).strict();

const defaultModelBodySchema = z.object({
  model: z.string().trim().min(1).max(200),
  providerId: z.string().trim().min(1).max(64).optional()
}).strict();

const fileBodySchema = z.object({
  path: z.string().trim().min(1).max(120),
  content: z.string().max(128 * 1024)
}).strict();

const fileQuerySchema = z.object({
  path: z.string().trim().min(1).max(120),
  reveal: z.enum(["0", "1"]).optional()
}).strict();

const fieldPatchBodySchema = z.object({
  updates: z.record(z.string(), z.unknown())
}).strict();

export function createCliConfigRoutes(): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/adapters", (_req, res) => {
    res.json({ code: 0, data: { adapters: listCliConfigAdapters() }, message: "" });
  });

  router.get("/:adapter", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    await handle(res, async () => ({ snapshot: await readCliConfig(adapter) }));
  });

  router.get("/:adapter/file", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    const query = fileQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ code: 1, message: "Invalid file query" });
      return;
    }
    await handle(res, async () => ({
      file: await readCliConfigFile(adapter, query.data.path, query.data.reveal === "1")
    }));
  });

  router.put("/:adapter/file", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    const body = fileBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ code: 1, message: "Invalid file payload" });
      return;
    }
    await handle(res, async () => ({
      snapshot: await writeCliConfigFile(adapter, body.data.path, body.data.content)
    }));
  });

  router.get("/:adapter/fields", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    await handle(res, async () => ({
      fields: listCliConfigFields(adapter),
      values: await readCliConfigFieldValues(adapter)
    }));
  });

  router.patch("/:adapter/fields", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    const body = fieldPatchBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ code: 1, message: "Invalid field patch payload" });
      return;
    }
    await handle(res, async () => ({
      snapshot: await applyCliConfigFieldPatch(adapter, body.data.updates)
    }));
  });

  router.put("/:adapter/providers/:providerId", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    const body = providerBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ code: 1, message: "Invalid provider payload" });
      return;
    }
    await handle(res, async () => ({
      snapshot: await upsertCliProvider(adapter, req.params.providerId, body.data)
    }));
  });

  router.delete("/:adapter/providers/:providerId", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    await handle(res, async () => ({
      snapshot: await removeCliProvider(adapter, req.params.providerId)
    }));
  });

  router.put("/:adapter/models", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    const body = modelBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ code: 1, message: "Invalid model payload" });
      return;
    }
    await handle(res, async () => ({
      snapshot: await upsertCliModel(adapter, body.data.alias, {
        provider: body.data.provider,
        modelId: body.data.modelId
      })
    }));
  });

  router.delete("/:adapter/models", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    const body = removeModelBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ code: 1, message: "Invalid model payload" });
      return;
    }
    await handle(res, async () => ({
      snapshot: await removeCliModel(adapter, body.data.alias)
    }));
  });

  router.put("/:adapter/default-model", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    const body = defaultModelBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ code: 1, message: "Invalid default model payload" });
      return;
    }
    await handle(res, async () => ({
      snapshot: await setCliDefaultModel(adapter, body.data.model, body.data.providerId)
    }));
  });

  return router;
}

function parseAdapter(value: string | undefined): AdapterId | undefined {
  return value !== undefined && isAdapterId(value) ? value : undefined;
}

async function handle(
  res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } },
  action: () => Promise<Record<string, unknown>>
): Promise<void> {
  try {
    const data = await action();
    res.json({ code: 0, data, message: "" });
  } catch (error) {
    res.status(400).json({
      code: 1,
      message: error instanceof Error ? error.message : "CLI config operation failed"
    });
  }
}
