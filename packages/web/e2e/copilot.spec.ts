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
    providerProfileName: "OpenAI production",
    modelProfileName: "GPT-5 coding",
    stepCount: 3,
    maxSteps: 8,
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

  await expect(page.getByLabel("Selected Copilot run metadata")).toContainText("OpenAI production");
  await expect(page.getByLabel("Selected Copilot run metadata")).toContainText("GPT-5 coding");
  await expect(page.getByLabel("Selected Copilot run metadata")).toContainText("3/8");
  await expect(page.getByLabel("Copilot run metadata for Summarize Gateway health")).toContainText("OpenAI production");
  await expect(page.getByLabel("Copilot run metadata for Summarize Gateway health")).toContainText("GPT-5 coding");
  await expect(page.getByLabel("Copilot run metadata for Summarize Gateway health")).toContainText("3/8");
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

test("Copilot page disables start when model provider selection cannot load", async ({ page }) => {
  await mockCopilotApis(page, {
    onModelProviders: async (route) => {
      await route.fulfill({
        status: 500,
        json: { code: 1, message: "model provider list failed" },
      });
    },
    runs: [],
  });

  await page.goto("/copilot");
  await page.getByLabel("Copilot prompt").fill("Summarize release state");

  await expect(page.getByRole("alert").filter({ hasText: "Failed to load Copilot model providers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
});

test("Copilot page disables start while another run is live", async ({ page }) => {
  await mockCopilotApis(page, {
    runs: [{
      id: "run-1",
      status: "completed",
      goal: "Previous completed run",
      source: "copilot",
    }, {
      id: "run-live",
      status: "running",
      goal: "Summarize current release state",
      source: "copilot",
    }],
  });

  await page.goto("/copilot");
  await page.getByLabel("Copilot prompt").fill("Start a second run");

  await expect(page.getByText("A Copilot run is already active.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
});

test("Copilot page sends the selected provider and model when starting a run", async ({ page }) => {
  let createBody: Record<string, unknown> | undefined;
  await mockCopilotApis(page, {
    modelProviders: {
      providers: [
        {
          id: "provider-openai",
          providerKey: "openai",
          name: "OpenAI production",
          baseUrl: "https://api.openai.com/v1",
          authType: "api_key",
          apiFormat: "openai",
          supportedAdapters: ["opencode"],
          status: "active",
        },
        {
          id: "provider-anthropic",
          providerKey: "anthropic",
          name: "Anthropic production",
          baseUrl: "https://api.anthropic.com",
          authType: "api_key",
          apiFormat: "anthropic",
          supportedAdapters: ["opencode"],
          status: "active",
        },
      ],
      models: [
        {
          id: "model-gpt-5",
          providerProfileId: "provider-openai",
          providerKey: "openai",
          providerName: "OpenAI production",
          baseUrl: "https://api.openai.com/v1",
          name: "GPT-5 coding",
          modelId: "gpt-5.1",
          capabilities: ["code"],
          status: "active",
          isDefault: true,
        },
        {
          id: "model-claude-opus",
          providerProfileId: "provider-anthropic",
          providerKey: "anthropic",
          providerName: "Anthropic production",
          baseUrl: "https://api.anthropic.com",
          name: "Claude Opus",
          modelId: "claude-opus-4.5",
          capabilities: ["code"],
          status: "active",
          isDefault: true,
        },
      ],
      credentials: [
        {
          id: "credential-openai",
          providerProfileId: "provider-openai",
          label: "OpenAI test key",
          status: "active",
          secretPreview: "openai-preview",
        },
        {
          id: "credential-anthropic",
          providerProfileId: "provider-anthropic",
          label: "Anthropic test key",
          status: "active",
          secretPreview: "anthropic-preview",
        },
      ],
    },
    onCreateRun: async (route) => {
      createBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: envelope({
          run: {
            id: "run-selected-model",
            status: "completed",
            goal: "Summarize Gateway health",
            source: "copilot",
            providerProfileId: "provider-anthropic",
            providerProfileName: "Anthropic production",
            modelProfileId: "model-claude-opus",
            modelProfileName: "Claude Opus",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByLabel("Copilot provider").selectOption("provider-anthropic");
  await expect(page.getByLabel("Copilot model")).toHaveValue("model-claude-opus");
  await page.getByLabel("Copilot prompt").fill("Summarize Gateway health");
  await page.getByRole("button", { name: "Start" }).click();

  await expect.poll(() => createBody).toMatchObject({
    prompt: "Summarize Gateway health",
    source: "copilot",
    providerProfileId: "provider-anthropic",
    modelProfileId: "model-claude-opus",
  });
  await expect(page.getByLabel("Selected Copilot run metadata")).toContainText("Anthropic production");
  await expect(page.getByLabel("Selected Copilot run metadata")).toContainText("Claude Opus");
});

test("Copilot page skips providers without active credentials", async ({ page }) => {
  let createBody: Record<string, unknown> | undefined;
  await mockCopilotApis(page, {
    modelProviders: {
      providers: [
        {
          id: "provider-missing-key",
          providerKey: "openai",
          name: "OpenAI missing key",
          baseUrl: "https://api.openai.com/v1",
          authType: "api_key",
          apiFormat: "openai",
          supportedAdapters: ["opencode"],
          status: "active",
        },
        {
          id: "provider-ready",
          providerKey: "anthropic",
          name: "Anthropic ready",
          baseUrl: "https://api.anthropic.com",
          authType: "api_key",
          apiFormat: "anthropic",
          supportedAdapters: ["opencode"],
          status: "active",
        },
      ],
      models: [
        {
          id: "model-missing-key",
          providerProfileId: "provider-missing-key",
          providerKey: "openai",
          providerName: "OpenAI missing key",
          baseUrl: "https://api.openai.com/v1",
          name: "GPT without key",
          modelId: "gpt-5.1",
          capabilities: ["code"],
          status: "active",
          isDefault: true,
        },
        {
          id: "model-ready",
          providerProfileId: "provider-ready",
          providerKey: "anthropic",
          providerName: "Anthropic ready",
          baseUrl: "https://api.anthropic.com",
          name: "Claude ready",
          modelId: "claude-opus-4.5",
          capabilities: ["code"],
          status: "active",
          isDefault: true,
        },
      ],
      credentials: [{
        id: "credential-ready",
        providerProfileId: "provider-ready",
        label: "Ready key",
        status: "active",
        secretPreview: "secret-preview",
      }],
    },
    onCreateRun: async (route) => {
      createBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: envelope({
          run: {
            id: "run-ready-provider",
            status: "completed",
            goal: "Summarize Gateway health",
            source: "copilot",
            providerProfileId: "provider-ready",
            modelProfileId: "model-ready",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");

  await expect(page.getByLabel("Copilot provider")).toHaveValue("provider-ready");
  await expect(page.getByText("OpenAI missing key")).toHaveCount(0);
  await page.getByLabel("Copilot prompt").fill("Summarize Gateway health");
  await page.getByRole("button", { name: "Start" }).click();

  await expect.poll(() => createBody).toMatchObject({
    providerProfileId: "provider-ready",
    modelProfileId: "model-ready",
  });
});

test("Copilot page skips providers without active models", async ({ page }) => {
  let createBody: Record<string, unknown> | undefined;
  await mockCopilotApis(page, {
    modelProviders: {
      providers: [
        {
          id: "provider-no-models",
          providerKey: "openai",
          name: "OpenAI no active models",
          baseUrl: "https://api.openai.com/v1",
          authType: "api_key",
          apiFormat: "openai",
          supportedAdapters: ["opencode"],
          status: "active",
        },
        {
          id: "provider-ready",
          providerKey: "anthropic",
          name: "Anthropic ready",
          baseUrl: "https://api.anthropic.com",
          authType: "api_key",
          apiFormat: "anthropic",
          supportedAdapters: ["opencode"],
          status: "active",
        },
      ],
      models: [
        {
          id: "model-disabled",
          providerProfileId: "provider-no-models",
          providerKey: "openai",
          providerName: "OpenAI no active models",
          baseUrl: "https://api.openai.com/v1",
          name: "Disabled GPT",
          modelId: "gpt-5.1",
          capabilities: ["code"],
          status: "disabled",
          isDefault: true,
        },
        {
          id: "model-ready",
          providerProfileId: "provider-ready",
          providerKey: "anthropic",
          providerName: "Anthropic ready",
          baseUrl: "https://api.anthropic.com",
          name: "Claude ready",
          modelId: "claude-opus-4.5",
          capabilities: ["code"],
          status: "active",
          isDefault: true,
        },
      ],
      credentials: [
        {
          id: "credential-no-models",
          providerProfileId: "provider-no-models",
          label: "Configured key",
          status: "active",
          secretPreview: "secret-preview",
        },
        {
          id: "credential-ready",
          providerProfileId: "provider-ready",
          label: "Ready key",
          status: "active",
          secretPreview: "secret-preview",
        },
      ],
    },
    onCreateRun: async (route) => {
      createBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: envelope({
          run: {
            id: "run-ready-provider",
            status: "completed",
            goal: "Summarize Gateway health",
            source: "copilot",
            providerProfileId: "provider-ready",
            modelProfileId: "model-ready",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");

  await expect(page.getByLabel("Copilot provider")).toHaveValue("provider-ready");
  await expect(page.getByText("OpenAI no active models")).toHaveCount(0);
  await page.getByLabel("Copilot prompt").fill("Summarize Gateway health");
  await page.getByRole("button", { name: "Start" }).click();

  await expect.poll(() => createBody).toMatchObject({
    providerProfileId: "provider-ready",
    modelProfileId: "model-ready",
  });
});

test("Copilot page links to provider setup when no providers have active credentials", async ({ page }) => {
  await mockCopilotApis(page, {
    providerConfigured: true,
    runs: [],
    modelProviders: {
      providers: [
        {
          id: "provider-missing-key",
          providerKey: "openai",
          name: "OpenAI missing key",
          baseUrl: "https://api.openai.com/v1",
          authType: "api_key",
          apiFormat: "openai",
          supportedAdapters: ["opencode"],
          status: "active",
        },
      ],
      models: [
        {
          id: "model-missing-key",
          providerProfileId: "provider-missing-key",
          providerKey: "openai",
          providerName: "OpenAI missing key",
          baseUrl: "https://api.openai.com/v1",
          name: "GPT without key",
          modelId: "gpt-5.1",
          capabilities: ["code"],
          status: "active",
          isDefault: true,
        },
      ],
      credentials: [],
    },
  });

  await page.goto("/copilot");
  await page.getByLabel("Copilot prompt").fill("Summarize Gateway health");

  await expect(page.getByRole("link", { name: "Configure provider" })).toHaveAttribute("href", "/models");
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
});

test("Copilot page starts runs with launch context from the URL", async ({ page }) => {
  let createBody: Record<string, unknown> | undefined;
  await mockCopilotApis(page, {
    onCreateRun: async (route) => {
      createBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: envelope({
          run: {
            id: "run-project-context",
            status: "completed",
            goal: "Project readiness",
            source: "project",
            sourceRefId: "project-1",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot?source=project&sourceRefId=project-1&intent=project_readiness");

  await expect(page.getByLabel("Copilot prompt")).toHaveValue(/project's runtime readiness/i);
  await page.getByRole("button", { name: "Start" }).click();
  await expect.poll(() => createBody).toMatchObject({
    source: "project",
    sourceRefId: "project-1",
    providerProfileId: "provider-openai",
    modelProfileId: "model-gpt-5",
  });
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
  const approvedAction = { ...pendingAction, status: "approved", result: { entry: { id: "memory-entry-1" } } };
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
  await expect(page.getByText("memory-entry-1")).toBeVisible();
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

test("Copilot page can cancel runs waiting for approval", async ({ page }) => {
  let cancelRequests = 0;
  const pendingAction = {
    id: "action-1",
    runId: "run-approval",
    type: "openforge.propose_troubleshooting_steps",
    status: "pending",
    input: { steps: ["Check provider setup"] },
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
    onCancel: async (route) => {
      cancelRequests += 1;
      currentRunDetail = {
        run: {
          ...currentRunDetail.run,
          status: "cancelled",
          completedAt: 1778490000000,
        },
        events: currentRunDetail.events,
        pendingActions: [{ ...pendingAction, status: "rejected", result: { reason: "run_cancelled" } }],
      };
      await route.fulfill({ json: envelope(currentRunDetail) });
    },
  });

  await page.goto("/copilot");
  await page.getByRole("button", { name: "Stop" }).click();

  await expect.poll(() => cancelRequests).toBe(1);
  await expect(page.getByText("cancelled").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
});

async function mockCopilotApis(
  page: Page,
  overrides: {
    onRuns?: (route: Route) => Promise<void>;
    onRunDetail?: (route: Route) => Promise<void>;
    onApprove?: (route: Route) => Promise<void>;
    onReject?: (route: Route) => Promise<void>;
    onCancel?: (route: Route) => Promise<void>;
    onCreateRun?: (route: Route) => Promise<void>;
    onModelProviders?: (route: Route) => Promise<void>;
    providerConfigured?: boolean;
    runs?: Array<Record<string, unknown>>;
    modelProviders?: {
      providers: Array<Record<string, unknown>>;
      models: Array<Record<string, unknown>>;
      credentials: Array<Record<string, unknown>>;
    };
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

    if (url.pathname === "/api/v1/model-providers") {
      if (overrides.onModelProviders) {
        await overrides.onModelProviders(route);
        return;
      }
      await route.fulfill({
        json: envelope(overrides.modelProviders ?? {
          providers: [{
            id: "provider-openai",
            providerKey: "openai",
            name: "OpenAI production",
            baseUrl: "https://api.openai.com/v1",
            authType: "api_key",
            apiFormat: "openai",
            supportedAdapters: ["opencode"],
            status: "active",
          }],
          models: [{
            id: "model-gpt-5",
            providerProfileId: "provider-openai",
            providerKey: "openai",
            providerName: "OpenAI production",
            baseUrl: "https://api.openai.com/v1",
            name: "GPT-5 coding",
            modelId: "gpt-5.1",
            capabilities: ["code"],
            status: "active",
            isDefault: true,
          }],
          credentials: [{
            id: "credential-openai",
            providerProfileId: "provider-openai",
            label: "OpenAI test key",
            status: "active",
            secretPreview: "openai-preview",
          }],
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

    if (url.pathname === "/api/v1/copilot/runs/run-approval/cancel") {
      if (overrides.onCancel) {
        await overrides.onCancel(route);
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
