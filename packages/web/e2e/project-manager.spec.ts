import { expect, test } from "@playwright/test";

import { mockProjectDetailApis } from "./project-manager-mocks";

const PROJECT_ID = "project-123";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("forgebadger-language", "en");
    window.localStorage.setItem("forgebadger.token", "e2e-token");
    window.localStorage.setItem(
      "forgebadger.user",
      JSON.stringify({
        id: "user-e2e",
        email: "project-manager-e2e@example.com",
        role: "admin",
        status: "active",
      }),
    );
  });
});

test("renders Copilot-first task supervision view from exact API routes", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Ship v1.2 Project Manager workflow")).toBeVisible();
  await expect(panel.getByTestId("project-manager-item-work-item-1")).toBeVisible();
  await expect(panel.getByTestId("project-manager-item-work-item-2")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Refresh dev tasks" }).first()).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("opens task detail from deep link and renders bounded Copilot trace markers without leaking raw payloads", async ({
  page,
}) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}?tab=project-manager&workItemId=work-item-trace`);

  const panel = page.getByTestId("project-manager-panel");
  await expect(panel).toBeVisible();
  const sheet = page.getByRole("dialog", { name: "Trace Copilot approval chain" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Done").first()).toBeVisible();
  await expect(sheet.getByText(/test.*Traceability E2E.*verified/).first()).toBeVisible();
  await expect(sheet.getByText("session-trace-1", { exact: true }).first()).toBeVisible();
  await expect(sheet.getByText("copilot_observation_recorded", { exact: true })).toBeVisible();
  await expect(sheet.getByText("update_work_item_status", { exact: true })).toBeVisible();
  await expect(sheet.getByText("approved", { exact: true })).toBeVisible();
  await expect(sheet.getByText("succeeded", { exact: true })).toBeVisible();
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
  await expect(
    panel.getByText("Project manager state was not found for this project."),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: "Refresh dev tasks" }).first()).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});

test("filters, quick-adds, transitions, and deletes tasks in the streamlined flow", async ({
  page,
}) => {
  const deletedWorkItemIds: string[] = [];
  const unhandledApiRoutes = await mockProjectDetailApis(page, {
    onDeleteWorkItem: (workItemId) => deletedWorkItemIds.push(workItemId),
  });

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");

  // Quick-add a task with 1-line title input.
  await panel
    .getByPlaceholder("Add a task or requirement, press Enter (or let Copilot plan)…")
    .fill("Confirm trial packet");
  await panel.getByRole("button", { name: "Add" }).click();
  await expect(panel.getByText("Confirm trial packet")).toBeVisible();

  // Filter to Blocked tasks.
  await panel.getByRole("button", { name: "Blocked", exact: true }).click();
  await expect(panel.getByTestId("project-manager-item-work-item-2")).toBeVisible();
  await expect(panel.getByTestId("project-manager-item-work-item-1")).toHaveCount(0);

  // Inspect blocked task, reopen it to In progress, then delete it.
  await panel
    .getByTestId("project-manager-item-work-item-2")
    .getByRole("button", { name: "Review external evidence" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Review external evidence" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Confirm beta evidence caveats")).toBeVisible();

  await sheet.getByRole("button", { name: "Reopen" }).click();
  await expect(sheet.getByText("In progress").first()).toBeVisible();

  await sheet.getByRole("button", { name: "Delete work item" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete work item" });
  await deleteDialog.getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => deletedWorkItemIds).toEqual(["work-item-2"]);
  expect(unhandledApiRoutes).toEqual([]);
});

test("completes an active personal-project task in one click", async ({ page }) => {
  const unhandledApiRoutes = await mockProjectDetailApis(page);

  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole("tab", { name: "Dev Tasks" }).click();

  const panel = page.getByTestId("project-manager-panel");
  const itemRow = panel.getByTestId("project-manager-item-work-item-1");
  await itemRow.getByRole("button", { name: "Mark done" }).click();

  // In default "Active" filter, completed item folds into the Completed group.
  await expect(panel.getByTestId("project-manager-item-work-item-1")).toHaveCount(0);
  await panel.getByRole("button", { name: "All", exact: true }).click();
  await expect(
    panel.getByTestId("project-manager-item-work-item-1").getByText("Done"),
  ).toBeVisible();
  expect(unhandledApiRoutes).toEqual([]);
});
