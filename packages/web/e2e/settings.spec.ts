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

test("Settings shows read-only Feishu integration status", async ({ page }) => {
  await mockSettingsApis(page);

  await page.goto("/settings");

  await expect(page.getByText("Feishu Integration").first()).toBeVisible();
  await expect(page.getByText("CLI available")).toBeVisible();
  await expect(page.getByText("lark-cli 1.2.3")).toBeVisible();
  await expect(page.getByText("Authenticated")).toBeVisible();
  await expect(page.getByText("User")).toBeVisible();
  await expect(page.getByText("Disabled").first()).toBeVisible();
  await expect(page.getByText("Phase 1 is read-only diagnostics; remote control is not enabled yet.")).toBeVisible();
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

    if (url.pathname === "/api/v1/copilot/capabilities") {
      await route.fulfill({
        json: envelope({
          supportedProviderFormats: ["openai", "anthropic"],
          providerConfigured: true,
          toolExecutionEnabled: true,
          approvalRequiredForWrites: true,
          pendingActionApprovalEnabled: true,
        }),
      });
      return;
    }

    await route.fulfill({ json: envelope({}) });
  });
}

function envelope(data: Record<string, unknown>) {
  return { code: 0, data, message: "" };
}
