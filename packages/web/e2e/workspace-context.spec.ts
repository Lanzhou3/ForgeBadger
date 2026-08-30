import { expect, test, type Page } from "@playwright/test";

const PROJECT_ID = "project-123";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("forgebadger-language", "en");
    window.localStorage.setItem("forgebadger.token", "e2e-token");
    window.localStorage.setItem("forgebadger.user", JSON.stringify({
      id: "user-e2e",
      email: "workspace-e2e@example.com",
      role: "admin",
      status: "active",
    }));
  });
});

test("project detail exposes a safe workspace sidecar with lazy tree and sheet viewer", async ({ page }) => {
  const unhandledApiRoutes = await mockWorkspaceApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);

  const panel = page.getByTestId("workspace-context-panel");
  await expect(panel.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await expect(panel.getByText("/workspace/forgebadger")).toBeVisible();

  // Directories expand lazily; files open in the sheet viewer.
  await panel.getByRole("button", { name: "src", exact: true }).click();
  await panel.getByRole("button", { name: /index\.ts/ }).click();
  await expect(page.getByTestId("workspace-file-viewer")).toContainText("export const workspace = true;");
  expect(unhandledApiRoutes).toEqual([]);
});

test("files tab renders the workspace explorer with an inline viewer", async ({ page }) => {
  const unhandledApiRoutes = await mockWorkspaceApis(page);

  await page.goto(`/projects/${PROJECT_ID}?tab=files`);

  const explorer = page.getByTestId("workspace-explorer");
  await expect(explorer).toBeVisible();
  await expect(explorer.getByRole("button", { name: "src", exact: true })).toBeVisible();

  await explorer.getByRole("button", { name: "src", exact: true }).click();
  await explorer.getByRole("button", { name: /index\.ts/ }).click();

  const viewer = explorer.getByTestId("workspace-file-viewer");
  await expect(viewer.getByRole("navigation", { name: "File path" })).toContainText("src");
  await expect(viewer).toContainText("export const workspace = true;");
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
            path: "/workspace/forgebadger",
            rootPath: "/workspace/forgebadger",
            aiTool: "claude",
            status: "active",
          },
        }),
      });
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
          projectRoot: "/workspace/forgebadger",
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
      if (url.searchParams.get("path") === "src") {
        await route.fulfill({
          json: envelope({
            projectId: PROJECT_ID,
            rootPath: "/workspace/forgebadger",
            path: "src",
            truncated: false,
            entries: [{
              name: "index.ts",
              path: "src/index.ts",
              kind: "file",
              sizeBytes: 31,
              updatedAt: "2026-05-29T00:00:00.000Z",
            }],
          }),
        });
        return;
      }
      await route.fulfill({
        json: envelope({
          projectId: PROJECT_ID,
          rootPath: "/workspace/forgebadger",
          path: "",
          truncated: false,
          entries: [{
            name: "src",
            path: "src",
            kind: "directory",
            updatedAt: "2026-05-29T00:00:00.000Z",
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
          rootPath: "/workspace/forgebadger",
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

    if (url.pathname === "/api/v1/activities" && method === "GET") {
      await route.fulfill({ json: envelope({ activities: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/skills" && method === "GET") {
      await route.fulfill({ json: envelope({ skills: [] }) });
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

function envelope(data: unknown) {
  return { code: 0, data, message: "" };
}
