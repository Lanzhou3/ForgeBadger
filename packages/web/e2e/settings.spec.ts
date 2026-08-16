import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openforge-language", "en");
    window.localStorage.setItem("openforge.token", "e2e-token");
    window.localStorage.setItem("openforge.user", JSON.stringify({
      id: "user-e2e",
      email: "settings-e2e@example.com",
      role: "admin",
      status: "active",
    }));
  });
});

test("Settings allows entering and saving Feishu bot credentials", async ({ page }) => {
  await mockSettingsApis(page);

  await page.goto("/settings");

  await expect(page.getByText("Feishu Integration").first()).toBeVisible();
  const appId = page.getByLabel("App ID");
  const appSecret = page.getByLabel("App Secret");
  await expect(appId).toBeEditable();
  await expect(appSecret).toBeEditable();
  await appId.fill("cli_test_app");
  await appSecret.fill("test-secret");
  await page.getByRole("button", { name: "Save Feishu configuration" }).click();
  await expect(page.getByText("Feishu configuration saved")).toBeVisible();
});

async function mockSettingsApis(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/api/v1/auth/me") {
      await route.fulfill({
        json: envelope({
          id: "user-e2e",
          email: "settings-e2e@example.com",
          role: "admin",
          status: "active",
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/notifications") {
      await route.fulfill({ json: envelope({ notifications: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/adapters/discovery") {
      await route.fulfill({ json: envelope({ adapters: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/audit-logs") {
      await route.fulfill({ json: envelope({ auditLogs: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/integrations/feishu/status") {
      await route.fulfill({
        json: envelope({
          status: {
            available: true,
            version: "lark-cli 1.2.3",
            authState: "authenticated",
            identityMode: "user",
            enabled: false,
          },
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/integrations/feishu/account") {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          json: envelope({
            account: {
              appId: "cli_test_app",
              enabled: false,
              secretConfigured: true,
            },
          }),
        });
        return;
      }
      await route.fulfill({ json: envelope({ account: null }) });
      return;
    }

    if (url.pathname === "/api/v1/integrations/feishu/config") {
      await route.fulfill({
        json: envelope({
          config: {
            enabled: false,
            emergencyDisabled: false,
            identityMode: "bot",
            allowedChatIds: [],
            commandPrefix: "/openforge",
          },
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/integrations/feishu/user-mappings") {
      await route.fulfill({ json: envelope({ mappings: [] }) });
      return;
    }

    await route.fulfill({ json: envelope({}) });
  });
}

function envelope(data: Record<string, unknown>) {
  return { code: 0, data, message: "" };
}
