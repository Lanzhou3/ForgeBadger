import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("first-value flow uses Gateway config sync, an idle task session, and manual handoff export", async ({ context, page }) => {
  test.setTimeout(120_000);
  const suffix = uniqueSuffix();
  const password = "password12345";
  const projectName = `First value ${suffix}`;
  const projectPath = `/tmp/openforge-first-value-${suffix}`;
  const importedPath = `/tmp/openforge-first-value-import-${suffix}`;
  const conflictPath = `/tmp/openforge-first-value-conflict-${suffix}`;
  const terminalFrames: string[] = [];

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => window.localStorage.setItem("openforge-language", "en"));
  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => terminalFrames.push(frame.payload));
  });

  await page.goto("/register");
  await page.locator('input[name="email"]').fill(`first-value-${suffix}@example.com`);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/projects/new");
  await page.locator('input[name="name"]').fill(projectName);
  await page.locator('input[name="path"]').fill(projectPath);
  await page.locator("#project-ai-tool").selectOption("claude");
  await page.locator("#config-template").selectOption("builtin-claude-code");
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  const createdProjectUrl = page.url();

  await expect.poll(() => fileExists(join(projectPath, "CLAUDE.md"))).toBe(true);
  await page.getByRole("button", { name: "Check Compliance" }).click();
  await expect(page.getByText("Compliant")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Start first session" })).toBeVisible();

  await mkdir(importedPath, { recursive: true });
  await page.goto("/projects/import");
  await page.locator('input[name="path"]').fill(importedPath);
  await page.getByRole("button", { name: "Scan Directory" }).click();
  await page.getByRole("button", { name: "Import Project" }).click();
  await page.locator("#project-ai-tool").selectOption("codex");
  await page.locator("#config-template").selectOption("builtin-codex");
  await page.getByRole("button", { name: "Import Project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  await expect.poll(() => fileExists(join(importedPath, ".codex", "config.toml"))).toBe(true);

  await mkdir(conflictPath, { recursive: true });
  await writeFile(join(conflictPath, "AGENTS.md"), "# Keep this existing instruction\n", "utf8");
  await page.goto("/projects/import");
  await page.locator('input[name="path"]').fill(conflictPath);
  await page.getByRole("button", { name: "Scan Directory" }).click();
  await page.getByRole("button", { name: "Import Project" }).click();
  await page.locator("#project-ai-tool").selectOption("codex");
  await page.locator("#config-template").selectOption("builtin-codex");
  await page.getByRole("button", { name: "Import Project" }).click();
  await expect(page).toHaveURL(/configStatus=needs_review/);
  await expect(readFile(join(conflictPath, "AGENTS.md"), "utf8")).resolves.toBe("# Keep this existing instruction\n");
  await expect.poll(() => fileExists(join(conflictPath, ".codex", "config.toml"))).toBe(false);

  await page.goto(createdProjectUrl);
  await page.getByRole("tab", { name: "Project Manager" }).click();
  const manager = page.getByTestId("project-manager-panel");
  await manager.getByRole("button", { name: "Create work item" }).click();
  const dialog = page.getByRole("dialog", { name: "Create work item" });
  await dialog.getByLabel("Title").fill("Verify manual task handoff");
  await dialog.getByLabel("Acceptance criteria").fill("Task session remains idle\nPrompt stays manual");
  await dialog.getByRole("button", { name: "Create work item" }).click();
  await manager.getByRole("button", { name: "Table" }).click();
  await manager.getByRole("row", { name: /Verify manual task handoff/ }).getByRole("button", { name: "View details" }).click();

  const taskPacket = page.getByTestId("project-manager-task-packet");
  await expect(taskPacket).toBeVisible();
  await taskPacket.getByRole("button", { name: "Create task session" }).click();
  await expect(taskPacket.getByRole("link", { name: "Open linked session" })).toBeVisible();
  await taskPacket.getByRole("link", { name: "Open linked session" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 10_000 });

  const exportPanel = page.getByTestId("session-handoff-export");
  await exportPanel.getByLabel("Operator notes").fill("Created the idle task session and reviewed the bounded packet.");
  await exportPanel.getByLabel("Verification notes").fill("Confirmed configuration compliance and connected the terminal manually.");
  await expect(exportPanel.getByRole("button", { name: "Copy Markdown" })).toBeVisible();
  await exportPanel.getByRole("button", { name: "Copy Markdown" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportPanel.getByRole("button", { name: "Download Markdown" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^openforge-session-handoff-.*\.md$/);
  expect(terminalFrames.some((frame) => frame.includes("Verify manual task handoff"))).toBe(false);
  await expect(readFile(join(projectPath, "CLAUDE.md"), "utf8")).resolves.toContain("OpenForge");
});

async function fileExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
