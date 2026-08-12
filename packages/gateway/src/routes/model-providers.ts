import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { isForeignKeyError } from "../lib/db-errors.js";
import {
  ModelProviderRepository,
  type ModelProfile,
  type CreateProviderProfileInput,
  type CreateModelProfileInput,
  type ProviderApiFormat,
  type ProviderAuthType,
  type ProviderProductType,
  type ProviderProfile,
  type UpdateModelProfileInput
} from "../db/repositories/model-provider-repository.js";
import type { Database } from "../db/types.js";
import {
  isSafeOpenCodeNpmPackage,
  loadProviderCatalog as loadProviderCatalogFromSource,
  type ProviderCatalogPreset
} from "../services/model-catalog.js";
import { checkModelEndpoint } from "../services/model-endpoint-health.js";
import {
  buildModelProviderReadiness,
  type ProviderReadinessAdapter
} from "../services/model-provider-readiness.js";
import {
  applyModelProviderConfig,
  previewModelProviderConfig
} from "../services/model-config-apply.js";
import {
  fetchProviderModels as fetchProviderModelsFromEndpoint,
  type FetchedProviderModel,
  type FetchProviderModelsInput
} from "../services/provider-model-fetch.js";

const adapterSchema = z.enum(["claude", "opencode", "openforge-copilot", "codex", "kimi"]);
const providerAdapterSchema = z.enum(["claude", "opencode", "kimi"]);
const productTypeSchema = z.enum(["payg_api", "coding_plan", "token_plan", "subscription", "local"]);
const createProviderSchema = z.object({
  catalogId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  providerKey: z.string().min(1).optional(),
  baseUrl: z.string().optional(),
  anthropicBaseUrl: z.string().optional(),
  openaiBaseUrl: z.string().optional(),
  region: z.string().optional(),
  productType: productTypeSchema.optional(),
  authType: z.enum(["api_key", "bearer_token", "oauth", "none"]).optional(),
  apiFormat: z.enum(["anthropic", "openai", "openai-compatible", "google", "bedrock", "local"]).optional(),
  supportedAdapters: z.array(providerAdapterSchema).optional()
});
const updateProviderSchema = createProviderSchema.omit({ catalogId: true }).partial();
const createModelProfileSchema = z.object({
  name: z.string().min(1),
  modelId: z.string().min(1),
  capabilities: z.array(z.string().min(1)).optional(),
  contextWindow: z.number().int().positive().optional(),
  isDefault: z.boolean().optional()
});
const updateModelProfileSchema = createModelProfileSchema.partial();
const createCredentialSchema = z.object({
  label: z.string().optional(),
  plaintextSecret: z.string().min(1)
});
const rotateCredentialSchema = createCredentialSchema;
const applySchema = z.object({
  adapter: adapterSchema,
  scope: z.enum(["project", "user-global"]).optional(),
  projectRoot: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().min(1).optional()
  ),
  modelProfileId: z.string().min(1).optional(),
  credentialId: z.string().min(1).optional()
});
const endpointTestSchema = z.object({
  timeoutMs: z.number().int().min(100).max(15000).optional()
});
const readinessSchema = z.object({
  adapter: adapterSchema,
  modelProfileId: z.string().min(1).optional(),
  credentialId: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(30000).optional(),
  includeRemoteCheck: z.boolean().optional()
});
const syncModelsSchema = z.object({
  credentialId: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(30000).optional()
});

export interface ModelProviderRouteOptions {
  fetchProviderModels?: (input: FetchProviderModelsInput) => Promise<FetchedProviderModel[]>;
  loadProviderCatalog?: () => Promise<ProviderCatalogPreset[]>;
}

export function createModelProviderRoutes(db: Database, masterKey: string, options: ModelProviderRouteOptions = {}): Router {
  const router = Router();
  const fetchProviderModels = options.fetchProviderModels ?? fetchProviderModelsFromEndpoint;
  const loadProviderCatalog = options.loadProviderCatalog ?? loadProviderCatalogFromSource;
  router.use(authenticate);

  // Rate-limit network-probing endpoints (they trigger real outbound requests
  // to provider endpoints, so a stolen JWT must not be usable to spray them).
  const probeLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });
  router.use("/:id/test", probeLimiter);
  router.use("/:id/readiness", probeLimiter);
  router.use("/:id/models/sync", probeLimiter);

  router.get("/catalog", async (_req, res) => {
    const providers = await loadProviderCatalog();
    res.json({ code: 0, data: { providers }, message: "" });
  });

  router.get("/", (req, res) => {
    const repo = repoFor(db, masterKey, req);
    res.json({
      code: 0,
      data: {
        providers: repo.listProviderProfiles(),
        models: repo.listModelProfiles(),
        credentials: repo.listCredentials()
      },
      message: ""
    });
  });

  router.post("/", async (req, res) => {
    const parseResult = createProviderSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid provider payload" });
      return;
    }
    const repo = repoFor(db, masterKey, req);
    try {
      const catalog = await loadProviderCatalog();
      const result = createProvider(repo, parseResult.data, catalog);
      res.status(201).json({ code: 0, data: result, message: "" });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to create provider"
      });
    }
  });

  router.patch("/:id", (req, res) => {
    const parseResult = updateProviderSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid provider payload" });
      return;
    }
    const updateInput: Partial<CreateProviderProfileInput> = {};
    if (parseResult.data.name !== undefined) updateInput.name = parseResult.data.name;
    if (parseResult.data.providerKey !== undefined) updateInput.providerKey = parseResult.data.providerKey;
    if (parseResult.data.baseUrl !== undefined) updateInput.baseUrl = parseResult.data.baseUrl;
    if (parseResult.data.anthropicBaseUrl !== undefined) updateInput.anthropicBaseUrl = parseResult.data.anthropicBaseUrl;
    if (parseResult.data.openaiBaseUrl !== undefined) updateInput.openaiBaseUrl = parseResult.data.openaiBaseUrl;
    if (parseResult.data.region !== undefined) updateInput.region = parseResult.data.region;
    if (parseResult.data.productType !== undefined) updateInput.productType = parseResult.data.productType;
    if (parseResult.data.authType !== undefined) updateInput.authType = parseResult.data.authType;
    if (parseResult.data.apiFormat !== undefined) updateInput.apiFormat = parseResult.data.apiFormat;
    if (parseResult.data.supportedAdapters !== undefined) updateInput.supportedAdapters = parseResult.data.supportedAdapters;
    const provider = repoFor(db, masterKey, req).updateProviderProfile(req.params.id, updateInput);
    if (!provider) {
      res.status(404).json({ code: 1, message: "Provider not found" });
      return;
    }
    res.json({ code: 0, data: { provider }, message: "" });
  });

  router.delete("/:id", (req, res) => {
    try {
      const deleted = repoFor(db, masterKey, req).deleteProviderProfile(req.params.id);
      if (!deleted) {
        res.status(404).json({ code: 1, message: "Provider not found" });
        return;
      }
    } catch (error) {
      if (isForeignKeyError(error)) {
        res.status(409).json({
          code: 1,
          message: "Provider models are still referenced by a session or agent and cannot be deleted"
        });
        return;
      }
      res.status(500).json({ code: 1, message: "Failed to delete provider" });
      return;
    }
    res.json({ code: 0, data: {}, message: "" });
  });

  router.get("/:id/models", (req, res) => {
    const repo = repoFor(db, masterKey, req);
    if (!repo.getProviderProfile(req.params.id)) {
      res.status(404).json({ code: 1, message: "Provider not found" });
      return;
    }
    res.json({ code: 0, data: { models: repo.listModelProfiles(req.params.id) }, message: "" });
  });

  router.post("/:id/models", (req, res) => {
    const parseResult = createModelProfileSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid model profile payload" });
      return;
    }
    const repo = repoFor(db, masterKey, req);
    const modelInput: CreateModelProfileInput = {
      providerProfileId: req.params.id,
      name: parseResult.data.name,
      modelId: parseResult.data.modelId,
      ...(parseResult.data.capabilities !== undefined ? { capabilities: parseResult.data.capabilities } : {}),
      ...(parseResult.data.contextWindow !== undefined ? { contextWindow: parseResult.data.contextWindow } : {}),
      ...(parseResult.data.isDefault !== undefined ? { isDefault: parseResult.data.isDefault } : {})
    };
    const model = repo.createModelProfile(modelInput);
    res.status(201).json({ code: 0, data: { model }, message: "" });
  });

  router.post("/:id/models/sync", async (req, res) => {
    const parseResult = syncModelsSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid model sync payload" });
      return;
    }
    const repo = repoFor(db, masterKey, req);
    const provider = repo.getProviderProfile(req.params.id);
    if (!provider) {
      res.status(404).json({ code: 1, message: "Provider not found" });
      return;
    }
    const modelFetchBaseUrl = provider.openaiBaseUrl ?? provider.baseUrl;
    if (!modelFetchBaseUrl) {
      res.status(400).json({
        code: 1,
        message: "Provider base URL is required"
      });
      return;
    }

    const credential = selectCredential(repo, provider.id, parseResult.data.credentialId);
    if (parseResult.data.credentialId && !credential) {
      res.status(400).json({ code: 1, message: "Credential does not belong to the selected provider" });
      return;
    }

    try {
      const catalogPreset = (await loadProviderCatalog()).find((preset) => preset.id === provider.providerKey);
      if (catalogPreset?.modelSource === "static") {
        const created = seedMissingModelsForPreset(repo, provider, catalogPreset);
        res.json({
          code: 0,
          data: {
            fetchedCount: catalogPreset.defaultModels.length,
            createdCount: created.length,
            models: listPresetModels(repo, provider, catalogPreset)
          },
          message: ""
        });
        return;
      }
      if (provider.authType !== "none" && !credential) {
        res.status(400).json({ code: 1, message: "Provider credential is required to sync models" });
        return;
      }
      const fetchedModels = await fetchProviderModels({
        baseUrl: modelFetchBaseUrl,
        apiKey: credential ? repo.decryptCredential(credential.id) : undefined,
        modelsUrl: catalogPreset?.modelFetch?.modelsUrl,
        ...(parseResult.data.timeoutMs ? { timeoutMs: parseResult.data.timeoutMs } : {})
      });
      const created = syncFetchedModels(repo, provider, fetchedModels);
      res.json({
        code: 0,
        data: {
          fetchedCount: fetchedModels.length,
          createdCount: created.length,
          models: created
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to sync provider models"
      });
    }
  });

  router.patch("/:id/models/:modelId", (req, res) => {
    const parseResult = updateModelProfileSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid model profile payload" });
      return;
    }
    const repo = repoFor(db, masterKey, req);
    if (!repo.getProviderProfile(req.params.id)) {
      res.status(404).json({ code: 1, message: "Provider not found" });
      return;
    }
    const model = repo.getModelProfile(req.params.modelId);
    if (!model) {
      res.status(404).json({ code: 1, message: "Model not found" });
      return;
    }
    if (model.providerProfileId !== req.params.id) {
      res.status(400).json({ code: 1, message: "Model does not belong to the selected provider" });
      return;
    }
    const updateInput: UpdateModelProfileInput = {};
    if (parseResult.data.name !== undefined) updateInput.name = parseResult.data.name;
    if (parseResult.data.modelId !== undefined) updateInput.modelId = parseResult.data.modelId;
    if (parseResult.data.capabilities !== undefined) updateInput.capabilities = parseResult.data.capabilities;
    if (parseResult.data.contextWindow !== undefined) updateInput.contextWindow = parseResult.data.contextWindow;
    if (parseResult.data.isDefault !== undefined) updateInput.isDefault = parseResult.data.isDefault;
    const updated = repo.updateModelProfile(model.id, updateInput);
    res.json({ code: 0, data: { model: updated }, message: "" });
  });

  router.post("/:id/models/:modelId/set-default", (req, res) => {
    const repo = repoFor(db, masterKey, req);
    if (!repo.getProviderProfile(req.params.id)) {
      res.status(404).json({ code: 1, message: "Provider not found" });
      return;
    }
    const model = repo.getModelProfile(req.params.modelId);
    if (!model) {
      res.status(404).json({ code: 1, message: "Model not found" });
      return;
    }
    if (model.providerProfileId !== req.params.id) {
      res.status(400).json({ code: 1, message: "Model does not belong to the selected provider" });
      return;
    }
    const updated = repo.setDefaultModel(model.id);
    res.json({ code: 0, data: { model: updated }, message: "" });
  });

  router.delete("/:id/models/:modelId", (req, res) => {
    const repo = repoFor(db, masterKey, req);
    if (!repo.getProviderProfile(req.params.id)) {
      res.status(404).json({ code: 1, message: "Provider not found" });
      return;
    }
    const model = repo.getModelProfile(req.params.modelId);
    if (!model) {
      res.status(404).json({ code: 1, message: "Model not found" });
      return;
    }
    if (model.providerProfileId !== req.params.id) {
      res.status(400).json({ code: 1, message: "Model does not belong to the selected provider" });
      return;
    }
    try {
      repo.deleteModelProfile(model.id);
    } catch (error) {
      if (isForeignKeyError(error)) {
        res.status(409).json({
          code: 1,
          message: "Model is still referenced by a session or agent and cannot be deleted"
        });
        return;
      }
      res.status(500).json({ code: 1, message: "Failed to delete model" });
      return;
    }
    res.json({ code: 0, data: {}, message: "" });
  });

  router.post("/:id/credentials", (req, res) => {
    const parseResult = createCredentialSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid credential payload" });
      return;
    }
    const credential = repoFor(db, masterKey, req).createCredential({
      providerProfileId: req.params.id,
      ...(parseResult.data.label ? { label: parseResult.data.label } : {}),
      plaintextSecret: parseResult.data.plaintextSecret
    });
    res.status(201).json({ code: 0, data: { credential }, message: "" });
  });

  router.post("/:id/credentials/:credentialId/rotate", (req, res) => {
    const parseResult = rotateCredentialSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid credential payload" });
      return;
    }
    const repo = repoFor(db, masterKey, req);
    if (!repo.getProviderProfile(req.params.id)) {
      res.status(404).json({ code: 1, message: "Provider not found" });
      return;
    }
    const credential = repo.getCredential(req.params.credentialId);
    if (!credential) {
      res.status(404).json({ code: 1, message: "Credential not found" });
      return;
    }
    if (credential.providerProfileId !== req.params.id) {
      res.status(400).json({ code: 1, message: "Credential does not belong to the selected provider" });
      return;
    }
    const updated = repo.rotateCredential(credential.id, {
      ...(parseResult.data.label ? { label: parseResult.data.label } : {}),
      plaintextSecret: parseResult.data.plaintextSecret
    });
    res.json({ code: 0, data: { credential: updated }, message: "" });
  });

  router.delete("/:id/credentials/:credentialId", (req, res) => {
    const repo = repoFor(db, masterKey, req);
    if (!repo.getProviderProfile(req.params.id)) {
      res.status(404).json({ code: 1, message: "Provider not found" });
      return;
    }
    const credential = repo.getCredential(req.params.credentialId);
    if (!credential) {
      res.status(404).json({ code: 1, message: "Credential not found" });
      return;
    }
    if (credential.providerProfileId !== req.params.id) {
      res.status(400).json({ code: 1, message: "Credential does not belong to the selected provider" });
      return;
    }
    repo.deleteCredential(credential.id);
    res.json({ code: 0, data: {}, message: "" });
  });

  router.post("/:id/test", async (req, res) => {
    const parseResult = endpointTestSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid provider test payload" });
      return;
    }
    const provider = repoFor(db, masterKey, req).getProviderProfile(req.params.id);
    if (!provider?.baseUrl) {
      res.status(400).json({ code: 1, message: "Provider base URL is required" });
      return;
    }
    const health = await checkModelEndpoint({
      endpoint: provider.baseUrl,
      ...(parseResult.data.timeoutMs ? { timeoutMs: parseResult.data.timeoutMs } : {})
    });
    res.json({ code: 0, data: { health }, message: "" });
  });

  router.post("/:id/readiness", async (req, res) => {
    const parseResult = readinessSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid provider readiness payload" });
      return;
    }
    const repo = repoFor(db, masterKey, req);
    const provider = repo.getProviderProfile(req.params.id);
    if (!provider) {
      res.status(404).json({ code: 1, message: "Provider not found" });
      return;
    }
    const model = selectModel(repo, provider, parseResult.data.modelProfileId);
    const credential = selectCredential(repo, provider.id, parseResult.data.credentialId);
    const catalogPreset = (await loadProviderCatalog()).find((preset) => preset.id === provider.providerKey);
    const readiness = await buildModelProviderReadiness({
      provider,
      model,
      credential,
      adapter: parseResult.data.adapter as ProviderReadinessAdapter,
      modelProfileId: parseResult.data.modelProfileId,
      credentialId: parseResult.data.credentialId,
      includeRemoteCheck: parseResult.data.includeRemoteCheck ?? false,
      ...(parseResult.data.timeoutMs ? { timeoutMs: parseResult.data.timeoutMs } : {}),
      ...(catalogPreset?.modelFetch?.modelsUrl ? { modelsUrl: catalogPreset.modelFetch.modelsUrl } : {}),
      decryptCredential: credential ? () => repo.decryptCredential(credential.id) : undefined,
      fetchProviderModels
    });
    res.json({ code: 0, data: { readiness }, message: "" });
  });

  router.post("/:id/preview-apply", async (req, res) => {
    await handleApplyRequest({ db, masterKey, req, res, shouldApply: false });
  });

  router.post("/:id/apply", async (req, res) => {
    await handleApplyRequest({ db, masterKey, req, res, shouldApply: true });
  });

  return router;
}

function createProvider(
  repo: ModelProviderRepository,
  input: z.infer<typeof createProviderSchema>,
  catalog: ProviderCatalogPreset[]
) {
  const preset = input.catalogId ? catalog.find((provider) => provider.id === input.catalogId) : undefined;
  if (input.catalogId && !preset) {
    throw new Error("Catalog provider not found");
  }
  const provider = preset ? createFromPreset(repo, preset) : createCustom(repo, input);
  const models = preset ? seedMissingModelsForPreset(repo, provider, preset) : [];
  return { provider, models };
}

function seedMissingModelsForPreset(
  repo: ModelProviderRepository,
  provider: ProviderProfile,
  preset: ProviderCatalogPreset
): ModelProfile[] {
  const existingModelIds = new Set(repo.listModelProfiles(provider.id).map((model) => model.modelId));
  const hasDefault = repo.listModelProfiles().some((model) => model.isDefault);
  const created: ModelProfile[] = [];
  for (const model of seedModelsForPreset(preset)) {
    if (existingModelIds.has(model.modelId)) continue;
    created.push(repo.createModelProfile({
      providerProfileId: provider.id,
      name: model.name,
      modelId: model.modelId,
      capabilities: model.capabilities,
      contextWindow: model.contextWindow ?? null,
      isDefault: !hasDefault && created.length === 0
    }));
  }
  return created;
}

function seedModelsForPreset(preset: ProviderCatalogPreset) {
  if (preset.modelSource === "models.dev") {
    return preset.defaultModels.slice(0, 1);
  }
  if (preset.modelSource === "static") {
    return preset.defaultModels;
  }
  return [];
}

function createFromPreset(repo: ModelProviderRepository, preset: ProviderCatalogPreset): ProviderProfile {
  assertSafeDefaultHeaders(preset.headers);
  if (preset.supportedAdapters.includes("opencode")) {
    assertSafeOpenCodeNpm(preset.opencode?.npm);
  }
  return repo.ensureProviderProfile({
    name: preset.name,
    providerKey: preset.id,
    baseUrl: preset.baseUrl,
    region: preset.region ?? "global",
    productType: (preset.productType ?? "payg_api") as ProviderProductType,
    authType: preset.authType as ProviderAuthType,
    apiFormat: preset.apiFormat as ProviderApiFormat,
    supportedAdapters: preset.supportedAdapters,
    ...(preset.endpoints?.anthropic?.baseUrl ? { anthropicBaseUrl: preset.endpoints.anthropic.baseUrl } : {}),
    ...(preset.endpoints?.openai?.baseUrl ? { openaiBaseUrl: preset.endpoints.openai.baseUrl } : {}),
    ...(preset.headers ? { defaultHeaders: preset.headers } : {}),
    ...(preset.opencode?.npm ? { opencodeNpm: preset.opencode.npm } : {})
  });
}

function assertSafeDefaultHeaders(headers: Record<string, string> | undefined): void {
  if (!headers) return;
  for (const [name, value] of Object.entries(headers)) {
    if (isSensitiveHeaderName(name) || isSensitiveHeaderValue(value)) {
      throw new Error("Catalog provider default headers must not contain credentials");
    }
  }
}

function isSensitiveHeaderName(name: string): boolean {
  return /(^|[-_])(authorization|api[-_]?key|token|secret|credential|password|key)([-_]|$)/iu.test(name);
}

function isSensitiveHeaderValue(value: string): boolean {
  return /(bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]+)/iu.test(value);
}

function assertSafeOpenCodeNpm(packageName: string | undefined): void {
  if (!isSafeOpenCodeNpmPackage(packageName)) {
    throw new Error("Catalog provider OpenCode npm package is invalid");
  }
}

function createCustom(repo: ModelProviderRepository, input: z.infer<typeof createProviderSchema>): ProviderProfile {
  if (!input.name || !input.providerKey || !input.authType || !input.apiFormat) {
    throw new Error("Custom provider requires name, providerKey, authType, and apiFormat");
  }
  return repo.createProviderProfile({
    name: input.name,
    providerKey: input.providerKey,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    ...(input.anthropicBaseUrl ? { anthropicBaseUrl: input.anthropicBaseUrl } : {}),
    ...(input.openaiBaseUrl ? { openaiBaseUrl: input.openaiBaseUrl } : {}),
    ...(input.region ? { region: input.region } : {}),
    ...(input.productType ? { productType: input.productType } : {}),
    authType: input.authType,
    apiFormat: input.apiFormat,
    supportedAdapters: input.supportedAdapters ?? ["claude"]
  });
}

async function handleApplyRequest(input: {
  db: Database;
  masterKey: string;
  req: Request;
  res: Response;
  shouldApply: boolean;
}): Promise<void> {
  const parseResult = applySchema.safeParse(input.req.body ?? {});
  if (!parseResult.success) {
    input.res.status(400).json({ code: 1, message: "Invalid apply payload" });
    return;
  }
  const repo = repoFor(input.db, input.masterKey, input.req);
  const providerId = input.req.params.id;
  if (!providerId) {
    input.res.status(404).json({ code: 1, message: "Provider not found" });
    return;
  }
  const provider = repo.getProviderProfile(providerId);
  if (!provider) {
    input.res.status(404).json({ code: 1, message: "Provider not found" });
    return;
  }
  if (parseResult.data.adapter === "codex") {
    input.res.status(400).json({ code: 1, message: "Codex provider apply is disabled; Codex uses subscription SDK identity" });
    return;
  }
  if (parseResult.data.adapter === "openforge-copilot") {
    await handleCopilotApplyRequest({
      repo,
      provider,
      modelProfileId: parseResult.data.modelProfileId,
      res: input.res,
      shouldApply: input.shouldApply
    });
    return;
  }
  if (!provider.supportedAdapters.includes(parseResult.data.adapter)) {
    input.res.status(400).json({ code: 1, message: "Provider does not support the selected adapter" });
    return;
  }
  if (!parseResult.data.projectRoot && parseResult.data.scope !== "user-global") {
    input.res.status(400).json({ code: 1, message: "Project path is required for project-scope provider apply" });
    return;
  }
  const model = selectModel(repo, provider, parseResult.data.modelProfileId);
  if (!model) {
    input.res.status(parseResult.data.modelProfileId ? 400 : 404).json({
      code: 1,
      message: parseResult.data.modelProfileId
        ? "Model does not belong to the selected provider"
        : "Provider model not found"
    });
    return;
  }
  const credential = selectCredential(repo, provider.id, parseResult.data.credentialId);
  if (parseResult.data.credentialId && !credential) {
    input.res.status(400).json({ code: 1, message: "Credential does not belong to the selected provider" });
    return;
  }
  const payload = {
    projectRoot: parseResult.data.projectRoot ?? "",
    adapter: parseResult.data.adapter,
    scope: parseResult.data.scope ?? "project",
    provider: {
      id: provider.id,
      providerKey: provider.providerKey,
      baseUrl: provider.baseUrl,
      anthropicBaseUrl: provider.anthropicBaseUrl,
      openaiBaseUrl: provider.openaiBaseUrl,
      authType: provider.authType,
      apiFormat: provider.apiFormat,
      opencodeNpm: provider.opencodeNpm
    },
    model: { id: model.id, modelId: model.modelId },
    ...(credential ? { credential: { id: credential.id, envName: envNameFor(provider.providerKey, parseResult.data.adapter) } } : {})
  };
  try {
    const result = input.shouldApply
      ? await applyModelProviderConfig(payload)
      : await previewModelProviderConfig(payload);
    input.res.json({ code: 0, data: input.shouldApply ? { result } : { preview: result }, message: "" });
  } catch (error) {
    input.res.status(400).json({
      code: 1,
      message: error instanceof Error ? error.message : "Failed to apply provider config"
    });
  }
}

async function handleCopilotApplyRequest(input: {
  repo: ModelProviderRepository;
  provider: ProviderProfile;
  modelProfileId: string | undefined;
  res: Response;
  shouldApply: boolean;
}): Promise<void> {
  if (!isCopilotCompatibleProvider(input.provider)) {
    input.res.status(400).json({ code: 1, message: "Provider does not support OpenForge Copilot" });
    return;
  }
  const model = selectModel(input.repo, input.provider, input.modelProfileId);
  if (!model) {
    input.res.status(input.modelProfileId ? 400 : 404).json({
      code: 1,
      message: input.modelProfileId
        ? "Model does not belong to the selected provider"
        : "Provider model not found"
    });
    return;
  }
  const appliedModel = input.shouldApply ? input.repo.setDefaultModel(model.id) ?? model : model;
  const result = {
    adapter: "openforge-copilot",
    env: {},
    secretEnvNames: [],
    files: [],
    changedFiles: [],
    internalDefault: {
      scope: "user",
      providerProfileId: input.provider.id,
      modelProfileId: appliedModel.id,
      providerName: input.provider.name,
      modelName: appliedModel.name
    }
  };
  input.res.json({ code: 0, data: input.shouldApply ? { result } : { preview: result }, message: "" });
}

function isCopilotCompatibleProvider(provider: ProviderProfile): boolean {
  return provider.apiFormat === "anthropic" || provider.apiFormat === "openai" || provider.apiFormat === "openai-compatible";
}


function selectModel(
  repo: ModelProviderRepository,
  provider: ProviderProfile | undefined,
  requestedModelId: string | undefined
): ModelProfile | undefined {
  if (!provider) return undefined;
  if (requestedModelId) {
    const model = repo.getModelProfile(requestedModelId);
    return model?.providerProfileId === provider.id ? model : undefined;
  }
  return repo.listModelProfiles(provider.id)[0];
}

function selectCredential(repo: ModelProviderRepository, providerId: string, credentialId: string | undefined) {
  if (credentialId) {
    const credential = repo.getCredential(credentialId);
    return credential?.providerProfileId === providerId ? credential : undefined;
  }
  return repo.listCredentials(providerId)[0];
}

function syncFetchedModels(
  repo: ModelProviderRepository,
  provider: ProviderProfile,
  fetchedModels: FetchedProviderModel[]
): ModelProfile[] {
  const existing = new Set(repo.listModelProfiles(provider.id).map((model) => model.modelId));
  const created: ModelProfile[] = [];
  for (const fetched of fetchedModels) {
    if (existing.has(fetched.id)) continue;
    const model = repo.createModelProfile({
      providerProfileId: provider.id,
      name: fetched.id,
      modelId: fetched.id,
      capabilities: ["chat"],
      isDefault: existing.size === 0 && created.length === 0
    });
    existing.add(fetched.id);
    created.push(model);
  }
  return created;
}

function listPresetModels(
  repo: ModelProviderRepository,
  provider: ProviderProfile,
  preset: ProviderCatalogPreset
): ModelProfile[] {
  const modelsById = new Map(repo.listModelProfiles(provider.id).map((model) => [model.modelId, model]));
  return preset.defaultModels
    .map((model) => modelsById.get(model.modelId))
    .filter((model): model is ModelProfile => Boolean(model));
}

function repoFor(db: Database, masterKey: string, req: unknown): ModelProviderRepository {
  const userId = (req as unknown as AuthenticatedRequest).userId;
  return new ModelProviderRepository(db, userId, masterKey);
}

function envNameFor(providerKey: string, adapter: string): string {
  if (adapter === "claude") return "ANTHROPIC_AUTH_TOKEN";
  const normalized = providerKey.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (normalized === "ANTHROPIC") return "ANTHROPIC_API_KEY";
  if (normalized === "OPENAI") return "OPENAI_API_KEY";
  return `${normalized}_API_KEY`;
}
