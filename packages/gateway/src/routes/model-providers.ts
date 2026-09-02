import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { isForeignKeyError } from "../lib/db-errors.js";
import { redactSensitiveErrorMessage } from "../lib/redaction.js";
import {
  ModelProviderRepository,
  type ModelProfile,
  type CreateProviderProfileInput,
  type CreateModelProfileInput,
  type ProviderProfile,
  type UpdateModelProfileInput
} from "../db/repositories/model-provider-repository.js";
import type { Database } from "../db/types.js";
import { checkModelEndpoint } from "../services/model-endpoint-health.js";
import {
  buildModelProviderReadiness,
  type ProviderReadinessAdapter
} from "../services/model-provider-readiness.js";
import {
  fetchProviderModels as fetchProviderModelsFromEndpoint,
  type FetchedProviderModel,
  type FetchProviderModelsInput
} from "../services/provider-model-fetch.js";
import {
  fetchProviderBalance as fetchProviderBalanceFromEndpoint,
  type FetchProviderBalanceInput,
  type FetchProviderBalanceResult
} from "../services/provider-balance.js";
import { getProviderCapabilities } from "../services/provider-capabilities.js";

const adapterSchema = z.enum(["claude", "opencode", "codex", "kimi"]);
const providerAdapterSchema = z.enum(["claude", "opencode", "codex", "kimi"]);
const productTypeSchema = z.enum(["payg_api", "coding_plan", "token_plan", "subscription", "local"]);
const createProviderSchema = z.object({
  name: z.string().min(1).optional(),
  providerKey: z.string().min(1).optional(),
  baseUrl: z.string().optional(),
  anthropicBaseUrl: z.string().optional(),
  openaiBaseUrl: z.string().optional(),
  region: z.string().optional(),
  productType: productTypeSchema.optional(),
  authType: z.enum(["api_key", "bearer_token", "oauth", "none"]).optional(),
  apiFormat: z.enum(["anthropic", "openai", "openai-compatible", "google", "bedrock", "local"]).optional(),
  supportedAdapters: z.array(providerAdapterSchema).optional(),
  allowPlaintextHttp: z.boolean().optional()
});
const updateProviderSchema = createProviderSchema.partial();
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
const balanceSchema = z.object({
  credentialId: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(15000).optional()
});

export interface ModelProviderRouteOptions {
  fetchProviderModels?: (input: FetchProviderModelsInput) => Promise<FetchedProviderModel[]>;
  fetchProviderBalance?: (input: FetchProviderBalanceInput) => Promise<FetchProviderBalanceResult>;
}

export function createModelProviderRoutes(db: Database, masterKey: string, options: ModelProviderRouteOptions = {}): Router {
  const router = Router();
  const fetchProviderModels = options.fetchProviderModels ?? fetchProviderModelsFromEndpoint;
  const fetchProviderBalance = options.fetchProviderBalance ?? fetchProviderBalanceFromEndpoint;
  router.use(authenticate);

  // Rate-limit network-probing endpoints (they trigger real outbound requests
  // to provider endpoints, so a stolen JWT must not be usable to spray them).
  const probeLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });
  const globalProbeLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 300, keyFn: () => "global" });
  router.use("/:id/test", probeLimiter);
  router.use("/:id/readiness", globalProbeLimiter, probeLimiter);
  router.use("/:id/models/sync", probeLimiter);
  router.use("/:id/balance", probeLimiter);

  router.get("/capabilities", (_req, res) => {
    res.json({ code: 0, data: { adapters: getProviderCapabilities() }, message: "" });
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
      const provider = createCustom(repo, parseResult.data);
      res.status(201).json({ code: 0, data: { provider }, message: "" });
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
    if (parseResult.data.allowPlaintextHttp !== undefined) updateInput.allowPlaintextHttp = parseResult.data.allowPlaintextHttp;
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
          message: "Provider is retained by historical records and cannot be deleted"
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
    const modelFetchBaseUrl = modelFetchBaseUrlFor(provider);
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
    if (credential && credential.status !== "active") {
      res.status(400).json({ code: 1, message: "An active provider credential is required to sync models" });
      return;
    }

    try {
      if (provider.authType !== "none" && !credential) {
        res.status(400).json({ code: 1, message: "Provider credential is required to sync models" });
        return;
      }
      const fetchedModels = await fetchProviderModels({
        baseUrl: modelFetchBaseUrl,
        apiKey: credential ? repo.decryptCredential(credential.id) : undefined,
        apiFormat: provider.apiFormat,
        defaultHeaders: provider.defaultHeaders,
        allowPlaintextHttp: provider.allowPlaintextHttp,
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
        message: redactSensitiveErrorMessage(
          error instanceof Error ? error.message : "Failed to sync provider models"
        )
      });
    }
  });

  router.post("/:id/balance", async (req, res) => {
    const parseResult = balanceSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid provider balance payload" });
      return;
    }
    const repo = repoFor(db, masterKey, req);
    const provider = repo.getProviderProfile(req.params.id);
    if (!provider) {
      res.status(404).json({ code: 1, message: "Provider not found" });
      return;
    }
    const baseUrls = [provider.openaiBaseUrl, provider.baseUrl].filter((value): value is string => Boolean(value));
    if (baseUrls.length === 0) {
      res.status(400).json({ code: 1, message: "Provider base URL is required" });
      return;
    }

    const credential = selectCredential(repo, provider.id, parseResult.data.credentialId);
    if (parseResult.data.credentialId && !credential) {
      res.status(400).json({ code: 1, message: "Credential does not belong to the selected provider" });
      return;
    }
    if (credential && credential.status !== "active") {
      res.status(400).json({ code: 1, message: "An active provider credential is required to query balance" });
      return;
    }
    if (provider.authType !== "none" && !credential) {
      res.status(400).json({ code: 1, message: "Provider credential is required to query balance" });
      return;
    }

    try {
      // The credential secret is decrypted in memory only and never leaves the
      // outbound Authorization header.
      const result = await fetchProviderBalance({
        baseUrls,
        apiKey: credential ? repo.decryptCredential(credential.id) : undefined,
        allowPlaintextHttp: provider.allowPlaintextHttp,
        ...(parseResult.data.timeoutMs ? { timeoutMs: parseResult.data.timeoutMs } : {})
      });
      res.json({
        code: 0,
        data: { ...result, checkedAt: new Date().toISOString() },
        message: ""
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Failed to query provider balance";
      res.status(502).json({ code: 1, message: redactSensitiveErrorMessage(raw) });
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
          message: "Model is retained by historical records and cannot be deleted"
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
    let disposition: "deleted" | "revoked" | "not_found";
    try {
      disposition = repo.deleteCredential(credential.id);
    } catch (error) {
      if (isForeignKeyError(error)) {
        res.status(409).json({
          code: 1,
          message: "Credential is retained by historical records and cannot be deleted"
        });
        return;
      }
      res.status(500).json({ code: 1, message: "Failed to delete credential" });
      return;
    }
    res.json({ code: 0, data: { disposition }, message: "" });
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
      allowPlaintextHttp: provider.allowPlaintextHttp,
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
    const readiness = await buildModelProviderReadiness({
      provider,
      model,
      credential,
      adapter: parseResult.data.adapter as ProviderReadinessAdapter,
      modelProfileId: parseResult.data.modelProfileId,
      credentialId: parseResult.data.credentialId,
      includeRemoteCheck: parseResult.data.includeRemoteCheck ?? false,
      ...(parseResult.data.timeoutMs ? { timeoutMs: parseResult.data.timeoutMs } : {}),
      decryptCredential: credential ? () => repo.decryptCredential(credential.id) : undefined,
      fetchProviderModels
    });
    res.json({ code: 0, data: { readiness }, message: "" });
  });

  return router;
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
    supportedAdapters: input.supportedAdapters ?? ["claude"],
    ...(input.allowPlaintextHttp !== undefined ? { allowPlaintextHttp: input.allowPlaintextHttp } : {})
  });
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

function modelFetchBaseUrlFor(provider: ProviderProfile): string | null {
  if (provider.apiFormat === "anthropic") {
    return provider.anthropicBaseUrl ?? provider.baseUrl ?? provider.openaiBaseUrl;
  }
  return provider.openaiBaseUrl ?? provider.baseUrl ?? provider.anthropicBaseUrl;
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
