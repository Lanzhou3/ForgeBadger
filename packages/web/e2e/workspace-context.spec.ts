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

test("code tab unifies files explorer, git, and code graph sub-views", async ({ page }) => {
  const unhandledApiRoutes = await mockWorkspaceApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Code" }).click();

  const explorer = page.getByTestId("workspace-explorer");
  await expect(explorer).toBeVisible();
  await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Git" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Code Graph" })).toBeVisible();

  await explorer.getByRole("button", { name: "src", exact: true }).click();
  await explorer.getByRole("button", { name: /index\.ts/ }).click();
  await expect(explorer.getByTestId("workspace-file-viewer")).toContainText(
    "export const workspace = true;",
  );
  expect(unhandledApiRoutes).toEqual([]);
});

test("legacy ?tab=files link opens Code -> Files workspace explorer with inline viewer", async ({ page }) => {
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

    if (url.pathname === "/api/v1/model-providers" && method === "GET") {
      await route.fulfill({ json: envelope({ providers: [], models: [], credentials: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/adapters/order" && method === "GET") {
      await route.fulfill({ json: envelope({ order: ["claude", "opencode", "codex", "kimi", "pi", "mcode", "grok"] }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/task-packets` && method === "GET") {
      await route.fulfill({ json: envelope({ taskPackets: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/gate-a/dependencies" && method === "GET") {
      await route.fulfill({ json: envelope({ dependencies: [] }) });
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

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/context` && method === "GET") {
      await route.fulfill({
        json: envelope({
          project: { id: PROJECT_ID, name: "ForgeBadger E2E", description: null, status: "active" },
          access: { role: "owner", capabilities: ["develop", "manage"], teamId: null, logicalOwnerId: "user-e2e" },
          managedExecution: { supported: false, reason: null },
          shared: false,
          privateDetailAllowed: true,
          revisionRequired: false,
        }),
      });
      return;
    }

    if (url.pathname === `/api/v1/collaboration/projects/${PROJECT_ID}` && method === "GET") {
      await route.fulfill({
        json: envelope({
          project: { id: PROJECT_ID, name: "ForgeBadger E2E", role: "owner", memberCount: 1, revision: 1, verificationRevision: 1, executionEnabled: false, verification: null },
          members: [],
          tasks: [],
          events: [],
        }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/goal` && method === "GET") {
      await route.fulfill({ json: envelope({ goal: null }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/work-items` && method === "GET") {
      await route.fulfill({ json: envelope({ workItems: [] }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/git-changes` && method === "GET") {
      await route.fulfill({ json: envelope({ git: { isGitRepo: true, branch: "main", changed: [], commits: [] } }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/graph/overview` && method === "GET") {
      await route.fulfill({ json: envelope({ available: false, reason: "not_initialized" }) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/goals" && method === "GET") {
      await route.fulfill({ json: envelope({ goals: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/fleets" && method === "GET") {
      await route.fulfill({ json: envelope({ fleets: [] }) });
      return;
    }

    if (url.pathname.startsWith("/api/v1/model-providers/applied/") && method === "GET") {
      await route.fulfill({ json: envelope({ appliedProvider: null }) });
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
