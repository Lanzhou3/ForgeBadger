import { expect, test, type Page, type Route } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openforge-language", "en");
    window.localStorage.setItem("openforge.token", "e2e-token");
    window.localStorage.setItem("openforge.user", JSON.stringify({
      id: "user-e2e",
      email: "copilot-e2e@example.com",
      role: "admin",
      status: "active",
    }));
  });
});

test("Copilot page surfaces run-list errors and keeps prompt accessible", async ({ page }) => {
  let allowRunListSuccess = false;
  await mockCopilotApis(page, {
    onRuns: async (route) => {
      if (!allowRunListSuccess) {
        await route.fulfill({
          status: 500,
          json: { code: 1, message: "run list failed" },
        });
        return;
      }
      await route.fulfill({ json: envelope({ runs: [] }) });
    },
  });

  await page.goto("/copilot");

  await expect(page.getByLabel("Copilot prompt")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Failed to load Copilot runs" })).toBeVisible();
  await expect(page.getByText("No Copilot runs yet")).toHaveCount(0);

  allowRunListSuccess = true;
  await page.getByRole("button", { name: "Retry" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Failed to load Copilot runs" })).toHaveCount(0);
  await expect(page.getByText("No Copilot runs yet").first()).toBeVisible();
});

test("Copilot page surfaces selected run detail errors", async ({ page }) => {
  await mockCopilotApis(page, {
    onRunDetail: async (route) => {
      await route.fulfill({
        status: 500,
        json: { code: 1, message: "run detail failed" },
      });
    },
  });

  await page.goto("/copilot");

  await expect(page.getByRole("alert").filter({ hasText: "Failed to load Copilot run details" })).toBeVisible();
  await expect(page.getByText("No timeline events yet.")).toHaveCount(0);
});

async function mockCopilotApis(
  page: Page,
  overrides: {
    onRuns?: (route: Route) => Promise<void>;
    onRunDetail?: (route: Route) => Promise<void>;
  } = {}
) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/api/v1/auth/me") {
      await route.fulfill({
        json: envelope({
          id: "user-e2e",
          email: "copilot-e2e@example.com",
          role: "admin",
          status: "active",
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/copilot/capabilities") {
      await route.fulfill({
        json: envelope({
          supportedProviderFormats: ["openai", "anthropic"],
          toolExecutionEnabled: true,
          readTools: ["openforge.get_dashboard_summary"],
          approvalRequiredForWrites: true,
          pendingActionApprovalEnabled: true,
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/copilot/runs") {
      if (overrides.onRuns) {
        await overrides.onRuns(route);
        return;
      }
      await route.fulfill({
        json: envelope({
          runs: [{
            id: "run-1",
            status: "completed",
            goal: "Summarize Gateway health",
            source: "copilot",
            completedAt: 1778490000000,
          }],
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/copilot/runs/run-1") {
      if (overrides.onRunDetail) {
        await overrides.onRunDetail(route);
        return;
      }
      await route.fulfill({
        json: envelope({
          run: {
            id: "run-1",
            status: "completed",
            goal: "Summarize Gateway health",
            source: "copilot",
            completedAt: 1778490000000,
          },
          events: [],
          pendingActions: [],
        }),
      });
      return;
    }

    await route.fulfill({ json: envelope({}) });
  });
}

function envelope(data: unknown) {
  return { code: 0, data, message: "" };
}
