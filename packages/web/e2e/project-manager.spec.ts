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
  await panel.getByRole("button", { name: "Table" }).click();
  await expect(panel.getByRole("row", { name: /Expose Project Manager tab/ })).toBeVisible();
  await expect(panel.getByText("Work item status changed")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Refresh project manager" }).first()).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("opens Project Manager from deep link and renders Copilot trace markers", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}?tab=project-manager&workItemId=work-item-trace`);

  const panel = page.getByTestId("project-manager-panel");
  await expect(panel).toBeVisible();
  const sheet = page.getByRole("dialog", { name: "Trace Copilot approval chain" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Done").first()).toBeVisible();
  await expect(sheet.getByText("Copilot trace")).toBeVisible();
  await expect(sheet.getByText("Run", { exact: true })).toBeVisible();
  await expect(sheet.getByText("run-done-1", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Action", { exact: true })).toBeVisible();
  await expect(sheet.getByText("pm-action-done", { exact: true })).toBeVisible();
  await expect(sheet.getByText(/test.*Traceability E2E.*verified/).first()).toBeVisible();
  await expect(sheet.getByText("Session", { exact: true })).toBeVisible();
  await expect(sheet.getByText("session-trace-1", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Ledger", { exact: true })).toBeVisible();
  await expect(sheet.getByText("copilot_observation_recorded", { exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  const ledger = panel.getByTestId("project-manager-ledger");
  await expect(ledger.getByText("Copilot trace").first()).toBeVisible();
  await expect(ledger.getByText("Action type", { exact: true }).first()).toBeVisible();
  await expect(ledger.getByText("update_work_item_status", { exact: true })).toBeVisible();
  await expect(ledger.getByText("Target", { exact: true }).first()).toBeVisible();
  await expect(ledger.getByText("work-item-trace").first()).toBeVisible();
  await expect(ledger.getByText("Evidence refs", { exact: true }).first()).toBeVisible();
  await expect(ledger.getByText("Approval", { exact: true }).first()).toBeVisible();
  await expect(ledger.getByText("approved", { exact: true }).first()).toBeVisible();
  await expect(ledger.getByText("Execution", { exact: true }).first()).toBeVisible();
  await expect(ledger.getByText("succeeded", { exact: true }).first()).toBeVisible();
  await expect(panel.getByText("RAW TERMINAL OUTPUT SHOULD NOT RENDER")).toHaveCount(0);
  await expect(panel.getByText("RAW PROVIDER PAYLOAD SHOULD NOT RENDER")).toHaveCount(0);
  await expect(panel.getByText("RAW LEDGER DETAILS SHOULD NOT RENDER")).toHaveCount(0);
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
  await panel.getByRole("button", { name: "Table" }).click();
  await panel.getByLabel("Filter by status").selectOption("blocked");
  await expect(panel.getByRole("row", { name: /Review external evidence/ })).toBeVisible();
  await expect(panel.locator("table tbody tr", { hasText: "Expose Project Manager tab" })).toHaveCount(0);

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

test("manages work items from the Project Manager board", async ({ page }) => {
  const deletedWorkItemIds: string[] = [];
  const unhandledApiRoutes = await mockProjectDetailApis(page, {
    onDeleteWorkItem: (workItemId) => deletedWorkItemIds.push(workItemId),
  });

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  const board = panel.getByTestId("project-manager-board");
  await expect(board).toBeVisible();
  await expect(panel.getByRole("button", { name: "Board" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Table" })).toBeVisible();

  const blockedCard = panel.getByTestId("project-manager-board-card-work-item-2");
  await expect(blockedCard.getByText("Review external evidence")).toBeVisible();
  await blockedCard.getByRole("button", { name: "Edit work item" }).click();

  const editDialog = page.getByRole("dialog", { name: "Edit work item" });
  await editDialog.getByLabel("Title").fill("Review external evidence packet");
  await editDialog.getByLabel("Priority").fill("8");
  await editDialog.getByLabel("Description").fill("Confirm beta evidence caveats before trial.");
  await editDialog.getByLabel("Acceptance criteria").fill("Caveats remain explicit\nBoard edit is saved\n");
  await editDialog.getByRole("button", { name: "Save work item" }).click();
  await expect(blockedCard.getByText("Review external evidence packet")).toBeVisible();

  await panel.getByTestId("project-manager-board-card-work-item-1")
    .getByLabel("Select work item")
    .check();
  await panel.getByTestId("project-manager-board-card-work-item-3")
    .getByLabel("Select work item")
    .check();
  await panel.getByLabel("Batch target status").selectOption("ready_for_review");
  await panel.getByRole("button", { name: "Move selected" }).click();

  const reviewColumn = panel.getByTestId("project-manager-board-column-ready_for_review");
  await expect(reviewColumn.getByText("Expose Project Manager tab")).toBeVisible();
  await expect(reviewColumn.getByText("Draft release note")).toBeVisible();

  await panel.getByTestId("project-manager-board-card-work-item-2")
    .getByRole("button", { name: "Delete work item" })
    .click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete work item" });
  await expect(deleteDialog.getByText("Review external evidence packet")).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Delete work item" }).click();
  await expect.poll(() => deletedWorkItemIds).toEqual(["work-item-2"]);
  await expect(panel.getByTestId("project-manager-board-card-work-item-2")).toHaveCount(0);
  expect(unhandledApiRoutes).toEqual([]);
});

test("changes work item status and guards evidence-free done", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await panel.getByRole("button", { name: "Table" }).click();
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
  await panel.getByRole("button", { name: "Table" }).click();
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
  await panel.getByRole("button", { name: "Table" }).click();
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

test("completes the v1.2 Project Manager workflow under strict route mocks", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await expect(panel.getByText("Ship v1.2 Project Manager workflow")).toBeVisible();
  await panel.getByRole("button", { name: "Table" }).click();
  const workItemRow = panel.getByRole("row", { name: /Review external evidence/ });
  await expect(workItemRow).toBeVisible();
  await workItemRow.getByRole("button", { name: "View details" }).click();

  const sheet = page.getByRole("dialog", { name: "Review external evidence" });
  await sheet.getByLabel("Kind").fill("report");
  await sheet.getByLabel("Label").fill("Phase 11 evidence");
  await sheet.getByLabel("Reference").fill("PMEV-01");
  await sheet.getByLabel("Path").fill("docs/reports/phase-11-evidence.md");
  await sheet.getByRole("button", { name: "Attach evidence" }).click();
  await expect(sheet.getByText("PMEV-01")).toBeVisible();

  await sheet.getByRole("button", { name: "Change status" }).click();
  await page.getByRole("menuitem", { name: "In progress" }).click();
  await expect(sheet.getByText("In progress").first()).toBeVisible();
  await sheet.getByRole("button", { name: "Change status" }).click();
  await page.getByRole("menuitem", { name: "Done" }).click();
  await expect(sheet.getByText("Done").first()).toBeVisible();

  await page.keyboard.press("Escape");
  const ledger = panel.getByTestId("project-manager-ledger");
  await expect(ledger.getByText("Evidence attached").first()).toBeVisible();
  await expect(ledger.getByText("Work item status changed").first()).toBeVisible();
  await expect(ledger.getByText("Review external evidence").first()).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("renders ledger timeline filters and loads more events", async ({ page }) => {
  const ledgerLimits: number[] = [];
  const unhandledApiRoutes = await mockProjectDetailApis(page, {
    onLedgerLimit: (limit) => ledgerLimits.push(limit),
  });

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  const ledger = panel.getByTestId("project-manager-ledger");
  await expect(ledger.getByRole("button", { name: "All" })).toBeVisible();
  await expect(ledger.getByRole("button", { name: "Status changes" })).toBeVisible();
  await expect(ledger.getByRole("button", { name: "Evidence" })).toBeVisible();
  await expect(ledger.getByRole("button", { name: "Manual completion" })).toBeVisible();
  await expect(ledger.getByRole("button", { name: "Blockers" })).toBeVisible();
  await expect(ledger.getByText("Manual completion recorded")).toBeVisible();
  await expect(ledger.getByText("Completion was recorded without an evidence reference.")).toBeVisible();
  await expect(ledger.getByText("Blocker recorded")).toBeVisible();
  await expect(ledger.getByText("Blocker marker only; raw blocker details are not displayed.")).toBeVisible();
  expect(ledgerLimits).toContain(25);

  await ledger.getByRole("button", { name: "Blockers" }).click();
  await expect(ledger.getByText("Blocker recorded")).toBeVisible();
  await expect(ledger.getByText("Manual completion recorded")).not.toBeVisible();

  await ledger.getByRole("button", { name: "Manual completion" }).click();
  await expect(ledger.getByText("Manual completion recorded")).toBeVisible();
  await expect(ledger.getByText("Blocker recorded")).not.toBeVisible();

  await ledger.getByRole("button", { name: "All" }).click();
  await ledger.getByRole("button", { name: "Load more ledger events" }).click();
  await expect.poll(() => ledgerLimits).toContain(50);
  await expect(ledger.getByText("Next step proposed")).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("keeps goal and work items visible when ledger loading fails", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page, { ledgerStatus: 500 });

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Project Manager" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await expect(panel.getByText("Ship v1.2 Project Manager workflow")).toBeVisible();
  await expect(panel.getByText("Expose Project Manager tab")).toBeVisible();
  const ledger = panel.getByTestId("project-manager-ledger");
  await expect(ledger.getByText("Could not load ledger events.")).toBeVisible();
  await expect(ledger.getByRole("button", { name: "Refresh project manager" })).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

async function mockProjectDetailApis(
  page: Page,
  overrides: {
    evidenceAttachStatus?: number;
    ledgerStatus?: number;
    onDeleteWorkItem?: (workItemId: string) => void;
    onLedgerLimit?: (limit: number) => void;
    projectManagerStatus?: number;
  } = {}
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
  }, {
    id: "work-item-trace",
    projectId: PROJECT_ID,
    title: "Trace Copilot approval chain",
    description: "Show the done status with trusted evidence and the ledger marker.",
    status: "done",
    priority: 9,
    acceptanceCriteria: ["Trace markers are visible"],
    evidenceRefCount: 2,
    evidenceRefs: [{
      kind: "test",
      label: "Initial trace",
      status: "draft",
      ref: "PW-TRACE-OLD",
      sessionId: "session-old",
      copilotRunId: "run-old-1",
      pendingActionId: "pm-action-old",
      rawTerminal: "RAW TERMINAL OUTPUT SHOULD NOT RENDER",
    }, {
      kind: "test",
      label: "Traceability E2E",
      status: "verified",
      ref: "PW-TRACE-1",
      sessionId: "session-trace-1",
      copilotRunId: "run-evidence-1",
      pendingActionId: "pm-action-evidence",
      rawTerminal: "RAW TERMINAL OUTPUT SHOULD NOT RENDER",
    }],
    feishuRefCount: 0,
    createdAt: 1779370000000,
    updatedAt: 1779374200000,
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

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/work-items/batch/status` && method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        updates?: Array<{ workItemId?: unknown; status?: unknown }>;
      };
      expect(body).toEqual({
        updates: [
          { workItemId: "work-item-1", status: "ready_for_review" },
          { workItemId: "work-item-3", status: "ready_for_review" },
        ],
      });
      const targetIds = new Set(body.updates?.map((update) => update.workItemId));
      workItems = workItems.map((item) => targetIds.has(item.id)
        ? { ...item, status: "ready_for_review", updatedAt: 1779379700000 }
        : item);
      await route.fulfill({
        json: envelope({
          workItems: workItems.filter((item) => targetIds.has(item.id)),
        }),
      });
      return;
    }

    const editMatch = url.pathname.match(
      new RegExp(`^/api/v1/projects/${PROJECT_ID}/project-manager/work-items/([^/]+)$`)
    );
    if (editMatch && method === "PATCH") {
      const workItemId = decodeURIComponent(editMatch[1]);
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        title?: unknown;
        description?: unknown;
        priority?: unknown;
        acceptanceCriteria?: unknown;
      };
      expect(workItemId).toBe("work-item-2");
      expect(body).toEqual({
        title: "Review external evidence packet",
        description: "Confirm beta evidence caveats before trial.",
        priority: 8,
        acceptanceCriteria: ["Caveats remain explicit", "Board edit is saved"],
      });
      workItems = workItems.map((item) => item.id === workItemId
        ? {
          ...item,
          title: body.title as string,
          description: body.description as string,
          priority: body.priority as number,
          acceptanceCriteria: body.acceptanceCriteria as string[],
          updatedAt: 1779379600000,
        }
        : item);
      await route.fulfill({
        json: envelope({ workItem: workItems.find((item) => item.id === workItemId) }),
      });
      return;
    }

    const deleteMatch = url.pathname.match(
      new RegExp(`^/api/v1/projects/${PROJECT_ID}/project-manager/work-items/([^/]+)$`)
    );
    if (deleteMatch && method === "DELETE") {
      const workItemId = decodeURIComponent(deleteMatch[1]);
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        confirm?: unknown;
      };
      expect(workItemId).toBe("work-item-2");
      expect(body).toEqual({ confirm: true });
      const deletedWorkItem = workItems.find((item) => item.id === workItemId);
      expect(deletedWorkItem).toBeTruthy();
      workItems = workItems.filter((item) => item.id !== workItemId);
      overrides.onDeleteWorkItem?.(workItemId);
      await route.fulfill({ json: envelope({ workItem: deletedWorkItem }) });
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
      const ledgerLimit = Number(url.searchParams.get("limit"));
      expect(ledgerLimit).toBeGreaterThanOrEqual(25);
      overrides.onLedgerLimit?.(ledgerLimit);
      if (overrides.ledgerStatus && overrides.ledgerStatus >= 400) {
        await route.fulfill({
          status: overrides.ledgerStatus,
          json: {
            code: 1,
            message: "Could not load ledger events.",
          },
        });
        return;
      }
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
          events: projectManagerLedgerEvents(ledgerLimit, evidenceAttachedEvent),
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

function projectManagerLedgerEvents(limit: number, evidenceAttachedEvent: unknown[]) {
  const baseEvents = [
    ...evidenceAttachedEvent,
    {
      id: "ledger-trace-old",
      projectId: PROJECT_ID,
      workItemId: "work-item-trace",
      eventType: "copilot_observation_recorded",
      status: "in_progress",
      evidenceRefCount: 1,
      feishuRefCount: 0,
      trace: {
        copilotRunId: "run-old-1",
        pendingActionId: "pm-action-old",
        actionType: "attach_evidence",
        targetType: "work_item",
        targetId: "work-item-trace",
        evidenceRefCount: 1,
        approvalStatus: "approved",
        executionStatus: "succeeded",
      },
      createdAt: 1779374100000,
    },
    {
      id: "ledger-trace",
      projectId: PROJECT_ID,
      workItemId: "work-item-trace",
      eventType: "copilot_observation_recorded",
      status: "done",
      evidenceRefCount: 2,
      feishuRefCount: 0,
      trace: {
        copilotRunId: "run-done-1",
        pendingActionId: "pm-action-done",
        actionType: "update_work_item_status",
        targetType: "work_item",
        targetId: "work-item-trace",
        evidenceRefCount: 2,
        approvalStatus: "approved",
        executionStatus: "succeeded",
      },
      details: {
        rawTerminal: "RAW TERMINAL OUTPUT SHOULD NOT RENDER",
        providerPayload: "RAW PROVIDER PAYLOAD SHOULD NOT RENDER",
        rawLedgerDetails: "RAW LEDGER DETAILS SHOULD NOT RENDER",
      },
      createdAt: 1779374300000,
    },
    {
            id: "ledger-1",
            projectId: PROJECT_ID,
            workItemId: "work-item-1",
            eventType: "work_item_status_changed",
            status: "in_progress",
            evidenceRefCount: 1,
            feishuRefCount: 0,
            createdAt: 1779373600000,
    },
    {
      id: "ledger-3",
      projectId: PROJECT_ID,
      workItemId: "work-item-2",
      eventType: "evidence_attached",
      status: null,
      evidenceRefCount: 1,
      feishuRefCount: 1,
      createdAt: 1779373700000,
    },
    {
      id: "ledger-4",
      projectId: PROJECT_ID,
      workItemId: "work-item-3",
      eventType: "manual_completion_recorded",
      status: "done",
      evidenceRefCount: 0,
      feishuRefCount: 0,
      createdAt: 1779373800000,
    },
    {
      id: "ledger-5",
      projectId: PROJECT_ID,
      workItemId: "work-item-2",
      eventType: "blocker_recorded",
      status: "blocked",
      evidenceRefCount: 0,
      feishuRefCount: 1,
      createdAt: 1779373900000,
    },
    {
      id: "ledger-6",
      projectId: PROJECT_ID,
      workItemId: "work-item-2",
      eventType: "blocker_resolved",
      status: "in_progress",
      evidenceRefCount: 1,
      feishuRefCount: 1,
      createdAt: 1779374000000,
    },
  ];
  const extendedEvents = limit >= 50
    ? [
      ...baseEvents,
      {
        id: "ledger-7",
        projectId: PROJECT_ID,
        workItemId: "work-item-1",
        eventType: "next_step_proposed",
        status: "ready_for_review",
        evidenceRefCount: 1,
        feishuRefCount: 0,
        createdAt: 1779374100000,
      },
    ]
    : baseEvents;

  return extendedEvents;
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
