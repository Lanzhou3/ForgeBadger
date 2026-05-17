import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openforge-language", "en");
    window.localStorage.setItem("openforge.token", "e2e-token");
    window.localStorage.setItem("openforge.user", JSON.stringify({
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

  await expect(page.getByText("Provider Catalog")).toBeVisible();
  await expect(page.getByText("40/40 matches")).toBeVisible();

  await page.getByPlaceholder("Type a provider, model, endpoint, or API format").fill("provider-39");

  await expect(page.getByText("1/40 matches")).toBeVisible();
  await expect(page.getByText("Provider 39", { exact: true })).toBeVisible();
  await expect(page.getByText("Provider 01")).toHaveCount(0);

  const catalogScrollArea = page.getByTestId("provider-catalog-list");
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
  await page.getByPlaceholder("Type a provider, model, endpoint, or API format").fill("provider-01");
  await page.getByRole("button", { name: "Add" }).click();

  const dialog = page.getByRole("dialog", { name: /Configure Provider 01/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Anthropic: https://provider-01.example.com/anthropic")).toBeVisible();
  await expect(dialog.getByText("OpenAI: https://provider-01.example.com/v1")).toBeVisible();
  await dialog.getByLabel("Credential name").fill("Minimax subscription");
  await dialog.getByLabel("API key").fill("sk-minimax-test");
  await dialog.getByRole("button", { name: "Save and sync models" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#apply-model")).toHaveValue("model-1");
  expect(requests.providerCreate).toEqual({ catalogId: "provider-01" });
  expect(requests.credentialCreate).toEqual({
    label: "Minimax subscription",
    plaintextSecret: "sk-minimax-test",
  });
  expect(requests.syncModels).toEqual({ credentialId: "credential-1" });

  await page.getByLabel("Apply to").selectOption("openforge-copilot");
  await expect(page.getByText("Copilot uses the OpenForge internal runtime default model and does not write project files or external CLI config.")).toBeVisible();
  await page.getByRole("button", { name: "Preview" }).click();

  expect(requests.previewApply).toEqual({
    adapter: "openforge-copilot",
    modelProfileId: "model-1",
    credentialId: "credential-1",
  });
  await expect(page.getByRole("button", { name: "Apply config" })).toBeEnabled();
});

async function mockModelsApis(
  page: Page,
  overrides: { configuredProviders?: Array<Record<string, unknown>> } = {}
) {
  const requests: {
    providerCreate?: unknown;
    credentialCreate?: unknown;
    syncModels?: unknown;
    previewApply?: unknown;
  } = {};
  let configuredProviders = overrides.configuredProviders ?? [];
  let configuredModels: Array<Record<string, unknown>> = [];
  let configuredCredentials: Array<Record<string, unknown>> = [];

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
        configuredProviders = [
          {
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
          },
        ];
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
      configuredCredentials = [
        {
          id: "credential-1",
          providerProfileId: "provider-profile-1",
          label: "Minimax subscription",
          status: "active",
          secretPreview: "sk-...test",
        },
      ];
      await route.fulfill({ json: envelope({ credential: configuredCredentials[0] }) });
      return;
    }

    if (url.pathname === "/api/v1/model-providers/provider-profile-1/models/sync" && method === "POST") {
      requests.syncModels = route.request().postDataJSON();
      configuredModels = [
        {
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
        },
      ];
      await route.fulfill({
        json: envelope({
          fetchedCount: 1,
          createdCount: 1,
          models: configuredModels,
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/model-providers/provider-profile-1/preview-apply" && method === "POST") {
      requests.previewApply = route.request().postDataJSON();
      await route.fulfill({
        json: envelope({
          preview: {
            adapter: "openforge-copilot",
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

    await route.fulfill({ json: envelope({}) });
  });

  return requests;
}

function envelope(data: unknown) {
  return { code: 0, data, message: "" };
}
