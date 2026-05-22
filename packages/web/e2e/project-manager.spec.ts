import { expect, test, type Page, type Route } from "@playwright/test";

const PROJECT_ID = "project-123";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openforge-language", "en");
    window.localStorage.setItem("openforge.token", "e2e-token");
    window.localStorage.setItem("openforge.user", JSON.stringify({
      id: "user-e2e",
      email: "project-manager-e2e@example.com",
      role: "admin",
      status: "active",
    }));
  });
});

test("renders populated Project Manager state from exact API routes", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Project Manager" })).toBeVisible();
  await expect(panel.getByText("Ship v1.2 Project Manager workflow")).toBeVisible();
  await expect(panel.getByText("Expose Project Manager tab")).toBeVisible();
  await expect(panel.getByText("Work item status changed")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Refresh project manager" }).first()).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("renders a visible not-found state for missing Project Manager records", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page, { projectManagerStatus: 404 });

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await expect(panel.getByText("Project manager state was not found for this project.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Refresh project manager" }).first()).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("saves a Project Manager goal update through the exact API route", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await panel.getByRole("button", { name: "Edit goal" }).click();
  await panel.getByLabel("Summary").fill("Ship v1.2 with editable goals");
  await panel.getByLabel("Constraints").fill("Stay in Project Manager tab\nUse Gateway route\n");
  await panel.getByLabel("Acceptance criteria").fill("Updated goal is visible\n");
  await panel.getByLabel("Goal status").fill("active");
  await panel.getByRole("button", { name: "Save goal" }).click();

  await expect(panel.getByText("Ship v1.2 with editable goals")).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

async function mockProjectDetailApis(
  page: Page,
  overrides: { projectManagerStatus?: number } = {}
) {
  const unhandledApiRoutes: string[] = [];
  let goal = {
    id: "goal-1",
    projectId: PROJECT_ID,
    summary: "Ship v1.2 Project Manager workflow",
    constraints: ["No Gateway authority changes"],
    acceptanceCriteria: ["Project Manager tab renders"],
    status: "active",
    createdAt: 1779370000000,
    updatedAt: 1779373600000,
  };

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/api/v1/auth/me" && method === "GET") {
      await route.fulfill({
        json: envelope({
          id: "user-e2e",
          email: "project-manager-e2e@example.com",
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

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}` && method === "GET") {
      await route.fulfill({
        json: envelope({
          project: {
            id: PROJECT_ID,
            name: "Project Manager E2E",
            path: "/workspace/project-manager-e2e",
            rootPath: "/workspace/project-manager-e2e",
            aiTool: "claude",
            status: "active",
          },
        }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/agent-sequence` && method === "GET") {
      await route.fulfill({ json: envelope({ sequence: [] }) });
      return;
    }

    if (
      (url.pathname === `/api/v1/projects/${PROJECT_ID}/ai-config` ||
        url.pathname === `/api/v1/projects/${PROJECT_ID}/ai-config/global`) &&
      method === "GET"
    ) {
      await route.fulfill({
        json: envelope({
          adapter: "claude",
          projectRoot: "/workspace/project-manager-e2e",
          files: [],
          forms: [],
        }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/skills` && method === "GET") {
      await route.fulfill({ json: envelope({ skills: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/sessions" && method === "GET") {
      expect(url.searchParams.get("projectId")).toBe(PROJECT_ID);
      await route.fulfill({ json: envelope({ sessions: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/agents" && method === "GET") {
      await route.fulfill({ json: envelope({ agents: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/skills" && method === "GET") {
      await route.fulfill({ json: envelope({ skills: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/models" && method === "GET") {
      await route.fulfill({ json: envelope({ models: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/api-keys" && method === "GET") {
      await route.fulfill({ json: envelope({ apiKeys: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/templates" && method === "GET") {
      await route.fulfill({ json: envelope({ templates: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/adapters/discovery" && method === "GET") {
      await route.fulfill({
        json: envelope({
          adapters: [{
            id: "claude",
            label: "Claude Code",
            command: "claude",
            supportLevel: "supported",
            launchEnabled: true,
            configDir: "~/.claude",
            runtimeModes: ["terminal"],
            available: true,
            status: "available",
          }],
        }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/goal` && method === "GET") {
      if (overrides.projectManagerStatus && overrides.projectManagerStatus >= 400) {
        await fulfillProjectManagerError(route, overrides.projectManagerStatus);
        return;
      }
      await route.fulfill({
        json: envelope({ goal }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/goal` && method === "PUT") {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        summary?: unknown;
        constraints?: unknown;
        acceptanceCriteria?: unknown;
        status?: unknown;
      };
      expect(typeof body.summary).toBe("string");
      expect(body.constraints).toEqual(["Stay in Project Manager tab", "Use Gateway route"]);
      expect(body.acceptanceCriteria).toEqual(["Updated goal is visible"]);
      expect(body.status).toBe("active");
      goal = {
        ...goal,
        summary: body.summary,
        constraints: body.constraints,
        acceptanceCriteria: body.acceptanceCriteria,
        status: body.status,
        updatedAt: 1779377200000,
      } as typeof goal;
      await route.fulfill({ json: envelope({ goal }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/work-items` && method === "GET") {
      expect(url.searchParams.get("limit")).toBe("5");
      if (overrides.projectManagerStatus && overrides.projectManagerStatus >= 400) {
        await fulfillProjectManagerError(route, overrides.projectManagerStatus);
        return;
      }
      await route.fulfill({
        json: envelope({
          workItems: [{
            id: "work-item-1",
            projectId: PROJECT_ID,
            title: "Expose Project Manager tab",
            description: null,
            status: "in_progress",
            priority: 10,
            acceptanceCriteria: ["Tab is visible"],
            evidenceRefCount: 1,
            evidenceRefs: [{ kind: "test", ref: "project-manager.spec.ts" }],
            feishuRefCount: 0,
            createdAt: 1779370000000,
            updatedAt: 1779373600000,
          }],
        }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/ledger` && method === "GET") {
      expect(url.searchParams.get("limit")).toBe("5");
      if (overrides.projectManagerStatus && overrides.projectManagerStatus >= 400) {
        await fulfillProjectManagerError(route, overrides.projectManagerStatus);
        return;
      }
      await route.fulfill({
        json: envelope({
          events: [{
            id: "ledger-1",
            projectId: PROJECT_ID,
            workItemId: "work-item-1",
            eventType: "work_item_status_changed",
            status: "in_progress",
            evidenceRefCount: 1,
            feishuRefCount: 0,
            createdAt: 1779373600000,
          }],
        }),
      });
      return;
    }

    const unhandledRoute = `${method} ${url.pathname}${url.search}`;
    unhandledApiRoutes.push(unhandledRoute);
    await route.fulfill({
      status: 404,
      json: {
        code: 1,
        message: `Unhandled mocked API route: ${unhandledRoute}`,
      },
    });
  });

  return unhandledApiRoutes;
}

async function fulfillProjectManagerError(route: Route, status: number) {
  await route.fulfill({
    status,
    json: {
      code: 1,
      message: status === 404
        ? "Project manager state was not found for this project."
        : "Could not load project manager state.",
    },
  });
}

function envelope(data: unknown) {
  return { code: 0, data, message: "" };
}
