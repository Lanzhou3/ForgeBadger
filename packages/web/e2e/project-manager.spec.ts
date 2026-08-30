import { expect, test } from "@playwright/test";

import { mockProjectDetailApis } from "./project-manager-mocks";

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
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Dev Tasks" })).toBeVisible();
  await expect(panel.getByText("Ship v1.2 Project Manager workflow")).toBeVisible();
  await panel.getByRole("button", { name: "Table" }).click();
  await expect(panel.getByRole("row", { name: /Expose Project Manager tab/ })).toBeVisible();
  const ledger = panel.getByTestId("project-manager-ledger");
  await ledger.getByRole("button", { name: "Toggle ledger" }).click();
  await expect(ledger.getByText("Work item status changed")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Refresh dev tasks" }).first()).toBeVisible();
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
  await expect(sheet.locator("div").filter({ hasText: /^Session$/ }).first()).toBeVisible();
  await expect(sheet.getByText("session-trace-1", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Ledger", { exact: true })).toBeVisible();
  await expect(sheet.getByText("copilot_observation_recorded", { exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  const ledger = panel.getByTestId("project-manager-ledger");
  await ledger.getByRole("button", { name: "Toggle ledger" }).click();
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
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await expect(panel.getByText("Project manager state was not found for this project.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Refresh dev tasks" }).first()).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("saves a Project Manager goal update through the exact API route", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

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
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await panel.getByRole("button", { name: "Table" }).click();
  await panel.getByLabel("Filter by status").click();
  await page.getByRole("option", { name: "Blocked" }).click();
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
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

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
    .click();
  await panel.getByTestId("project-manager-board-card-work-item-3")
    .getByLabel("Select work item")
    .click();
  await panel.getByLabel("Batch target status").click();
  await page.getByRole("option", { name: "Ready for review" }).click();
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
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

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
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await panel.getByRole("button", { name: "Table" }).click();
  await panel.getByLabel("Filter by status").click();
  await page.getByRole("option", { name: "Blocked" }).click();
  await panel.getByRole("button", { name: "View details" }).click();

  const sheet = page.getByRole("dialog", { name: "Review external evidence" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Kind").fill("report");
  await sheet.getByLabel("Label").fill("Phase 11 evidence");
  await sheet.getByRole("textbox", { name: "Reference" }).fill("PMEV-01");
  await sheet.getByLabel("Path").fill("docs/reports/phase-11-evidence.md");
  await sheet.getByRole("button", { name: "Attach evidence" }).click();

  await expect(sheet.getByText("PMEV-01")).toBeVisible();
  await expect(sheet.getByText("docs/reports/phase-11-evidence.md")).toBeVisible();
  await expect(panel.locator("tbody tr", { hasText: "Review external evidence" }).locator("td").nth(3)).toHaveText("1");
  expect(unhandledApiRoutes).toEqual([]);
});

test("attaches workspace evidence references from work item details", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await panel.getByRole("button", { name: "Table" }).click();
  await panel.getByLabel("Filter by status").click();
  await page.getByRole("option", { name: "Blocked" }).click();
  await panel.getByRole("button", { name: "View details" }).click();

  const sheet = page.getByRole("dialog", { name: "Review external evidence" });
  await expect(sheet).toBeVisible();

  await sheet.getByLabel("Reference type").selectOption("file_path");
  await sheet.getByLabel("Path").fill("packages/web/src/components/projects/WorkspaceContextPanel.tsx");
  await sheet.getByRole("button", { name: "Attach evidence" }).click();
  await expect(sheet.getByText("file_path")).toBeVisible();
  await expect(sheet.getByText("packages/web/src/components/projects/WorkspaceContextPanel.tsx")).toBeVisible();

  await sheet.getByLabel("Reference type").selectOption("terminal_snapshot");
  await sheet.getByLabel("Session ID").fill("session-trace-1");
  await sheet.getByRole("button", { name: "Attach evidence" }).click();
  await expect(sheet.getByRole("listitem").filter({ hasText: "terminal-snapshot:session-trace-1:latest" })).toBeVisible();

  await sheet.getByLabel("Reference type").selectOption("session");
  await sheet.getByLabel("Session ID").fill("session-trace-1");
  await sheet.getByRole("button", { name: "Attach evidence" }).click();
  await expect(sheet.getByRole("listitem").filter({ hasText: "session:session-trace-1" })).toBeVisible();
  await expect(panel.locator("tbody tr", { hasText: "Review external evidence" }).locator("td").nth(3)).toHaveText("3");
  expect(unhandledApiRoutes).toEqual([]);
});

test("blocks raw terminal text in workspace evidence references", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await panel.getByRole("button", { name: "Table" }).click();
  await panel.getByLabel("Filter by status").click();
  await page.getByRole("option", { name: "Blocked" }).click();
  await panel.getByRole("button", { name: "View details" }).click();

  const sheet = page.getByRole("dialog", { name: "Review external evidence" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Reference type").selectOption("terminal_snapshot");
  await sheet.getByLabel("Session ID").fill("session-trace-1");
  await sheet.getByRole("textbox", { name: "Reference" }).fill("$ claude --dangerously-skip-permissions\nstdout: secret output");
  await sheet.getByRole("button", { name: "Attach evidence" }).click();

  await expect(sheet.getByText("Use a short reference or path, not raw output or secrets.")).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("keeps safe evidence draft values visible after attach failure", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page, { evidenceAttachStatus: 500 });

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await panel.getByRole("button", { name: "Table" }).click();
  await panel.getByLabel("Filter by status").click();
  await page.getByRole("option", { name: "Blocked" }).click();
  await panel.getByRole("button", { name: "View details" }).click();

  const sheet = page.getByRole("dialog", { name: "Review external evidence" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Kind").fill("report");
  await sheet.getByLabel("Label").fill("Phase 11 evidence");
  await sheet.getByRole("textbox", { name: "Reference" }).fill("PMEV-01");
  await sheet.getByLabel("Path").fill("docs/reports/phase-11-evidence.md");
  await sheet.getByRole("button", { name: "Attach evidence" }).click();

  await expect(sheet.getByText("Could not attach evidence reference.")).toBeVisible();
  await expect(sheet.getByLabel("Kind")).toHaveValue("report");
  await expect(sheet.getByLabel("Label")).toHaveValue("Phase 11 evidence");
  await expect(sheet.getByRole("textbox", { name: "Reference" })).toHaveValue("PMEV-01");
  await expect(sheet.getByLabel("Path")).toHaveValue("docs/reports/phase-11-evidence.md");
  await expect(sheet).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("completes the v1.2 Project Manager workflow under strict route mocks", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await expect(panel.getByText("Ship v1.2 Project Manager workflow")).toBeVisible();
  await panel.getByRole("button", { name: "Table" }).click();
  const workItemRow = panel.getByRole("row", { name: /Review external evidence/ });
  await expect(workItemRow).toBeVisible();
  await workItemRow.getByRole("button", { name: "View details" }).click();

  const sheet = page.getByRole("dialog", { name: "Review external evidence" });
  await sheet.getByLabel("Kind").fill("report");
  await sheet.getByLabel("Label").fill("Phase 11 evidence");
  await sheet.getByRole("textbox", { name: "Reference" }).fill("PMEV-01");
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
  await ledger.getByRole("button", { name: "Toggle ledger" }).click();
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
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  const ledger = panel.getByTestId("project-manager-ledger");
  await ledger.getByRole("button", { name: "Toggle ledger" }).click();
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
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await expect(panel.getByText("Ship v1.2 Project Manager workflow")).toBeVisible();
  await expect(panel.getByText("Expose Project Manager tab")).toBeVisible();
  const ledger = panel.getByTestId("project-manager-ledger");
  await ledger.getByRole("button", { name: "Toggle ledger" }).click();
  await expect(ledger.getByText("Could not load ledger events.")).toBeVisible();
  await expect(ledger.getByRole("button", { name: "Refresh ledger" })).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});
