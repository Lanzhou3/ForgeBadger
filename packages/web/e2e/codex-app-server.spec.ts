import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openforge-language", "en");
    window.localStorage.setItem("openforge.token", "e2e-token");
    window.localStorage.setItem("openforge.user", JSON.stringify({
      id: "user-e2e",
      email: "codex-e2e@example.com",
      role: "admin",
      status: "active",
    }));
  });
});

test("Codex background task page shows zero-quota status and safe activity metadata", async ({ page }) => {
  const requestedPaths: string[] = [];
  await mockCodexAppServerApis(page, requestedPaths);

  await page.goto("/codex-app-server");

  await expect(page.getByRole("heading", { name: "Codex Background Tasks" })).toBeVisible();
  await expect(page.getByLabel("Codex app-server capability state")).toContainText("Task input disabled");
  await expect(page.getByText("Prompt and response content is not stored.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Initialize" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create thread" })).toBeVisible();
  await expect(page.getByRole("button", { name: /turn|prompt|send/i })).toHaveCount(0);
  await expect(page.getByText("ws://127.0.0.1:45200")).toBeVisible();
  await expect(page.getByText("9876")).toBeVisible();
  await expect(page.getByText(/token/i)).toHaveCount(0);
  await expect(page.getByText("Codex app-server process error")).toBeVisible();
  await expect(page.getByText("internal crash stack")).toHaveCount(0);

  const activityFeed = page.getByLabel("Codex app-server activity feed");
  await expect(activityFeed.getByText("Channel initialized")).toBeVisible();
  await expect(activityFeed.getByText("Thread created")).toBeVisible();
  await expect(activityFeed.getByText("Channel error")).toBeVisible();
  await expect(activityFeed.getByText("Background notification")).toBeVisible();
  await expect(activityFeed.getByText("initialize · app-server-websocket")).toBeVisible();
  await expect(activityFeed.getByText("thread/start · thread-1")).toBeVisible();
  await expect(activityFeed.getByText("permission_prompt · notification/prompt · thread-1")).toBeVisible();
  await expect(activityFeed.getByText("secret prompt")).toHaveCount(0);
  await expect(activityFeed.getByText("secret response")).toHaveCount(0);

  expect(requestedPaths.some((path) => path.includes("/turn"))).toBe(false);
});

async function mockCodexAppServerApis(page: import("@playwright/test").Page, requestedPaths: string[]) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requestedPaths.push(`${route.request().method()} ${url.pathname}${url.search}`);

    if (url.pathname === "/api/v1/auth/me") {
      await route.fulfill({
        json: envelope({
          id: "user-e2e",
          email: "codex-e2e@example.com",
          role: "admin",
          status: "active",
        }),
      });
      return;
    }
    if (url.pathname === "/api/v1/projects") {
      await route.fulfill({
        json: envelope({
          projects: [{
            id: "project-codex",
            name: "Codex Project",
            path: "/tmp/codex-project",
            aiTool: "codex",
          }],
        }),
      });
      return;
    }
    if (url.pathname === "/api/v1/codex/app-server/capabilities") {
      await route.fulfill({
        json: envelope({
          capabilities: {
            initializeEnabled: true,
            threadCreationEnabled: true,
            turnInputEnabled: false,
            promptInputExposed: false,
            transcriptPersistence: "disabled",
          },
        }),
      });
      return;
    }
    if (url.pathname === "/api/v1/codex/app-server") {
      await route.fulfill({
        json: envelope({
          sessions: [{
            id: "app-server-1",
            userId: "user-e2e",
            projectId: "project-codex",
            projectRoot: "/tmp/codex-project",
            runtimeMode: "app-server-websocket",
            status: "running",
            command: "codex",
            args: ["app-server"],
            listen: "ws://127.0.0.1:45200",
            pid: 9876,
            errorMessage: "internal crash stack",
            features: { turnInputEnabled: false },
            createdAt: "2026-05-09T00:00:00.000Z",
            updatedAt: "2026-05-09T00:01:00.000Z",
          }],
        }),
      });
      return;
    }
    if (url.pathname === "/api/v1/activities") {
      await route.fulfill({
        json: envelope({
          activities: [{
            id: "activity-4",
            type: "codex_app_server_error",
            status: "error",
            message: "codex crashed",
            metadata: {
              runtimeMode: "app-server-websocket",
              errorMessage: "internal crash stack",
            },
            createdAt: "2026-05-09T00:03:00.000Z",
          }, {
            id: "activity-3",
            type: "codex_app_server_thread_started",
            status: "info",
            message: "Codex app-server thread started",
            metadata: {
              method: "thread/start",
              threadId: "thread-1",
              prompt: "secret prompt",
            },
            createdAt: "2026-05-09T00:02:00.000Z",
          }, {
            id: "activity-2",
            type: "codex_app_server_initialized",
            status: "info",
            message: "Codex app-server initialized",
            metadata: {
              method: "initialize",
              runtimeMode: "app-server-websocket",
            },
            createdAt: "2026-05-09T00:01:00.000Z",
          }, {
            id: "activity-1",
            type: "codex_app_server_notification",
            status: "warning",
            message: "approval needed",
            metadata: {
              activityType: "permission_prompt",
              method: "notification/prompt",
              threadId: "thread-1",
              prompt: "secret prompt",
              response: "secret response",
            },
            createdAt: "2026-05-09T00:00:00.000Z",
          }],
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
