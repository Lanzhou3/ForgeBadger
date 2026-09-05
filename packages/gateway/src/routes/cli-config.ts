import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest, userIsInstanceAdmin } from "../auth/middleware.js";
import type { Database } from "../db/types.js";
import { CliConfigAppliedProviderRepository } from "../db/repositories/cli-config-applied-provider-repository.js";
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
import {
  applyCliConfigToAdapter,
  CliConfigApplyError,
  previewCliConfigApply,
  rollbackCliConfigApply,
  type ClaudeModelSlot
} from "../services/cli-config-apply.js";
import { listCliConfigFields } from "../services/cli-config-fields.js";
import { cliConfigTargetPath, hashTargetLocator } from "../services/cli-config-target.js";
import { acquireModelBindingTargetLock, ModelBindingTargetLockError } from "../services/model-binding-target-lock.js";

const providerBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  protocol: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().max(512).optional(),
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
  path: z.string().trim().min(1).max(120)
}).strict();

const fieldPatchBodySchema = z.object({
  updates: z.record(z.string(), z.unknown())
}).strict();

const applyProviderBodySchema = z.object({
  providerProfileId: z.string().min(1),
  modelProfileId: z.string().min(1).optional(),
  credentialId: z.string().min(1).optional(),
  // Claude only: per-role alias mapping (opus/sonnet/haiku/fable/subagent),
  // values are model profile ids owned by the provider.
  modelMapping: z.object({
    opus: z.string().min(1).optional(),
    sonnet: z.string().min(1).optional(),
    haiku: z.string().min(1).optional(),
    fable: z.string().min(1).optional(),
    subagent: z.string().min(1).optional()
  }).strict().optional(),
  // Codex only: model_reasoning_effort.
  reasoningEffort: z.enum(["minimal", "low", "medium", "high"]).optional()
}).strict();

const rollbackBodySchema = z.object({
  backupId: z.string().min(1).max(200).optional()
}).strict();

export function createCliConfigRoutes(
  db: Database,
  masterKey: string,
  options: {
    operationObserver?: ((operation: string) => void) | undefined;
    /** Test seam: DNS resolver for the apply SSRF endpoint check. */
    resolveHost?: import("../services/network-policy.js").OutboundHostResolver | undefined;
  } = {}
): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/adapters", (_req, res) => {
    res.json({ code: 0, data: { adapters: listCliConfigAdapters() }, message: "" });
  });

  router.get("/:adapter/fields", (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    res.json({ code: 0, data: { fields: listCliConfigFields(adapter) }, message: "" });
  });

  router.use("/:adapter", (req, res, next) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    const userId = (req as unknown as AuthenticatedRequest).userId;
    if (!userIsInstanceAdmin(db, userId)) {
      res.status(403).json({
        code: 1,
        message: "Instance administrator access is required",
        details: { code: "INSTANCE_ADMIN_REQUIRED" }
      });
      return;
    }
    const targetPath = cliConfigTargetPath({ adapter, scope: "global" });
    const locatorHash = hashTargetLocator(masterKey, targetPath);
    // Reads and dry-run previews never touch disk; only mutating calls
    // serialize on the per-target lock. Locking previews too makes the web
    // dialog's back-to-back preview refreshes race each other into 409s.
    if (req.method === "GET" || req.path.endsWith("/apply-provider/preview")) {
      next();
      return;
    }
    let lock: { release(): void };
    try {
      lock = acquireModelBindingTargetLock(locatorHash);
    } catch (error) {
      if (error instanceof ModelBindingTargetLockError) {
        res.status(409).json({ code: 1, message: error.message, details: { code: error.code } });
        return;
      }
      throw error;
    }
    let released = false;
    const release = () => { if (!released) { released = true; lock.release(); } };
    res.once("finish", release);
    res.once("close", release);
    next();
  });

  router.get("/:adapter", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    observe(options, "snapshot.read");
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
    observe(options, "file.read");
    await handle(res, async () => ({ file: await readCliConfigFile(adapter, query.data.path) }));
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
    observe(options, "file.write");
    await handle(res, async () => ({
      snapshot: await writeCliConfigFile(adapter, body.data.path, body.data.content)
    }));
  });

  router.get("/:adapter/field-values", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    observe(options, "fields.read");
    await handle(res, async () => ({ values: await readCliConfigFieldValues(adapter) }));
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
    observe(options, "fields.patch");
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
    observe(options, "provider.put");
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
    observe(options, "provider.delete");
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
    observe(options, "model.put");
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
    observe(options, "model.delete");
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
    observe(options, "default-model.put");
    await handle(res, async () => ({
      snapshot: await setCliDefaultModel(adapter, body.data.model, body.data.providerId)
    }));
  });

  router.post("/:adapter/apply-provider/preview", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    const body = applyProviderBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ code: 1, message: "Invalid apply preview payload" });
      return;
    }
    observe(options, "apply.preview");
    await handle(res, async () => ({
      preview: await previewCliConfigApply(applyInput(db, masterKey, req, adapter, body.data, options))
    }));
  });

  router.post("/:adapter/apply-provider", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    const body = applyProviderBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ code: 1, message: "Invalid apply payload" });
      return;
    }
    observe(options, "apply.apply");
    await handle(res, async () => ({
      result: await applyCliConfigToAdapter(applyInput(db, masterKey, req, adapter, body.data, options))
    }));
  });

  router.post("/:adapter/rollback", async (req, res) => {
    const adapter = parseAdapter(req.params.adapter);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported CLI adapter" });
      return;
    }
    const body = rollbackBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ code: 1, message: "Invalid rollback payload" });
      return;
    }
    observe(options, "apply.rollback");
    await handle(res, async () => {
      const result = rollbackCliConfigApply({
        masterKey,
        adapter,
        ...(body.data.backupId ? { backupId: body.data.backupId } : {})
      });
      // The restored config's provider is unknown, so the applied-provider
      // pointer is no longer trustworthy.
      new CliConfigAppliedProviderRepository(db, (req as unknown as AuthenticatedRequest).userId).clear(adapter);
      return { result };
    });
  });

  return router;
}

function applyInput(
  db: Database,
  masterKey: string,
  req: unknown,
  adapter: AdapterId,
  body: z.infer<typeof applyProviderBodySchema>,
  options: { resolveHost?: import("../services/network-policy.js").OutboundHostResolver | undefined } = {}
) {
  return {
    db,
    userId: (req as unknown as AuthenticatedRequest).userId,
    masterKey,
    adapter,
    providerProfileId: body.providerProfileId,
    ...(body.modelProfileId ? { modelProfileId: body.modelProfileId } : {}),
    ...(body.credentialId ? { credentialId: body.credentialId } : {}),
    ...(body.modelMapping ? { modelMapping: compactModelMapping(body.modelMapping) } : {}),
    ...(body.reasoningEffort ? { reasoningEffort: body.reasoningEffort } : {}),
    ...(options.resolveHost ? { resolveHost: options.resolveHost } : {})
  };
}

/** Drops undefined slot values so the input satisfies exactOptionalPropertyTypes. */
function compactModelMapping(
  mapping: Partial<Record<ClaudeModelSlot, string | undefined>>
): Partial<Record<ClaudeModelSlot, string>> {
  const compact: Partial<Record<ClaudeModelSlot, string>> = {};
  for (const [slot, value] of Object.entries(mapping) as Array<[ClaudeModelSlot, string | undefined]>) {
    if (value) compact[slot] = value;
  }
  return compact;
}

function observe(options: { operationObserver?: ((operation: string) => void) | undefined }, operation: string): void {
  options.operationObserver?.(operation);
}

function parseAdapter(value: string | undefined): AdapterId | undefined {
  return value !== undefined && isAdapterId(value) ? value : undefined;
}

function applyErrorStatus(error: CliConfigApplyError): number {
  if (error.code.endsWith("_NOT_FOUND")) return 404;
  if (error.code === "CLI_CONFIG_APPLY_FAILED"
    || error.code === "CLI_CONFIG_APPLY_VERIFY_FAILED"
    || error.code === "CLI_CONFIG_ROLLBACK_FAILED") return 500;
  return 400;
}

async function handle(
  res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } },
  action: () => Promise<Record<string, unknown>>
): Promise<void> {
  try {
    const data = await action();
    res.json({ code: 0, data, message: "" });
  } catch (error) {
    if (error instanceof CliConfigApplyError) {
      res.status(applyErrorStatus(error)).json({
        code: 1,
        message: error.message,
        details: { code: error.code }
      });
      return;
    }
    res.status(400).json({
      code: 1,
      message: error instanceof Error ? error.message : "CLI config operation failed"
    });
  }
}
