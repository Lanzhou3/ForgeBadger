import { mkdir } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { fillRecoveryKey } from "./register-user";

test.describe.configure({ mode: "serial" });

test("first-value flow creates projects without CLI/template binding, runs an idle task session, and exports a manual handoff", async ({ context, page }) => {
  test.setTimeout(120_000);
  const suffix = uniqueSuffix();
  const password = "password12345";
  const projectName = `First value ${suffix}`;
  const projectPath = `/tmp/forgebadger-first-value-${suffix}`;
  const importedPath = `/tmp/forgebadger-first-value-import-${suffix}`;
  const terminalFrames: string[] = [];

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => window.localStorage.setItem("forgebadger-language", "en"));
  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => terminalFrames.push(frame.payload));
  });

  await page.goto("/register");
  await page.locator('input[name="email"]').fill(`first-value-${suffix}@example.com`);
  await fillRecoveryKey(page);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/projects/new");
  await page.locator('input[name="name"]').fill(projectName);
  await page.locator('input[name="path"]').fill(projectPath);
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  const createdProjectUrl = page.url();

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Start first session" })).toBeVisible();

  await mkdir(importedPath, { recursive: true });
  await page.goto("/projects/import");
  await page.locator('input[name="path"]').fill(importedPath);
  await page.getByRole("button", { name: "Scan Directory" }).click();
  await page.getByRole("button", { name: "Import Project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);

  await page.goto(createdProjectUrl);
  await page.getByRole("tab", { name: "Dev Tasks" }).click();
  const manager = page.getByTestId("project-manager-panel");
  await manager
    .getByPlaceholder("Add a task or requirement, press Enter (or let Copilot plan)…")
    .fill("Verify manual task handoff");
  await manager.getByRole("button", { name: "Add" }).click();
  await manager.getByRole("button", { name: "Verify manual task handoff" }).click();

  const taskPacket = page.getByTestId("project-manager-task-packet");
  await expect(taskPacket).toBeVisible();
  await taskPacket.getByRole("button", { name: "Run in CLI" }).click();
  await page.getByRole("button", { name: "Create task session" }).click();
  await expect(page).toHaveURL(/\/sessions\/.+/);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Generate handoff pack" }).click();
  const exportPanel = page.getByTestId("session-handoff-export");
  await expect(exportPanel).toBeVisible();
  await exportPanel.getByLabel("Operator notes").fill("Created the idle task session and reviewed the bounded packet.");
  await exportPanel.getByLabel("Verification notes").fill("Confirmed configuration compliance and connected the terminal manually.");
  await expect(exportPanel.getByRole("button", { name: "Copy Markdown" })).toBeVisible();
  await exportPanel.getByRole("button", { name: "Copy Markdown" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportPanel.getByRole("button", { name: "Download Markdown" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^forgebadger-session-handoff-.*\.md$/);
  expect(terminalFrames.some((frame) => frame.includes("Verify manual task handoff"))).toBe(false);
});

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
