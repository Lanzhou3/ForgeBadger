import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import {
  ModelProviderRepository,
  type ModelProfile,
  type CreateProviderProfileInput,
  type CreateModelProfileInput,
  type ProviderAdapter,
  type ProviderApiFormat,
  type ProviderAuthType,
  type ProviderProfile,
  type UpdateModelProfileInput
} from "../db/repositories/model-provider-repository.js";
import type { Database } from "../db/types.js";
import {
  getProviderCatalog,
  getProviderCatalogPreset,
  type ProviderCatalogPreset
} from "../services/model-catalog.js";
import { checkModelEndpoint } from "../services/model-endpoint-health.js";
import {
  applyModelProviderConfig,
  previewModelProviderConfig,
  type ModelConfigApplyAdapter
} from "../services/model-config-apply.js";
import {
  fetchProviderModels as fetchProviderModelsFromEndpoint,
  type FetchedProviderModel,
  type FetchProviderModelsInput
} from "../services/provider-model-fetch.js";

const adapterSchema = z.enum(["claude", "opencode", "codex"]);
const createProviderSchema = z.object({
  catalogId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  providerKey: z.string().min(1).optional(),
  baseUrl: z.string().optional(),
  authType: z.enum(["api_key", "bearer_token", "oauth", "none"]).optional(),
  apiFormat: z.enum(["anthropic", "openai", "openai-compatible", "google", "bedrock", "local"]).optional(),
  supportedAdapters: z.array(z.enum(["claude", "opencode"])).optional()
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
  projectRoot: z.string().min(1),
  modelProfileId: z.string().min(1).optional(),
  credentialId: z.string().min(1).optional()
});
const endpointTestSchema = z.object({
  timeoutMs: z.number().int().min(100).max(15000).optional()
});
const syncModelsSchema = z.object({
  credentialId: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(30000).optional()
});

export interface ModelProviderRouteOptions {
  fetchProviderModels?: (input: FetchProviderModelsInput) => Promise<FetchedProviderModel[]>;
}

export function createModelProviderRoutes(db: Database, masterKey: string, options: ModelProviderRouteOptions = {}): Router {
  const router = Router();
  const fetchProviderModels = options.fetchProviderModels ?? fetchProviderModelsFromEndpoint;
  router.use(authenticate);

  router.get("/catalog", (_req, res) => {
    res.json({ code: 0, data: { providers: getProviderCatalog() }, message: "" });
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

  router.post("/", (req, res) => {
    const parseResult = createProviderSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid provider payload" });
      return;
    }
    const repo = repoFor(db, masterKey, req);
    try {
      const result = createProvider(repo, parseResult.data);
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
    const deleted = repoFor(db, masterKey, req).deleteProviderProfile(req.params.id);
    if (!deleted) {
      res.status(404).json({ code: 1, message: "Provider not found" });
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
    if (!provider?.baseUrl) {
      res.status(provider ? 400 : 404).json({
        code: 1,
        message: provider ? "Provider base URL is required" : "Provider not found"
      });
      return;
    }

    const credential = selectCredential(repo, provider.id, parseResult.data.credentialId);
    if (parseResult.data.credentialId && !credential) {
      res.status(400).json({ code: 1, message: "Credential does not belong to the selected provider" });
      return;
    }
    if (provider.authType !== "none" && !credential) {
      res.status(400).json({ code: 1, message: "Provider credential is required to sync models" });
      return;
    }

    try {
      const fetchedModels = await fetchProviderModels({
        baseUrl: provider.baseUrl,
        apiKey: credential ? repo.decryptCredential(credential.id) : undefined,
        modelsUrl: getProviderCatalogPreset(provider.providerKey)?.modelFetch?.modelsUrl,
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
    repo.deleteModelProfile(model.id);
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

  router.post("/:id/preview-apply", async (req, res) => {
    await handleApplyRequest({ db, masterKey, req, res, shouldApply: false });
  });

  router.post("/:id/apply", async (req, res) => {
    await handleApplyRequest({ db, masterKey, req, res, shouldApply: true });
  });

  return router;
}

function createProvider(repo: ModelProviderRepository, input: z.infer<typeof createProviderSchema>) {
  const preset = input.catalogId ? getProviderCatalogPreset(input.catalogId) : undefined;
  const provider = preset ? createFromPreset(repo, preset) : createCustom(repo, input);
  const models = preset?.modelSource === "static"
    ? preset.defaultModels.map((model, index) => repo.createModelProfile({
      providerProfileId: provider.id,
      name: model.name,
      modelId: model.modelId,
      capabilities: model.capabilities,
      contextWindow: model.contextWindow ?? null,
      isDefault: index === 0
    }))
    : [];
  return { provider, models };
}

function createFromPreset(repo: ModelProviderRepository, preset: ProviderCatalogPreset): ProviderProfile {
  return repo.createProviderProfile({
    name: preset.name,
    providerKey: preset.id,
    baseUrl: preset.baseUrl,
    authType: preset.authType as ProviderAuthType,
    apiFormat: preset.apiFormat as ProviderApiFormat,
    supportedAdapters: preset.supportedAdapters as ProviderAdapter[],
    ...(preset.headers ? { defaultHeaders: preset.headers } : {})
  });
}

function createCustom(repo: ModelProviderRepository, input: z.infer<typeof createProviderSchema>): ProviderProfile {
  if (!input.name || !input.providerKey || !input.authType || !input.apiFormat) {
    throw new Error("Custom provider requires name, providerKey, authType, and apiFormat");
  }
  return repo.createProviderProfile({
    name: input.name,
    providerKey: input.providerKey,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    authType: input.authType,
    apiFormat: input.apiFormat,
    supportedAdapters: input.supportedAdapters ?? ["opencode"]
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
  if (!provider.supportedAdapters.includes(parseResult.data.adapter as ProviderAdapter)) {
    input.res.status(400).json({ code: 1, message: "Provider does not support the selected adapter" });
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
    projectRoot: parseResult.data.projectRoot,
    adapter: parseResult.data.adapter as ModelConfigApplyAdapter,
    provider: {
      id: provider.id,
      providerKey: provider.providerKey,
      baseUrl: provider.baseUrl,
      authType: provider.authType,
      apiFormat: provider.apiFormat
    },
    model: { id: model.id, modelId: model.modelId },
    ...(credential ? { credential: { id: credential.id, envName: envNameFor(provider.providerKey) } } : {})
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

function repoFor(db: Database, masterKey: string, req: unknown): ModelProviderRepository {
  const userId = (req as unknown as AuthenticatedRequest).userId;
  return new ModelProviderRepository(db, userId, masterKey);
}

function envNameFor(providerKey: string): string {
  const normalized = providerKey.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (normalized === "ANTHROPIC") return "ANTHROPIC_API_KEY";
  if (normalized === "OPENAI") return "OPENAI_API_KEY";
  return `${normalized}_API_KEY`;
}
