import { expect, test, type Page } from "@playwright/test";

const CONVERSATION_ID = "conv-e2e-1";

const dshConfig = {
  defaultModelId: "model-1",
  plugins: { "forgebadger-bridge": true, "mcp-client": false },
  availablePlugins: [
    { id: "forgebadger-bridge", label: "ForgeBadger Bridge", description: "Platform tools" },
    { id: "mcp-client", label: "MCP Client", description: "External tool access" },
  ],
  runtime: { status: "running" },
};

async function mockCopilotConsoleApis(
  page: Page,
  options: {
    dshConfigStatus?: number;
    onDshConfigUpdate?: (body: unknown) => void;
    onDecide?: (body: unknown) => void;
  } = {}
) {
  const unhandledApiRoutes: string[] = [];
  const conversations = [
    {
      id: CONVERSATION_ID,
      title: "Release planning",
      status: "active",
      created_at: 1779370000000,
      updated_at: 1779373600000,
    },
  ];

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/api/v1/auth/me" && method === "GET") {
      await route.fulfill({
        json: envelope({
          id: "user-e2e",
          email: "copilot-console-e2e@example.com",
          role: "admin",
          status: "active",
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/notifications" && method === "GET") {
      await route.fulfill({ json: envelope({ notifications: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/conversations" && method === "GET") {
      await route.fulfill({ json: envelope({ conversations }) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/conversations" && method === "POST") {
      const created = {
        id: "conv-robot-1",
        title: null,
        status: "active",
        created_at: 1779380000000,
        updated_at: 1779380000000,
      };
      conversations.push(created);
      await route.fulfill({ json: envelope({ conversation: created }) });
      return;
    }

    const conversationMatch = url.pathname.match(/^\/api\/v1\/copilot\/conversations\/([^/]+)$/u);
    if (conversationMatch && method === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}") as { title?: string };
      const target = conversations.find((item) => item.id === conversationMatch[1]);
      if (target && body.title) target.title = body.title;
      await route.fulfill({ json: envelope({ conversation: target ?? null }) });
      return;
    }

    const messagesMatch = url.pathname.match(/^\/api\/v1\/copilot\/conversations\/([^/]+)\/messages$/u);
    if (messagesMatch && method === "POST") {
      await route.fulfill({ json: envelope({ runId: "run-robot-1" }) });
      return;
    }

    if (messagesMatch && method === "GET" && messagesMatch[1] === "conv-robot-1") {
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "msg-robot-1",
              conversationId: "conv-robot-1",
              userId: "user-e2e",
              role: "user",
              kind: "text",
              content: "Panel hello",
              sequence: 1,
              createdAt: "2026-05-22T00:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === `/api/v1/copilot/conversations/${CONVERSATION_ID}/messages` && method === "GET") {
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "msg-e2e-1",
              conversationId: CONVERSATION_ID,
              userId: "user-e2e",
              role: "user",
              kind: "text",
              content: "How is the release doing?",
              sequence: 1,
              createdAt: "2026-05-21T00:00:00.000Z",
            },
            {
              id: "msg-e2e-2",
              conversationId: CONVERSATION_ID,
              userId: "user-e2e",
              role: "assistant",
              kind: "text",
              content: "All milestones are on track.",
              sequence: 2,
              createdAt: "2026-05-21T00:00:10.000Z",
            },
          ],
        }),
      });
      return;
    }

    const runMatch = url.pathname.match(/^\/api\/v1\/copilot\/runs\/([^/]+)$/u);
    if (runMatch && method === "GET") {
      await route.fulfill({
        json: envelope({
          run: {
            id: runMatch[1],
            conversationId: "conv-robot-1",
            userId: "user-e2e",
            status: "running",
            steps: 1,
            createdAt: "2026-05-22T00:00:00.000Z",
            updatedAt: "2026-05-22T00:00:10.000Z",
          },
          pendingActions: [],
        }),
      });
      return;
    }

    const decideMatch = url.pathname.match(/^\/api\/v1\/copilot\/runs\/([^/]+)\/pending-actions\/([^/]+)\/decide$/u);
    if (decideMatch && method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as unknown;
      options.onDecide?.(body);
      await route.fulfill({ json: envelope({ resumed: true, runId: decideMatch[1] }) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/dsh-config" && method === "GET") {      if (options.dshConfigStatus === 404) {
        await route.fulfill({
          status: 404,
          json: { code: 1, message: "dsh copilot is not enabled" },
        });
        return;
      }
      await route.fulfill({ json: envelope(dshConfig) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/dsh-config" && method === "PUT") {
      const body = JSON.parse(route.request().postData() ?? "{}") as unknown;
      options.onDshConfigUpdate?.(body);
      await route.fulfill({ json: envelope(dshConfig) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/capabilities" && method === "GET") {
      await route.fulfill({
        json: envelope({
          tools: [
            {
              name: "list_projects",
              description: "List the current user's projects",
              risk: "read",
              requiresApproval: false,
            },
            {
              name: "run_terminal",
              description: "Run a terminal command",
              risk: "operate",
              requiresApproval: true,
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/model-providers" && method === "GET") {
      await route.fulfill({
        json: envelope({
          providers: [],
          credentials: [],
          models: [
            {
              id: "model-1",
              providerProfileId: "provider-1",
              providerKey: "deepseek",
              providerName: "DeepSeek",
              baseUrl: null,
              name: "deepseek-chat",
              modelId: "deepseek-chat",
              capabilities: [],
              status: "active",
              isDefault: true,
            },
          ],
        }),
      });
      return;
    }

    const unhandledRoute = `${method} ${url.pathname}${url.search}`;
    unhandledApiRoutes.push(unhandledRoute);
    await route.fulfill({
      status: 404,
      json: { code: 1, message: `Unhandled mocked API route: ${unhandledRoute}` },
    });
  });

  return unhandledApiRoutes;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("forgebadger-language", "en");
    window.localStorage.setItem("forgebadger.token", "e2e-token");
    window.localStorage.setItem("forgebadger.user", JSON.stringify({
      id: "user-e2e",
      email: "copilot-console-e2e@example.com",
      role: "admin",
      status: "active",
    }));
  });
});

test("renders the three-column dsh console layout", async ({ page }) => {
  const unhandledApiRoutes = await mockCopilotConsoleApis(page);

  await page.goto("/copilot");

  // Left: conversation list.
  await expect(page.getByPlaceholder("Search conversations…")).toBeVisible();
  await expect(page.getByText("Release planning").first()).toBeVisible();
  // Center: message stream + kernel status bar.
  await expect(page.getByText("How is the release doing?")).toBeVisible();
  await expect(page.getByText("All milestones are on track.")).toBeVisible();
  const statusBar = page.getByTestId("copilot-status-bar");
  await expect(statusBar).toBeVisible();
  await expect(statusBar.getByText("Model", { exact: true })).toBeVisible();
  await expect(statusBar.getByText("DeepSeek / deepseek-chat")).toBeVisible();
  await expect(statusBar.getByText("Running")).toBeVisible();
  // Right: kernel panel with model select, plugin switches, and tool chips.
  const panel = page.getByTestId("copilot-kernel-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("dsh kernel")).toBeVisible();
  await expect(panel.getByText("ForgeBadger Bridge")).toBeVisible();
  await expect(panel.getByRole("button", { name: /list_projects/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /run_terminal/ })).toBeVisible();
  // Tool chip expands to show the description.
  await panel.getByRole("button", { name: /run_terminal/ }).click();
  await expect(panel.getByText("Run a terminal command")).toBeVisible();

  expect(unhandledApiRoutes).toEqual([]);
});

test("collapses the kernel panel and persists the choice across reloads", async ({ page }) => {
  await mockCopilotConsoleApis(page);

  await page.goto("/copilot");
  await expect(page.getByTestId("copilot-kernel-panel")).toBeVisible();

  await page.getByRole("button", { name: "Toggle kernel panel" }).click();
  await expect(page.getByTestId("copilot-kernel-panel")).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("forgebadger.copilot.kernel-panel")))
    .toBe("0");

  await page.reload();
  await expect(page.getByText("How is the release doing?")).toBeVisible();
  await expect(page.getByTestId("copilot-kernel-panel")).toBeHidden();
});

test("persists plugin toggles through the dsh-config PUT", async ({ page }) => {
  const updates: unknown[] = [];
  await mockCopilotConsoleApis(page, { onDshConfigUpdate: (body) => updates.push(body) });

  await page.goto("/copilot");
  const panel = page.getByTestId("copilot-kernel-panel");
  await expect(panel.getByRole("switch", { name: "MCP Client" })).toBeVisible();

  await panel.getByRole("switch", { name: "MCP Client" }).click();

  await expect.poll(() => updates.length).toBe(1);
  expect(updates[0]).toEqual({
    plugins: { "forgebadger-bridge": true, "mcp-client": true },
  });
});

test("degrades gracefully when the dsh kernel flag is off", async ({ page }) => {
  await mockCopilotConsoleApis(page, { dshConfigStatus: 404 });

  await page.goto("/copilot");

  // The chat stream keeps working; the panel shows the not-enabled placeholder.
  await expect(page.getByText("How is the release doing?")).toBeVisible();
  await expect(page.getByTestId("copilot-status-bar")).toBeHidden();
  const panel = page.getByTestId("copilot-kernel-panel");
  await expect(panel.getByText("The dsh kernel is not enabled")).toBeVisible();
  await expect(panel.getByRole("button", { name: /list_projects/ })).toBeVisible();
});

test("opens the kernel panel as a sheet on small screens", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockCopilotConsoleApis(page);

  await page.goto("/copilot");
  await expect(page.getByText("How is the release doing?")).toBeVisible();
  await expect(page.getByTestId("copilot-kernel-panel")).toBeHidden();

  await page.getByRole("button", { name: "Kernel", exact: true }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("dsh kernel")).toBeVisible();
  await expect(sheet.getByRole("switch", { name: "ForgeBadger Bridge" })).toBeVisible();
});

test("opens the robot chat panel and renders a streamed reply", async ({ page }) => {
  await mockCopilotConsoleApis(page);

  await page.goto("/copilot");
  await expect(page.getByText("How is the release doing?")).toBeVisible();

  // Clicking the pixel robot toggles the floating chat panel (no navigation).
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  const panel = page.getByTestId("robot-chat-panel");
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\/copilot$/u);

  // First message lazily creates the conversation, then runs the turn.
  await panel.getByPlaceholder("Type a message…").fill("Panel hello");
  await panel.getByPlaceholder("Type a message…").press("Enter");
  await expect(panel.getByText("Panel hello")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("forgebadger.copilot.robot-conversation")))
    .toBe("conv-robot-1");

  // Optimistic pending state: the pulsing indicator shows before the first
  // streamed token arrives (no dead air during the dsh cold-start).
  await expect(panel.getByText("Copilot is thinking…")).toBeVisible();

  // Streamed tokens arrive over the shared gateway event bus.
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("forgebadger:gateway-event", {
        detail: {
          type: "copilot_run_updated",
          payload: { run_id: "run-robot-1", status: "running", text_delta: "Streamed robot reply" },
        },
      })
    );
  });
  await expect(panel.getByText("Streamed robot reply")).toBeVisible();
  // The indicator yields to the streaming text.
  await expect(panel.getByText("Copilot is thinking…")).toBeHidden();

  // Clicking the robot again collapses the panel.
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  await expect(page.getByTestId("robot-chat-panel")).toHaveCount(0);
});

test("expands the robot conversation into the full console with ?c=", async ({ page }) => {
  await mockCopilotConsoleApis(page);

  await page.goto("/copilot");
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  const panel = page.getByTestId("robot-chat-panel");
  await panel.getByPlaceholder("Type a message…").fill("Panel hello");
  await panel.getByPlaceholder("Type a message…").press("Enter");
  await expect(panel.getByText("Panel hello")).toBeVisible();

  await panel.getByRole("button", { name: "Open in full console" }).click();

  // The panel closes and the console preselects the robot conversation: its
  // title lands in the sidebar/header and its messages in the stream.
  await expect(page).toHaveURL(/\/copilot\?c=conv-robot-1/u);
  await expect(page.getByTestId("robot-chat-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Panel hello/u })).toBeVisible();
  await expect(page.locator("div.bg-brand", { hasText: "Panel hello" })).toBeVisible();
});

test("folds inline think blocks and handles approvals in the robot panel", async ({ page }) => {
  const decisions: unknown[] = [];
  await mockCopilotConsoleApis(page, { onDecide: (body) => decisions.push(body) });

  await page.goto("/copilot");
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  const panel = page.getByTestId("robot-chat-panel");
  await panel.getByPlaceholder("Type a message…").fill("run the build");
  await panel.getByPlaceholder("Type a message…").press("Enter");
  await expect(panel.getByText("run the build")).toBeVisible();

  // MiniMax-style inline reasoning: the body shows the answer, the reasoning
  // stays folded in the dim strip — raw <think> markup never leaks.
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("forgebadger:gateway-event", {
        detail: {
          type: "copilot_run_updated",
          payload: {
            run_id: "run-robot-1",
            status: "running",
            text_delta: "<think>secret reasoning</think>Visible answer",
          },
        },
      })
    );
  });
  await expect(panel.getByText("Visible answer")).toBeVisible();
  await expect(panel.getByText("secret reasoning")).toBeHidden();
  await expect(panel.getByText(/<think>/u)).toHaveCount(0);
  await panel.getByRole("button", { name: /Reasoning/u }).click();
  await expect(panel.getByText("secret reasoning")).toBeVisible();

  // Pending action: the approval card decides through the decide endpoint.
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("forgebadger:gateway-event", {
        detail: {
          type: "copilot_run_updated",
          payload: {
            run_id: "run-robot-1",
            status: "awaiting_approval",
            pending_action_id: "act-1",
            tool_name: "run_terminal",
          },
        },
      })
    );
  });
  await expect(panel.getByText("Approval required")).toBeVisible();
  await expect(panel.getByText("run_terminal")).toBeVisible();
  await panel.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => decisions.length).toBe(1);
  expect(decisions[0]).toEqual({ approved: true });
});

function envelope(data: unknown) {
  return { code: 0, data, message: "" };
}
