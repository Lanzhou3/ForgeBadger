import { expect, test, type Page } from "@playwright/test";

const PROJECT_ID = "project-123";
const SESSION_ID = "session-123";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openforge-language", "en");
    window.localStorage.setItem("openforge.token", "e2e-token");
    window.localStorage.setItem("openforge.user", JSON.stringify({
      id: "user-e2e",
      email: "workspace-e2e@example.com",
      role: "admin",
      status: "active",
    }));
  });
});

test("project detail exposes a safe workspace sidecar and bounded file preview", async ({ page }) => {
  const unhandledApiRoutes = await mockWorkspaceApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);

  const panel = page.getByTestId("workspace-context-panel");
  await expect(panel.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await expect(panel.getByText("/workspace/openforge")).toBeVisible();
  await panel.getByRole("button", { name: "src/index.ts" }).click();
  await expect(panel.getByText("export const workspace = true;")).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("session detail exposes the same workspace sidecar from the session project", async ({ page }) => {
  const unhandledApiRoutes = await mockWorkspaceApis(page);

  await page.goto(`/sessions/${SESSION_ID}`);

  const panel = page.getByTestId("workspace-context-panel");
  await expect(panel.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await panel.getByRole("button", { name: "src/index.ts" }).click();
  await expect(panel.getByText("export const workspace = true;")).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

async function mockWorkspaceApis(page: Page) {
  const unhandledApiRoutes: string[] = [];

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/api/v1/auth/me" && method === "GET") {
      await route.fulfill({
        json: envelope({
          id: "user-e2e",
          email: "workspace-e2e@example.com",
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
            name: "Workspace E2E",
            path: "/workspace/openforge",
            rootPath: "/workspace/openforge",
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
          projectRoot: "/workspace/openforge",
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

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/workspace/tree` && method === "GET") {
      await route.fulfill({
        json: envelope({
          projectId: PROJECT_ID,
          rootPath: "/workspace/openforge",
          path: "",
          truncated: false,
          entries: [{
            name: "src",
            path: "src",
            kind: "directory",
            updatedAt: "2026-05-29T00:00:00.000Z",
            children: [{
              name: "index.ts",
              path: "src/index.ts",
              kind: "file",
              sizeBytes: 31,
              updatedAt: "2026-05-29T00:00:00.000Z",
            }],
          }, {
            name: "README.md",
            path: "README.md",
            kind: "file",
            sizeBytes: 12,
            updatedAt: "2026-05-29T00:00:00.000Z",
          }],
        }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/workspace/file` && method === "GET") {
      expect(url.searchParams.get("path")).toBe("src/index.ts");
      await route.fulfill({
        json: envelope({
          projectId: PROJECT_ID,
          rootPath: "/workspace/openforge",
          path: "src/index.ts",
          name: "index.ts",
          sizeBytes: 31,
          updatedAt: "2026-05-29T00:00:00.000Z",
          encoding: "utf8",
          content: "export const workspace = true;\n",
          truncated: false,
          binary: false,
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/sessions" && method === "GET") {
      await route.fulfill({ json: envelope({ sessions: [] }) });
      return;
    }

    if (url.pathname === `/api/v1/sessions/${SESSION_ID}` && method === "GET") {
      await route.fulfill({ json: envelope({ session: sessionPayload() }) });
      return;
    }

    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/connect` && method === "POST") {
      await route.fulfill({ json: envelope({ session: sessionPayload() }) });
      return;
    }

    if (url.pathname === "/api/v1/activities" && method === "GET") {
      await route.fulfill({ json: envelope({ activities: [] }) });
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
      await route.fulfill({ json: envelope({ adapters: [] }) });
      return;
    }

    unhandledApiRoutes.push(`${method} ${url.pathname}`);
    await route.fulfill({
      status: 500,
      json: { code: 1, message: `Unhandled API route: ${method} ${url.pathname}` },
    });
  });

  return unhandledApiRoutes;
}

function sessionPayload() {
  return {
    id: SESSION_ID,
    attachToken: "attach-token",
    tmuxName: "of-session-123",
    tmuxSession: "of-session-123",
    status: "running",
    name: "Workspace Session",
    projectId: PROJECT_ID,
    projectName: "Workspace E2E",
    aiTool: "claude",
  };
}

function envelope(data: unknown) {
  return { code: 0, data, message: "" };
}
