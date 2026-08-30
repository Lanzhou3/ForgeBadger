import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("forgebadger-language", "en");
    window.localStorage.setItem("forgebadger.token", "e2e-token");
    window.localStorage.setItem("forgebadger.user", JSON.stringify({
      id: "user-e2e",
      email: "models-e2e@example.com",
      role: "admin",
      status: "active",
    }));
  });
});

test("Models provider catalog supports direct search through a long verified provider registry", async ({ page }) => {
  await mockModelsApis(page);

  await page.goto("/models");

  await page.getByRole("button", { name: "Add provider" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Provider Catalog" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("40/40 matches")).toBeVisible();

  await dialog.getByPlaceholder("Type a provider, model, endpoint, or API format").fill("provider-39");

  await expect(dialog.getByText("1/40 matches")).toBeVisible();
  await expect(dialog.getByText("Provider 39", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Provider 01")).toHaveCount(0);

  const catalogScrollArea = dialog.getByTestId("provider-catalog-list");
  await expect(catalogScrollArea).toHaveCSS("overflow-y", "auto");
});

test("Models configured provider list stays usable with many providers", async ({ page }) => {
  await mockModelsApis(page, {
    configuredProviders: Array.from({ length: 35 }, (_item, index) => {
      const number = String(index + 1).padStart(2, "0");
      return {
        id: `configured-provider-${number}`,
        providerKey: `configured-${number}`,
        name: `Configured Provider ${number}`,
        baseUrl: `https://configured-${number}.example.com/v1`,
        authType: "api_key",
        apiFormat: "openai-compatible",
        supportedAdapters: ["claude", "opencode"],
        opencodeNpm: `@ai-sdk/configured-${number}`,
        anthropicBaseUrl: `https://configured-${number}.example.com/anthropic`,
        openaiBaseUrl: `https://configured-${number}.example.com/v1`,
        region: "global",
        productType: "payg_api",
        status: "active",
      };
    }),
  });

  await page.goto("/models");

  const providerList = page.getByTestId("configured-provider-list");
  await expect(providerList).toHaveCSS("overflow-y", "auto");
  await expect(providerList).toHaveCSS("max-height", /[1-9]\d*px/);
  await expect(page.getByRole("button", { name: /Configured Provider 01/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByPlaceholder("Search configured providers").fill("configured-35");
  await expect(page.getByRole("button", { name: /Configured Provider 35/ })).toBeVisible();
});

test("Models provider add dialog saves credential, syncs models, and previews Copilot without project root", async ({ page }) => {
  const requests = await mockModelsApis(page);

  await page.goto("/models");
  await page.getByRole("button", { name: "Add provider" }).first().click();
  const catalogDialog = page.getByRole("dialog", { name: "Provider Catalog" });
  await catalogDialog.getByPlaceholder("Type a provider, model, endpoint, or API format").fill("provider-01");
  await catalogDialog.getByRole("button", { name: "Add" }).click();

  const dialog = page.getByRole("dialog", { name: /Configure Provider 01/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Anthropic: https://provider-01.example.com/anthropic")).toBeVisible();
  await expect(dialog.getByText("OpenAI: https://provider-01.example.com/v1")).toBeVisible();
  await dialog.getByLabel("Credential name").fill("Minimax subscription");
  await dialog.getByLabel("API key").fill("test-minimax-token");
  await dialog.getByRole("button", { name: "Save and sync models" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: "Apply" }).click();
  await expect(page.locator("#apply-model")).toHaveValue("model-1");
  expect(requests.providerCreate).toEqual({ catalogId: "provider-01" });
  expect(requests.credentialCreate).toEqual({
    label: "Minimax subscription",
    plaintextSecret: "test-minimax-token",
  });
  expect(requests.syncModels).toEqual({ credentialId: "credential-1" });

  await page.getByLabel("Apply to").selectOption("forgebadger-copilot");
  await expect(page.getByText("Copilot uses the ForgeBadger internal runtime default model and does not write project files or external CLI config.")).toBeVisible();
  await page.getByRole("button", { name: "Preview" }).click();

  expect(requests.previewApply).toEqual({
    adapter: "forgebadger-copilot",
    scope: "project",
    modelProfileId: "model-1",
    credentialId: "credential-1",
  });
  await expect(page.getByRole("button", { name: "Apply config" })).toBeEnabled();
});

test("Models provider readiness shows healthy remote model evidence and Codex identity", async ({ page }) => {
  const requests = await mockModelsApis(page, {
    configuredProviders: [providerProfile()],
    configuredModels: [modelProfile()],
    configuredCredentials: [credentialSummary()],
  });

  await page.goto("/models");

  await expect(page.getByText("Codex subscription account")).toBeVisible();
  await expect(page.getByText("Provider apply disabled")).toBeVisible();
  await expect(page.getByText("chatgpt_subscription_sdk")).toBeVisible();
  await page.getByRole("button", { name: "Check readiness" }).click();

  expect(requests.readiness).toEqual({
    adapter: "claude",
    modelProfileId: "model-1",
    credentialId: "credential-1",
    includeRemoteCheck: true,
    timeoutMs: 5000,
  });
  const healthCard = page.getByTestId("provider-health-card");
  await expect(healthCard.getByText("Provider health")).toBeVisible();
  await expect(healthCard.getByText("ready", { exact: true }).first()).toBeVisible();
  await expect(healthCard.getByText("Remote model list", { exact: true })).toBeVisible();
  await expect(healthCard.getByText("passed", { exact: true })).toBeVisible();
  await expect(healthCard.getByText("provider-01-model")).toBeVisible();
  await expect(page.getByText(/test-minimax-token|sk-/)).toHaveCount(0);
});

test("Models provider readiness shows actionable remote failures", async ({ page }) => {
  await mockModelsApis(page, {
    configuredProviders: [providerProfile()],
    configuredModels: [modelProfile()],
    configuredCredentials: [credentialSummary()],
    readiness: {
      status: "needs_attention",
      code: "remote_validation_failed",
      checkedAt: "2026-05-29T02:00:00.000Z",
      provider: {
        id: "provider-profile-1",
        name: "Provider 01",
        providerKey: "provider-01",
        apiFormat: "openai-compatible",
        authType: "api_key",
      },
      selection: {
        adapter: "claude",
        modelProfileId: "model-1",
        modelId: "provider-01-model",
        credentialId: "credential-1",
      },
      checks: {
        provider: "ready",
        adapter: "supported",
        model: "selected",
        credential: "ready",
        remoteModelList: "failed",
      },
      remote: {
        checked: true,
        errorCode: "invalid_credential",
        error: "HTTP 401: unauthorized",
      },
      steps: ["Check that the selected credential is active and belongs to this provider."],
    },
  });

  await page.goto("/models");
  await page.getByRole("button", { name: "Check readiness" }).click();

  const healthCard = page.getByTestId("provider-health-card");
  await expect(healthCard.getByText("needs_attention", { exact: true })).toBeVisible();
  await expect(healthCard.getByText("remote_validation_failed", { exact: true })).toBeVisible();
  await expect(healthCard.getByText("invalid_credential")).toBeVisible();
  await expect(healthCard.getByText("Check that the selected credential is active and belongs to this provider.")).toBeVisible();
  await expect(page.getByText(/sk-|test-minimax-token/)).toHaveCount(0);
});

test("Models provider readiness distinguishes remote recovery categories", async ({ page }) => {
  const readinessQueue = [
    readinessFixture({
      code: "remote_validation_failed",
      remoteModelList: "failed",
      remote: {
        checked: true,
        errorCode: "timeout",
        error: "Request timed out",
      },
      steps: ["Retry with a longer timeout or check network connectivity to the provider endpoint."],
    }),
    readinessFixture({
      code: "remote_validation_failed",
      remoteModelList: "failed",
      remote: {
        checked: true,
        errorCode: "provider_outage",
        error: "HTTP 503: unavailable",
      },
      steps: ["Retry later or check the provider status page."],
    }),
    readinessFixture({
      code: "remote_validation_failed",
      remoteModelList: "failed",
      remote: {
        checked: true,
        errorCode: "endpoint_or_network_failure",
        error: "fetch failed",
      },
      steps: ["Check the provider endpoint, network access, and model-list support."],
    }),
    readinessFixture({
      code: "remote_model_missing",
      remoteModelList: "missing_model",
      remote: {
        checked: true,
        modelCount: 2,
      },
      steps: ["The provider model list did not include provider-01-model. Sync models or choose a model ID returned by the provider."],
    }),
  ];
  await mockModelsApis(page, {
    configuredProviders: [providerProfile()],
    configuredModels: [modelProfile()],
    configuredCredentials: [credentialSummary()],
    readiness: readinessQueue,
  });

  await page.goto("/models");
  const healthCard = page.getByTestId("provider-health-card");

  for (const expectation of [
    {
      code: "remote_validation_failed",
      marker: "Error category: timeout",
      step: "Retry with a longer timeout or check network connectivity to the provider endpoint.",
    },
    {
      code: "remote_validation_failed",
      marker: "Error category: provider_outage",
      step: "Retry later or check the provider status page.",
    },
    {
      code: "remote_validation_failed",
      marker: "Error category: endpoint_or_network_failure",
      step: "Check the provider endpoint, network access, and model-list support.",
    },
    {
      code: "remote_model_missing",
      marker: "missing_model",
      step: "The provider model list did not include provider-01-model. Sync models or choose a model ID returned by the provider.",
    },
  ]) {
    await page.getByRole("button", { name: "Check readiness" }).click();
    await expect(healthCard.getByText(expectation.code, { exact: true })).toBeVisible();
    await expect(healthCard.getByText(expectation.marker)).toBeVisible();
    await expect(healthCard.getByText(expectation.step)).toBeVisible();
    await expect(page.getByText(/sk-|test-minimax-token|Bearer/)).toHaveCount(0);
  }
});

async function mockModelsApis(
  page: Page,
  overrides: {
    configuredProviders?: Array<Record<string, unknown>>;
    configuredModels?: Array<Record<string, unknown>>;
    configuredCredentials?: Array<Record<string, unknown>>;
    readiness?: Record<string, unknown> | Array<Record<string, unknown>>;
  } = {}
) {
  const requests: {
    providerCreate?: unknown;
    credentialCreate?: unknown;
    syncModels?: unknown;
    previewApply?: unknown;
    readiness?: unknown;
  } = {};
  let configuredProviders = overrides.configuredProviders ?? [];
  let configuredModels: Array<Record<string, unknown>> = overrides.configuredModels ?? [];
  let configuredCredentials: Array<Record<string, unknown>> = overrides.configuredCredentials ?? [];

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/api/v1/auth/me") {
      await route.fulfill({
        json: envelope({
          id: "user-e2e",
          email: "models-e2e@example.com",
          role: "admin",
          status: "active",
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/model-providers/catalog") {
      await route.fulfill({
        json: envelope({
          providers: Array.from({ length: 40 }, (_item, index) => {
            const number = String(index + 1).padStart(2, "0");
            return {
              id: `provider-${number}`,
              name: `Provider ${number}`,
              description: `Provider ${number} verified dual-protocol preset`,
              baseUrl: `https://provider-${number}.example.com/anthropic`,
              authType: "api_key",
              apiFormat: "openai-compatible",
              supportedAdapters: ["claude", "opencode"],
              modelSource: "static",
              source: "verified",
              region: "global",
              productType: "payg_api",
              endpoints: {
                anthropic: { baseUrl: `https://provider-${number}.example.com/anthropic` },
                openai: { baseUrl: `https://provider-${number}.example.com/v1` },
              },
              claude: {
                env: {
                  baseUrl: "ANTHROPIC_BASE_URL",
                  authToken: "ANTHROPIC_AUTH_TOKEN",
                  model: "ANTHROPIC_MODEL",
                  smallFastModel: "ANTHROPIC_SMALL_FAST_MODEL",
                  defaultSonnetModel: "ANTHROPIC_DEFAULT_SONNET_MODEL",
                  defaultHaikuModel: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                  defaultOpusModel: "ANTHROPIC_DEFAULT_OPUS_MODEL",
                  apiTimeoutMs: "API_TIMEOUT_MS",
                },
              },
              defaultModels: [
                {
                  id: `provider-${number}-model`,
                  name: `Provider ${number} Model`,
                  modelId: `provider-${number}-model`,
                  capabilities: ["chat", "code"],
                },
              ],
            };
          }),
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/model-providers") {
      if (method === "POST") {
        requests.providerCreate = route.request().postDataJSON();
        configuredProviders = [providerProfile()];
        await route.fulfill({
          json: envelope({
            provider: configuredProviders[0],
            models: [],
          }),
        });
        return;
      }
      await route.fulfill({
        json: envelope({
          providers: configuredProviders,
          models: configuredModels,
          credentials: configuredCredentials,
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/model-providers/provider-profile-1/credentials" && method === "POST") {
      requests.credentialCreate = route.request().postDataJSON();
      configuredCredentials = [credentialSummary()];
      await route.fulfill({ json: envelope({ credential: configuredCredentials[0] }) });
      return;
    }

    if (url.pathname === "/api/v1/model-providers/provider-profile-1/models/sync" && method === "POST") {
      requests.syncModels = route.request().postDataJSON();
      configuredModels = [modelProfile()];
      await route.fulfill({
        json: envelope({
          fetchedCount: 1,
          createdCount: 1,
          models: configuredModels,
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/model-providers/provider-profile-1/readiness" && method === "POST") {
      requests.readiness = route.request().postDataJSON();
      const readiness = Array.isArray(overrides.readiness)
        ? overrides.readiness.shift()
        : overrides.readiness;
      await route.fulfill({
        json: envelope({
          readiness: readiness ?? {
            status: "ready",
            code: "ready",
            checkedAt: "2026-05-29T02:00:00.000Z",
            provider: {
              id: "provider-profile-1",
              name: "Provider 01",
              providerKey: "provider-01",
              apiFormat: "openai-compatible",
              authType: "api_key",
            },
            selection: {
              adapter: "claude",
              modelProfileId: "model-1",
              modelId: "provider-01-model",
              credentialId: "credential-1",
            },
            checks: {
              provider: "ready",
              adapter: "supported",
              model: "selected",
              credential: "ready",
              remoteModelList: "passed",
            },
            remote: {
              checked: true,
              modelCount: 2,
              matchedModelId: "provider-01-model",
            },
            steps: [],
          },
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/codex/subscription/status") {
      await route.fulfill({
        json: envelope({
          status: {
            providerApplyEnabled: false,
            identitySource: "chatgpt_subscription_sdk",
            connectionState: "connected",
            accountLabel: "Codex signed in",
            canUseAppServerIdentity: true,
            sdk: {
              packageName: "@openai/codex-sdk",
              installed: true,
              docsUrl: "https://developers.openai.com/codex/sdk",
              appServerDocsUrl: "https://developers.openai.com/codex",
            },
          },
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/model-providers/provider-profile-1/preview-apply" && method === "POST") {
      requests.previewApply = route.request().postDataJSON();
      await route.fulfill({
        json: envelope({
          preview: {
            adapter: "forgebadger-copilot",
            env: {},
            secretEnvNames: [],
            changedFiles: [],
            files: [],
            internalDefault: {
              scope: "user",
              providerProfileId: "provider-profile-1",
              modelProfileId: "model-1",
              providerName: "Provider 01",
              modelName: "Provider 01 Model",
            },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: {
        code: 1,
        message: `Unhandled mocked API route: ${method} ${url.pathname}`,
      },
    });
  });

  return requests;
}

function envelope(data: unknown) {
  return { code: 0, data, message: "" };
}

function providerProfile() {
  return {
    id: "provider-profile-1",
    providerKey: "provider-01",
    name: "Provider 01",
    baseUrl: "https://provider-01.example.com/anthropic",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["claude", "opencode"],
    opencodeNpm: "@ai-sdk/openai-compatible",
    anthropicBaseUrl: "https://provider-01.example.com/anthropic",
    openaiBaseUrl: "https://provider-01.example.com/v1",
    region: "global",
    productType: "payg_api",
    status: "active",
  };
}

function readinessFixture(overrides: {
  code: string;
  remoteModelList: string;
  remote: Record<string, unknown>;
  steps: string[];
}) {
  return {
    status: "needs_attention",
    code: overrides.code,
    checkedAt: "2026-05-29T02:00:00.000Z",
    provider: {
      id: "provider-profile-1",
      name: "Provider 01",
      providerKey: "provider-01",
      apiFormat: "openai-compatible",
      authType: "api_key",
    },
    selection: {
      adapter: "claude",
      modelProfileId: "model-1",
      modelId: "provider-01-model",
      credentialId: "credential-1",
    },
    checks: {
      provider: "ready",
      adapter: "supported",
      model: "selected",
      credential: "ready",
      remoteModelList: overrides.remoteModelList,
    },
    remote: overrides.remote,
    steps: overrides.steps,
  };
}

function modelProfile() {
  return {
    id: "model-1",
    providerProfileId: "provider-profile-1",
    providerKey: "provider-01",
    providerName: "Provider 01",
    baseUrl: "https://provider-01.example.com/anthropic",
    anthropicBaseUrl: "https://provider-01.example.com/anthropic",
    openaiBaseUrl: "https://provider-01.example.com/v1",
    name: "Provider 01 Model",
    modelId: "provider-01-model",
    capabilities: ["chat", "code"],
    status: "active",
    isDefault: true,
  };
}

function credentialSummary() {
  return {
    id: "credential-1",
    providerProfileId: "provider-profile-1",
    label: "Minimax subscription",
    status: "active",
    secretPreview: "redacted-test",
  };
}
