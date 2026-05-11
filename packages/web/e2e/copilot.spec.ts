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

test("Copilot page shows failed run error details without timeline events", async ({ page }) => {
  const failedRun = {
    id: "run-1",
    status: "failed",
    goal: "Summarize Gateway health",
    source: "copilot",
    errorCode: "copilot_model_request_failed",
    errorMessage: "Copilot model request failed",
    completedAt: 1778490000000,
  };
  await mockCopilotApis(page, {
    runs: [failedRun],
    runDetail: {
      run: failedRun,
      events: [],
      pendingActions: [],
    },
  });

  await page.goto("/copilot");

  await expect(page.getByRole("alert").filter({ hasText: "Copilot run failed" })).toBeVisible();
  await expect(page.getByText("copilot_model_request_failed")).toBeVisible();
  await expect(page.getByText("Copilot model request failed")).toBeVisible();
});

test("Copilot page shows provider and model metadata for selected runs", async ({ page }) => {
  const run = {
    id: "run-1",
    status: "completed",
    goal: "Summarize Gateway health",
    source: "copilot",
    providerProfileId: "provider-openai",
    modelProfileId: "model-gpt-5",
    completedAt: 1778490000000,
  };
  await mockCopilotApis(page, {
    runs: [run],
    runDetail: {
      run,
      events: [],
      pendingActions: [],
    },
  });

  await page.goto("/copilot");

  await expect(page.getByLabel("Selected Copilot run metadata")).toContainText("provider-openai");
  await expect(page.getByLabel("Selected Copilot run metadata")).toContainText("model-gpt-5");
  await expect(page.getByLabel("Copilot run metadata for Summarize Gateway health")).toContainText("provider-openai");
  await expect(page.getByLabel("Copilot run metadata for Summarize Gateway health")).toContainText("model-gpt-5");
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

test("Copilot page shows structured provider setup errors from run creation", async ({ page }) => {
  await mockCopilotApis(page, {
    onCreateRun: async (route) => {
      await route.fulfill({
        status: 400,
        json: {
          code: 1,
          message: "Configure an OpenAI or Anthropic model provider first.",
          details: { code: "copilot_provider_not_configured" },
        },
      });
    },
  });

  await page.goto("/copilot");
  await page.getByLabel("Copilot prompt").fill("Summarize release state");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "copilot_provider_not_configured" })).toBeVisible();
  await expect(page.getByText("Configure an OpenAI or Anthropic model provider first.").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Configure provider" })).toHaveAttribute("href", "/models");
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

test("Copilot page shows tool result payload details", async ({ page }) => {
  await mockCopilotApis(page, {
    runDetail: {
      run: {
        id: "run-1",
        status: "completed",
        goal: "Summarize Gateway health",
        source: "copilot",
        completedAt: 1778490000000,
      },
      events: [{
        id: "event-tool-result",
        runId: "run-1",
        type: "tool_result",
        sequence: 1,
        message: "openforge.get_dashboard_summary",
        payload: {
          output: {
            status: "ready",
            projectCount: 2,
          },
        },
      }],
      pendingActions: [],
    },
  });

  await page.goto("/copilot");

  await expect(page.getByText("Tool result")).toBeVisible();
  await expect(page.getByText("projectCount")).toBeVisible();
  await expect(page.getByText("ready")).toBeVisible();
});

test("Copilot page prevents duplicate pending-action submissions", async ({ page }) => {
  let approveRequests = 0;
  const pendingAction = {
    id: "action-1",
    runId: "run-approval",
    type: "openforge.propose_memory_write",
    status: "pending",
    input: { kind: "decision", scope: "global", text: "Remember release gates." },
  };
  const approvedAction = { ...pendingAction, status: "approved" };
  const completedRunDetail = {
    run: {
      id: "run-approval",
      status: "completed",
      goal: "Remember release decision",
      source: "copilot",
    },
    events: [{
      id: "event-approved",
      runId: "run-approval",
      type: "pending_action_approved",
      sequence: 1,
      message: "openforge.propose_memory_write",
    }],
    pendingActions: [approvedAction],
  };
  let currentRunDetail = {
    run: {
      id: "run-approval",
      status: "waiting_for_approval",
      goal: "Remember release decision",
      source: "copilot",
    },
    events: [],
    pendingActions: [pendingAction],
  };
  await mockCopilotApis(page, {
    runs: [{
      id: "run-approval",
      status: "waiting_for_approval",
      goal: "Remember release decision",
      source: "copilot",
    }],
    onRunDetail: async (route) => {
      await route.fulfill({ json: envelope(currentRunDetail) });
    },
    onApprove: async (route) => {
      approveRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      currentRunDetail = completedRunDetail;
      await route.fulfill({
        json: envelope({
          action: approvedAction,
          ...completedRunDetail,
        }),
      });
    },
  });

  await page.goto("/copilot");
  const approve = page.getByRole("button", { name: "Approve" });
  await expect(approve).toBeVisible();
  const actionSummary = page.getByText("decision / global").locator("xpath=..");
  await expect(actionSummary).toBeVisible();
  await expect(actionSummary.getByText("Remember release gates.", { exact: true })).toBeVisible();

  await approve.dblclick();

  await expect.poll(() => approveRequests).toBe(1);
  await expect(page.getByText("completed").first()).toBeVisible();
  await expect(page.getByText("Action approved")).toBeVisible();
});

test("Copilot page reflects rejected pending actions immediately", async ({ page }) => {
  const pendingAction = {
    id: "action-1",
    runId: "run-approval",
    type: "openforge.propose_troubleshooting_steps",
    status: "pending",
    input: { steps: ["Check provider setup"] },
  };
  const rejectedAction = { ...pendingAction, status: "rejected" };
  const completedRunDetail = {
    run: {
      id: "run-approval",
      status: "completed",
      goal: "Prepare troubleshooting",
      source: "copilot",
    },
    events: [{
      id: "event-rejected",
      runId: "run-approval",
      type: "pending_action_rejected",
      sequence: 1,
      message: "openforge.propose_troubleshooting_steps",
    }],
    pendingActions: [rejectedAction],
  };
  let currentRunDetail = {
    run: {
      id: "run-approval",
      status: "waiting_for_approval",
      goal: "Prepare troubleshooting",
      source: "copilot",
    },
    events: [],
    pendingActions: [pendingAction],
  };
  await mockCopilotApis(page, {
    runs: [{
      id: "run-approval",
      status: "waiting_for_approval",
      goal: "Prepare troubleshooting",
      source: "copilot",
    }],
    onRunDetail: async (route) => {
      await route.fulfill({ json: envelope(currentRunDetail) });
    },
    onReject: async (route) => {
      currentRunDetail = completedRunDetail;
      await route.fulfill({
        json: envelope({
          action: rejectedAction,
          ...completedRunDetail,
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByRole("button", { name: "Reject" }).click();

  await expect(page.getByText("completed").first()).toBeVisible();
  await expect(page.getByText("Action rejected")).toBeVisible();
});

async function mockCopilotApis(
  page: Page,
  overrides: {
    onRuns?: (route: Route) => Promise<void>;
    onRunDetail?: (route: Route) => Promise<void>;
    onApprove?: (route: Route) => Promise<void>;
    onReject?: (route: Route) => Promise<void>;
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
      if (overrides.onRunDetail) {
        await overrides.onRunDetail(route);
        return;
      }
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

    if (url.pathname === "/api/v1/copilot/runs/run-approval/pending-actions/action-1/reject") {
      if (overrides.onReject) {
        await overrides.onReject(route);
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
        json: envelope(overrides.runDetail ?? {
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
