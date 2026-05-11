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

test("Copilot page disables start when no provider is configured", async ({ page }) => {
  await mockCopilotApis(page, {
    providerConfigured: false,
    runs: [],
  });

  await page.goto("/copilot");
  await page.getByLabel("Copilot prompt").fill("Summarize release state");

  await expect(page.getByText("Configure an OpenAI or Anthropic model provider first.").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Configure provider" })).toHaveAttribute("href", "/models");
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
});

test("Copilot starter prompts fill the prompt without starting a run", async ({ page }) => {
  let createRequests = 0;
  await mockCopilotApis(page, {
    onCreateRun: async (route) => {
      createRequests += 1;
      await route.fulfill({ json: envelope({}) });
    },
  });

  await page.goto("/copilot");
  await page.getByRole("button", { name: "Diagnose launch readiness" }).click();

  await expect(page.getByLabel("Copilot prompt")).toHaveValue(/session launch readiness/i);
  await expect.poll(() => createRequests).toBe(0);
});

test("Copilot page prevents duplicate pending-action submissions", async ({ page }) => {
  let approveRequests = 0;
  await mockCopilotApis(page, {
    runs: [{
      id: "run-approval",
      status: "waiting_for_approval",
      goal: "Remember release decision",
      source: "copilot",
    }],
    runDetail: {
      run: {
        id: "run-approval",
        status: "waiting_for_approval",
        goal: "Remember release decision",
        source: "copilot",
      },
      events: [],
      pendingActions: [{
        id: "action-1",
        runId: "run-approval",
        type: "openforge.propose_memory_write",
        status: "pending",
        input: { kind: "decision", scope: "global", text: "Remember release gates." },
      }],
    },
    onApprove: async (route) => {
      approveRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        json: envelope({
          action: {
            id: "action-1",
            runId: "run-approval",
            type: "openforge.propose_memory_write",
            status: "approved",
            input: { kind: "decision", scope: "global", text: "Remember release gates." },
          },
        }),
      });
    },
  });

  await page.goto("/copilot");
  const approve = page.getByRole("button", { name: "Approve" });
  await expect(approve).toBeVisible();

  await approve.dblclick();

  await expect.poll(() => approveRequests).toBe(1);
});

async function mockCopilotApis(
  page: Page,
  overrides: {
    onRuns?: (route: Route) => Promise<void>;
    onRunDetail?: (route: Route) => Promise<void>;
    onApprove?: (route: Route) => Promise<void>;
    onCreateRun?: (route: Route) => Promise<void>;
    providerConfigured?: boolean;
    runs?: Array<Record<string, unknown>>;
    runDetail?: {
      run: Record<string, unknown>;
      events: Array<Record<string, unknown>>;
      pendingActions: Array<Record<string, unknown>>;
    };
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
          providerConfigured: overrides.providerConfigured ?? true,
          toolExecutionEnabled: true,
          readTools: ["openforge.get_dashboard_summary"],
          approvalRequiredForWrites: true,
          pendingActionApprovalEnabled: true,
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/copilot/runs" && route.request().method() === "POST") {
      if (overrides.onCreateRun) {
        await overrides.onCreateRun(route);
        return;
      }
      await route.fulfill({ json: envelope({}) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/runs") {
      if (overrides.onRuns) {
        await overrides.onRuns(route);
        return;
      }
      await route.fulfill({
        json: envelope({
          runs: overrides.runs ?? [{
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

    if (url.pathname === "/api/v1/copilot/runs/run-approval") {
      await route.fulfill({
        json: envelope(overrides.runDetail ?? {
          run: {
            id: "run-approval",
            status: "waiting_for_approval",
            goal: "Remember release decision",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/copilot/runs/run-approval/pending-actions/action-1/approve") {
      if (overrides.onApprove) {
        await overrides.onApprove(route);
        return;
      }
      await route.fulfill({ json: envelope({}) });
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
