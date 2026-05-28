import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildModelProviderReadiness,
  type ModelProviderReadinessInput
} from "../src/services/model-provider-readiness.js";
import type {
  ModelProfile,
  ProviderCredentialSummary,
  ProviderProfile
} from "../src/db/repositories/model-provider-repository.js";

const provider = createProvider();
const model = createModel();
const credential = createCredential();

describe("buildModelProviderReadiness", () => {
  it("marks a selected provider/model/credential ready when the remote model list contains the model", async () => {
    const fetchedInputs: unknown[] = [];

    const readiness = await buildModelProviderReadiness({
      provider,
      model,
      credential,
      adapter: "claude",
      modelProfileId: model.id,
      credentialId: credential.id,
      includeRemoteCheck: true,
      decryptCredential: () => "sk-provider-secret",
      fetchProviderModels: async (input) => {
        fetchedInputs.push(input);
        return [
          { id: "other-model", ownedBy: "provider" },
          { id: "model-ready", ownedBy: "provider" }
        ];
      }
    });

    assert.equal(readiness.status, "ready");
    assert.equal(readiness.code, "ready");
    assert.equal(readiness.checks.provider, "ready");
    assert.equal(readiness.checks.adapter, "supported");
    assert.equal(readiness.checks.model, "selected");
    assert.equal(readiness.checks.credential, "ready");
    assert.equal(readiness.checks.remoteModelList, "passed");
    assert.equal(readiness.remote?.modelCount, 2);
    assert.equal(readiness.remote?.matchedModelId, "model-ready");
    assert.equal(JSON.stringify(readiness).includes("sk-provider-secret"), false);
    assert.equal((fetchedInputs[0] as { apiKey?: string }).apiKey, "sk-provider-secret");
  });

  it("returns missing credential without calling the remote model list", async () => {
    let fetchCalled = false;

    const readiness = await buildModelProviderReadiness({
      provider,
      model,
      adapter: "opencode",
      modelProfileId: model.id,
      includeRemoteCheck: true,
      fetchProviderModels: async () => {
        fetchCalled = true;
        return [];
      }
    });

    assert.equal(readiness.status, "needs_attention");
    assert.equal(readiness.code, "missing_active_credential");
    assert.equal(readiness.checks.credential, "missing");
    assert.match(readiness.steps.join("\n"), /credential/i);
    assert.equal(fetchCalled, false);
  });

  it("reports remote model mismatch without returning plaintext credentials", async () => {
    const readiness = await buildModelProviderReadiness({
      provider,
      model,
      credential,
      adapter: "claude",
      modelProfileId: model.id,
      credentialId: credential.id,
      includeRemoteCheck: true,
      decryptCredential: () => "sk-hidden",
      fetchProviderModels: async () => [{ id: "other-model", ownedBy: "provider" }]
    });

    assert.equal(readiness.status, "needs_attention");
    assert.equal(readiness.code, "remote_model_missing");
    assert.equal(readiness.checks.remoteModelList, "missing_model");
    assert.match(readiness.steps.join("\n"), /model-ready/u);
    assert.equal(JSON.stringify(readiness).includes("sk-hidden"), false);
  });

  it("keeps Codex subscription-managed and skips provider remote checks", async () => {
    let fetchCalled = false;

    const readiness = await buildModelProviderReadiness({
      provider,
      model,
      credential,
      adapter: "codex",
      modelProfileId: model.id,
      credentialId: credential.id,
      includeRemoteCheck: true,
      fetchProviderModels: async () => {
        fetchCalled = true;
        return [];
      }
    });

    assert.equal(readiness.status, "managed_elsewhere");
    assert.equal(readiness.code, "codex_subscription_managed");
    assert.equal(readiness.checks.adapter, "managed_elsewhere");
    assert.match(readiness.steps.join("\n"), /subscription/i);
    assert.equal(fetchCalled, false);
  });

  it("classifies remote validation failures into actionable categories", async () => {
    const cases = [
      { message: "HTTP 401: unauthorized", errorCode: "invalid_credential", step: /credential/i },
      { message: "Request timed out", errorCode: "timeout", step: /timeout|network/i },
      { message: "HTTP 503: unavailable", errorCode: "provider_outage", step: /provider status/i },
      { message: "fetch failed", errorCode: "endpoint_or_network_failure", step: /endpoint/i }
    ] as const;

    for (const entry of cases) {
      const readiness = await buildModelProviderReadiness({
        provider,
        model,
        credential,
        adapter: "claude",
        modelProfileId: model.id,
        credentialId: credential.id,
        includeRemoteCheck: true,
        decryptCredential: () => "sk-hidden",
        fetchProviderModels: async () => {
          throw new Error(entry.message);
        }
      });

      assert.equal(readiness.status, "needs_attention");
      assert.equal(readiness.code, "remote_validation_failed");
      assert.equal(readiness.remote?.errorCode, entry.errorCode);
      assert.match(readiness.steps.join("\n"), entry.step);
      assert.equal(JSON.stringify(readiness).includes("sk-hidden"), false);
    }
  });

  it("reports remote validation unavailable when a remote check is requested without a model-list endpoint", async () => {
    const readiness = await buildModelProviderReadiness({
      provider: createProvider({ baseUrl: null, openaiBaseUrl: null }),
      model,
      credential,
      adapter: "claude",
      credentialId: credential.id,
      includeRemoteCheck: true,
      decryptCredential: () => "sk-hidden",
      fetchProviderModels: async () => {
        throw new Error("must not fetch without an endpoint");
      }
    });

    assert.equal(readiness.status, "needs_attention");
    assert.equal(readiness.code, "remote_validation_unavailable");
    assert.equal(readiness.checks.remoteModelList, "unavailable");
    assert.equal(readiness.remote?.checked, false);
  });
});

function createProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: "provider-1",
    userId: "user-1",
    providerKey: "provider",
    name: "Provider",
    baseUrl: "https://api.example.com/anthropic",
    anthropicBaseUrl: "https://api.example.com/anthropic",
    openaiBaseUrl: "https://api.example.com/v1",
    region: "global",
    productType: "payg_api",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["claude", "opencode"],
    defaultHeaders: {},
    opencodeNpm: "@ai-sdk/openai-compatible",
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function createModel(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "model-1",
    userId: "user-1",
    providerProfileId: "provider-1",
    providerKey: "provider",
    providerName: "Provider",
    baseUrl: "https://api.example.com/anthropic",
    anthropicBaseUrl: "https://api.example.com/anthropic",
    openaiBaseUrl: "https://api.example.com/v1",
    name: "Ready Model",
    modelId: "model-ready",
    capabilities: ["chat", "code"],
    contextWindow: 128000,
    status: "active",
    isDefault: true,
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function createCredential(overrides: Partial<ProviderCredentialSummary> = {}): ProviderCredentialSummary {
  return {
    id: "credential-1",
    userId: "user-1",
    providerProfileId: "provider-1",
    label: "Credential",
    status: "active",
    secretPreview: "********",
    lastUsedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}
