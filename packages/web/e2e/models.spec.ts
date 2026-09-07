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

test("Models provider can be created manually with an optional credential and model sync", async ({ page }) => {
  const requests = await mockModelsApis(page);

  await page.goto("/models");

  await page.getByRole("button", { name: "Add provider" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add provider" });
  await expect(dialog).toBeVisible();

  const submitButton = dialog.getByRole("button", { name: "Save and sync models" });
  // A base URL is required before the manual form can be submitted.
  await expect(submitButton).toBeDisabled();

  await dialog.getByLabel("Name", { exact: true }).fill("My Provider");
  // providerKey is derived from the name but stays editable.
  await expect(dialog.getByLabel("Provider Key")).toHaveValue("my-provider");
  await dialog.getByLabel("API Format").selectOption("openai-compatible");
  await dialog.getByLabel("OpenAI-compatible base URL").fill("https://provider-01.example.com/v1");
  await dialog.getByLabel("OpenCode").check();
  await dialog.getByLabel("API Key").fill("sk-e2e-secret");

  await submitButton.click();

  // Wait for the full create -> credential -> sync chain to settle; feedback
  // now arrives as a sonner toast instead of a persistent banner.
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]").getByText("Provider created")).toBeVisible();

  expect(requests.providerCreate).toEqual({
    name: "My Provider",
    providerKey: "my-provider",
    authType: "api_key",
    apiFormat: "openai-compatible",
    baseUrl: "https://provider-01.example.com/v1",
    openaiBaseUrl: "https://provider-01.example.com/v1",
    supportedAdapters: ["claude", "opencode"],
  });
  expect(requests.credentialCreate).toEqual({
    plaintextSecret: "sk-e2e-secret",
  });
  expect(requests.syncModels).toEqual({ credentialId: "credential-1" });
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

test("Models provider can be applied to a CLI config after a redacted preview", async ({ page }) => {
  const requests = await mockModelsApis(page, {
    configuredProviders: [providerProfile()],
    configuredModels: [modelProfile()],
    configuredCredentials: [credentialSummary()],
  });

  await page.goto("/models");
  await page.getByRole("button", { name: "Apply to CLI" }).click();

  const dialog = page.getByRole("dialog", { name: "Apply to CLI" });
  await expect(dialog).toBeVisible();
  // The change summary is lazy: no preview request fires until it is expanded.
  expect(requests.applyPreview).toBeUndefined();
  await dialog.getByRole("button", { name: "View change summary" }).click();
  await expect(dialog.getByText("/home/e2e/.claude/settings.json")).toBeVisible();
  // The preview payload intentionally carries a plaintext-looking key; the UI must mask it.
  await expect(dialog.getByText(/sk-live-secret/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Apply config" }).click();

  expect(requests.applyPreview).toEqual({
    providerProfileId: "provider-profile-1",
    modelProfileId: "model-1",
    credentialId: "credential-1",
  });
  expect(requests.applyProvider).toEqual({
    providerProfileId: "provider-profile-1",
    modelProfileId: "model-1",
    credentialId: "credential-1",
  });
  await expect(dialog).toHaveCount(0);
});

test("Models diagnostics tab runs the provider endpoint speed test", async ({ page }) => {
  const requests = await mockModelsApis(page, {
    configuredProviders: [providerProfile()],
    configuredModels: [modelProfile()],
    configuredCredentials: [credentialSummary()],
  });

  await page.goto("/models");

  await page.getByRole("tab", { name: "Diagnostics" }).click();
  await page.getByRole("button", { name: "Check endpoint" }).click();

  expect(requests.endpointTest).toEqual({ timeoutMs: 5000 });
  const healthRow = page.getByTestId("endpoint-health-row");
  await expect(healthRow.getByText("Endpoint reachable")).toBeVisible();
  await expect(healthRow.getByText(/42 ms/)).toBeVisible();
  await expect(healthRow.getByText(/HTTP 200/)).toBeVisible();
  await expect(page.getByText(/test-minimax-token|sk-/)).toHaveCount(0);
});

test("Models CLI status grid shows per-CLI applied state", async ({ page }) => {
  await mockModelsApis(page, {
    configuredProviders: [providerProfile()],
    configuredModels: [modelProfile()],
    configuredCredentials: [credentialSummary()],
  });

  await page.goto("/models");

  const grid = page.getByTestId("cli-status-section");
  await expect(grid).toBeVisible();
  for (const adapter of ["claude", "opencode", "codex", "kimi"]) {
    await expect(page.getByTestId(`cli-status-${adapter}`)).toBeVisible();
  }
  // The mocked applied pointer puts this provider in effect on Claude Code.
  await expect(page.getByTestId("cli-status-claude").getByText("Provider 01 · Active")).toBeVisible();
  await expect(page.getByTestId("cli-status-codex").getByText("Not configured")).toBeVisible();
});

async function mockModelsApis(
  page: Page,
  overrides: {
    configuredProviders?: Array<Record<string, unknown>>;
    configuredModels?: Array<Record<string, unknown>>;
    configuredCredentials?: Array<Record<string, unknown>>;
  } = {}
) {
  const requests: {
    providerCreate?: unknown;
    credentialCreate?: unknown;
    syncModels?: unknown;
    endpointTest?: unknown;
    applyPreview?: unknown;
    applyProvider?: unknown;
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

    if (url.pathname === "/api/v1/model-providers/applied" && method === "GET") {
      await route.fulfill({
        json: envelope({
          adapters: [
            {
              adapter: "claude",
              applied: {
                providerProfileId: "provider-profile-1",
                providerName: "Provider 01",
                providerStatus: "active",
                modelProfileId: "model-1",
                modelId: "provider-01-model",
                modelName: "Provider 01 Model",
                appliedAt: "2026-05-29T02:00:00.000Z",
              },
              configDefaultModel: "provider-01-model",
              stale: false,
            },
            { adapter: "opencode", applied: null, configDefaultModel: null, stale: false },
            { adapter: "codex", applied: null, configDefaultModel: null, stale: false },
            { adapter: "kimi", applied: null, configDefaultModel: null, stale: false },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/adapters/discovery") {
      await route.fulfill({
        json: envelope({
          adapters: ["claude", "opencode", "codex", "kimi"].map((id) => ({
            id,
            label: id,
            command: id,
            supportLevel: "supported",
            launchEnabled: true,
            configDir: `/home/e2e/.${id}`,
            runtimeModes: ["terminal"],
            available: true,
            status: "available",
          })),
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/cli-config/routing/claude") {
      await route.fulfill({
        json: envelope({
          routing: {
            enabled: false,
            hasToken: false,
            gatewayUrl: "http://127.0.0.1:48731",
            assignment: null,
          },
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/model-providers/provider-profile-1/balance" && method === "POST") {
      await route.fulfill({
        json: envelope({ supported: false, balances: [], checkedAt: "2026-05-29T02:00:00.000Z" }),
      });
      return;
    }

    if (url.pathname === "/api/v1/cli-config/claude/apply-provider/preview" && method === "POST") {
      requests.applyPreview = route.request().postDataJSON();
      await route.fulfill({
        json: envelope({
          preview: {
            adapter: "claude",
            providerProfileId: "provider-profile-1",
            modelProfileId: "model-1",
            credentialId: "credential-1",
            files: [
              {
                targetPath: "/home/e2e/.claude/settings.json",
                fileType: "json",
                operation: "update",
                current: "{}",
                // Intentionally carries a plaintext-looking key; the UI must mask it.
                proposed: '{\n  "env": {\n    "ANTHROPIC_AUTH_TOKEN": "sk-live-secret",\n    "ANTHROPIC_MODEL": "provider-01-model"\n  }\n}',
                changedFields: ["env"],
              },
            ],
            warnings: [],
          },
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/cli-config/claude/apply-provider" && method === "POST") {
      requests.applyProvider = route.request().postDataJSON();
      await route.fulfill({
        json: envelope({
          result: {
            adapter: "claude",
            backupId: "backup-1",
            changed: true,
            files: [{ targetPath: "/home/e2e/.claude/settings.json", operation: "update" }],
          },
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

    if (url.pathname === "/api/v1/model-providers/provider-profile-1/test" && method === "POST") {
      requests.endpointTest = route.request().postDataJSON();
      await route.fulfill({
        json: envelope({
          health: {
            healthy: true,
            endpoint: "https://provider-01.example.com/anthropic",
            latencyMs: 42,
            timeoutMs: 5000,
            statusCode: 200,
            checkedAt: "2026-05-29T02:00:00.000Z",
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
    // Anthropic protocol keeps the Claude apply flow direct (no Gateway route).
    apiFormat: "anthropic",
    supportedAdapters: ["claude", "opencode"],
    opencodeNpm: "@ai-sdk/openai-compatible",
    anthropicBaseUrl: "https://provider-01.example.com/anthropic",
    openaiBaseUrl: "https://provider-01.example.com/v1",
    region: "global",
    productType: "payg_api",
    status: "active",
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
