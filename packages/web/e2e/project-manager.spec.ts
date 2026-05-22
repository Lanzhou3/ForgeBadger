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

test("filters, inspects, and creates Project Manager work items", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await panel.getByLabel("Filter by status").selectOption("blocked");
  await expect(panel.getByText("Review external evidence")).toBeVisible();
  await expect(panel.getByText("Expose Project Manager tab")).not.toBeVisible();

  await panel.getByRole("button", { name: "View details" }).click();
  await expect(page.getByRole("dialog", { name: "Review external evidence" })).toBeVisible();
  await expect(page.getByText("Confirm beta evidence caveats")).toBeVisible();
  await page.keyboard.press("Escape");

  await panel.getByRole("button", { name: "Create work item" }).click();
  const dialog = page.getByRole("dialog", { name: "Create work item" });
  await dialog.getByLabel("Title").fill("Confirm trial packet");
  await dialog.getByLabel("Priority").fill("7");
  await dialog.getByLabel("Description").fill("Check the first-user packet before milestone close.");
  await dialog.getByLabel("Status").selectOption("blocked");
  await dialog.getByLabel("Acceptance criteria").fill("Created item is visible\nReferences stay bounded\n");
  await dialog.getByLabel("Kind").first().fill("report");
  await dialog.getByLabel("Label").first().fill("Trial checklist");
  await dialog.getByLabel("Reference").first().fill("TRIAL-1");
  await dialog.getByLabel("Path").fill("docs/TRIAL-CHECKLIST.md");
  await dialog.getByLabel("Kind").nth(1).fill("message");
  await dialog.getByLabel("Label").nth(1).fill("Feishu approval");
  await dialog.getByLabel("Reference").nth(1).fill("om_999");
  await dialog.getByLabel("Feishu message ID").fill("om_msg_999");
  await dialog.getByRole("button", { name: "Create work item" }).click();

  await expect(panel.getByText("Confirm trial packet")).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("changes work item status and guards evidence-free done", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  const evidenceRow = panel.getByRole("row", { name: /Expose Project Manager tab/ });
  await evidenceRow.getByRole("button", { name: "Change status" }).click();
  await page.getByRole("menuitem", { name: "Ready for review" }).click();
  await expect(evidenceRow.getByText("Ready for review")).toBeVisible();

  const noEvidenceRow = panel.getByRole("row", { name: /Draft release note/ });
  await noEvidenceRow.getByRole("button", { name: "Change status" }).click();
  await page.getByRole("menuitem", { name: "Done" }).click();
  const doneDialog = page.getByRole("dialog", { name: "Completion reason required" });
  await expect(doneDialog).toBeVisible();
  await doneDialog.getByRole("button", { name: "Confirm status change" }).click();
  await expect(doneDialog.getByText("Enter a manual completion reason.")).toBeVisible();
  await doneDialog.getByLabel("Manual completion reason").fill("Local checklist item completed without external evidence.");
  await doneDialog.getByRole("button", { name: "Confirm status change" }).click();
  await expect(noEvidenceRow.getByText("Done")).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("attaches one bounded evidence reference from work item details", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await panel.getByLabel("Filter by status").selectOption("blocked");
  await panel.getByRole("button", { name: "View details" }).click();

  const sheet = page.getByRole("dialog", { name: "Review external evidence" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Kind").fill("report");
  await sheet.getByLabel("Label").fill("Phase 11 evidence");
  await sheet.getByLabel("Reference").fill("PMEV-01");
  await sheet.getByLabel("Path").fill("docs/reports/phase-11-evidence.md");
  await sheet.getByRole("button", { name: "Attach evidence" }).click();

  await expect(sheet.getByText("PMEV-01")).toBeVisible();
  await expect(sheet.getByText("docs/reports/phase-11-evidence.md")).toBeVisible();
  await expect(panel.locator("tbody tr", { hasText: "Review external evidence" }).locator("td").nth(3)).toHaveText("1");
  expect(unhandledApiRoutes).toEqual([]);
});

test("keeps safe evidence draft values visible after attach failure", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page, { evidenceAttachStatus: 500 });

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await panel.getByLabel("Filter by status").selectOption("blocked");
  await panel.getByRole("button", { name: "View details" }).click();

  const sheet = page.getByRole("dialog", { name: "Review external evidence" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Kind").fill("report");
  await sheet.getByLabel("Label").fill("Phase 11 evidence");
  await sheet.getByLabel("Reference").fill("PMEV-01");
  await sheet.getByLabel("Path").fill("docs/reports/phase-11-evidence.md");
  await sheet.getByRole("button", { name: "Attach evidence" }).click();

  await expect(sheet.getByText("Could not attach evidence reference.")).toBeVisible();
  await expect(sheet.getByLabel("Kind")).toHaveValue("report");
  await expect(sheet.getByLabel("Label")).toHaveValue("Phase 11 evidence");
  await expect(sheet.getByLabel("Reference")).toHaveValue("PMEV-01");
  await expect(sheet.getByLabel("Path")).toHaveValue("docs/reports/phase-11-evidence.md");
  await expect(sheet).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

async function mockProjectDetailApis(
  page: Page,
  overrides: { evidenceAttachStatus?: number; projectManagerStatus?: number } = {}
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
  let workItems = [{
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
  }, {
    id: "work-item-2",
    projectId: PROJECT_ID,
    title: "Review external evidence",
    description: "Confirm beta evidence caveats",
    status: "blocked",
    priority: 5,
    acceptanceCriteria: ["Caveats remain explicit"],
    evidenceRefCount: 0,
    evidenceRefs: [],
    feishuRefCount: 1,
    createdAt: 1779370000000,
    updatedAt: 1779373600000,
  }, {
    id: "work-item-3",
    projectId: PROJECT_ID,
    title: "Draft release note",
    description: "Summarize the local UI workflow",
    status: "in_progress",
    priority: 3,
    acceptanceCriteria: ["Release note is concise"],
    evidenceRefCount: 0,
    evidenceRefs: [],
    feishuRefCount: 0,
    createdAt: 1779370000000,
    updatedAt: 1779373600000,
  }];

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
      expect(url.searchParams.get("limit")).toBe("50");
      if (overrides.projectManagerStatus && overrides.projectManagerStatus >= 400) {
        await fulfillProjectManagerError(route, overrides.projectManagerStatus);
        return;
      }
      const status = url.searchParams.get("status");
      const filteredWorkItems = status
        ? workItems.filter((item) => item.status === status)
        : workItems;
      await route.fulfill({
        json: envelope({ workItems: filteredWorkItems }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/work-items` && method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        title?: unknown;
        description?: unknown;
        priority?: unknown;
        status?: unknown;
        acceptanceCriteria?: unknown;
        evidenceRefs?: unknown;
        feishuRefs?: unknown;
      };
      expect(body).toEqual({
        title: "Confirm trial packet",
        description: "Check the first-user packet before milestone close.",
        priority: 7,
        status: "blocked",
        acceptanceCriteria: ["Created item is visible", "References stay bounded"],
        evidenceRefs: [{
          kind: "report",
          label: "Trial checklist",
          ref: "TRIAL-1",
          path: "docs/TRIAL-CHECKLIST.md",
        }],
        feishuRefs: [{
          kind: "message",
          label: "Feishu approval",
          ref: "om_999",
          feishuMessageId: "om_msg_999",
        }],
      });
      const createdWorkItem = {
        id: "work-item-created",
        projectId: PROJECT_ID,
        title: body.title as string,
        description: body.description as string,
        status: body.status as string,
        priority: body.priority as number,
        acceptanceCriteria: body.acceptanceCriteria as string[],
        evidenceRefCount: 1,
        evidenceRefs: [{
          kind: "report",
          label: "Trial checklist",
          ref: "TRIAL-1",
          path: "docs/TRIAL-CHECKLIST.md",
        }],
        feishuRefCount: 1,
        createdAt: 1779377600000,
        updatedAt: 1779377600000,
      };
      workItems = [...workItems, createdWorkItem];
      await route.fulfill({ json: envelope({ workItem: createdWorkItem }) });
      return;
    }

    const statusMatch = url.pathname.match(
      new RegExp(`^/api/v1/projects/${PROJECT_ID}/project-manager/work-items/([^/]+)/status$`)
    );
    if (statusMatch && method === "PATCH") {
      const workItemId = decodeURIComponent(statusMatch[1]);
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        status?: unknown;
        manualCompletionReason?: unknown;
      };
      if (workItemId === "work-item-1") {
        expect(body).toEqual({ status: "ready_for_review" });
      }
      if (workItemId === "work-item-3") {
        expect(body).toEqual({
          status: "done",
          manualCompletionReason: "Local checklist item completed without external evidence.",
        });
      }
      const updatedWorkItem = workItems.find((item) => item.id === workItemId);
      expect(updatedWorkItem).toBeTruthy();
      workItems = workItems.map((item) => item.id === workItemId
        ? { ...item, status: body.status as string, updatedAt: 1779378800000 }
        : item);
      await route.fulfill({
        json: envelope({ workItem: workItems.find((item) => item.id === workItemId) }),
      });
      return;
    }

    const evidenceMatch = url.pathname.match(
      new RegExp(`^/api/v1/projects/${PROJECT_ID}/project-manager/work-items/([^/]+)/evidence$`)
    );
    if (evidenceMatch && method === "POST") {
      if (overrides.evidenceAttachStatus && overrides.evidenceAttachStatus >= 400) {
        await route.fulfill({
          status: overrides.evidenceAttachStatus,
          json: {
            code: 1,
            message: "Could not attach evidence reference.",
          },
        });
        return;
      }
      const workItemId = decodeURIComponent(evidenceMatch[1]);
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        evidenceRefs?: unknown;
      };
      expect(body).toEqual({
        evidenceRefs: [{
          kind: "report",
          label: "Phase 11 evidence",
          ref: "PMEV-01",
          path: "docs/reports/phase-11-evidence.md",
        }],
      });
      const updatedWorkItem = workItems.find((item) => item.id === workItemId);
      expect(updatedWorkItem).toBeTruthy();
      workItems = workItems.map((item) => item.id === workItemId
        ? {
          ...item,
          evidenceRefCount: item.evidenceRefCount + 1,
          evidenceRefs: [
            ...item.evidenceRefs,
            {
              kind: "report",
              label: "Phase 11 evidence",
              ref: "PMEV-01",
              path: "docs/reports/phase-11-evidence.md",
            },
          ],
          updatedAt: 1779379000000,
        }
        : item);
      await route.fulfill({
        json: envelope({ workItem: workItems.find((item) => item.id === workItemId) }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/ledger` && method === "GET") {
      expect(url.searchParams.get("limit")).toBe("5");
      if (overrides.projectManagerStatus && overrides.projectManagerStatus >= 400) {
        await fulfillProjectManagerError(route, overrides.projectManagerStatus);
        return;
      }
      const evidenceAttachedEvent = workItems.some((item) =>
        item.evidenceRefs.some((ref) => ref.ref === "PMEV-01")
      )
        ? [{
          id: "ledger-2",
          projectId: PROJECT_ID,
          workItemId: "work-item-2",
          eventType: "evidence_attached",
          evidenceRefCount: 1,
          feishuRefCount: 1,
          createdAt: 1779379000000,
        }]
        : [];
      await route.fulfill({
        json: envelope({
          events: [...evidenceAttachedEvent, {
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
