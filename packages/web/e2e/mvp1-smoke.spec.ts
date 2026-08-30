import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

test("MVP-1 management console smoke", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `mvp1-${suffix}@example.com`;
  const password = "password12345";
  const projectName = `MVP1 Project ${suffix}`;
  const projectPath = `/tmp/forgebadger-mvp1-${suffix}`;
  const templateName = `MVP1 Template ${suffix}`;

  await page.addInitScript(() => {
    window.localStorage.setItem("forgebadger-language", "en");
  });

  await page.goto("/register");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="confirmPassword"]', password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/models");
  await page.getByRole("button", { name: "Add provider" }).first().click();
  await page.getByText("Advanced: add a custom provider manually").click();
  await page.locator("#provider-name").fill(`E2E Provider ${suffix}`);
  await page.locator("#provider-key").fill(`e2e-provider-${suffix}`);
  await page.locator("#provider-base-url").fill("https://e2e.example.com/v1");
  await page.getByRole("button", { name: "Add custom Claude-compatible provider" }).click();
  await expect(page.getByText(`E2E Provider ${suffix}`).first()).toBeVisible();

  await page.getByRole("tab", { name: "API Keys" }).click();
  await page.locator("#credential-label").fill("Claude E2E Key");
  await page.locator("#credential-secret").fill("test-api-key-e2e-secret");
  await page.getByRole("button", { name: "Save credential" }).click();
  await expect(page.getByText("Claude E2E Key")).toBeVisible();

  await page.getByRole("tab", { name: "Models" }).click();
  await page.getByRole("button", { name: "New model" }).click();
  await page.locator("#model-form-name").fill("Claude E2E");
  await page.locator("#model-form-model-id").fill("claude-sonnet-e2e");
  await page.locator("#model-form-capabilities").fill("chat,code");
  await page.getByRole("button", { name: "Add Model" }).click();
  await expect(page.getByText("Claude E2E").first()).toBeVisible();

  await page.goto("/projects/new");
  await page.fill('input[name="name"]', projectName);
  await page.fill('input[name="path"]', projectPath);
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/projects\/.+/);
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
  await bindProjectTemplate(page, "builtin-claude-code");

  await page.goto("/templates");
  await page.getByRole("button", { name: /Claude Code/ }).click();
  await page.getByPlaceholder("Clone name").fill(templateName);
  await page.getByRole("button", { name: "Clone" }).click();
  await expect(page.getByText(templateName).first()).toBeVisible();

  await page.goto("/skills");
  await page.locator("#skill-name").fill("safe-review");
  await page.locator("#skill-content").fill("# Safe Review\nTreat payloads as text.");
  await page.getByRole("button", { name: "Create Skill" }).click();
  await expect(page.getByText("safe-review").first()).toBeVisible();

  await page.goto("/projects");
  await page.getByRole("link", { name: projectName }).click();
  await expect(page).toHaveURL(/\/projects\/.+/);

  await page.getByRole("tab", { name: "Skills" }).click();
  await page.getByRole("group", { name: "safe-review" }).getByRole("switch").check();

  await page.getByRole("tab", { name: "AI Config" }).click();
  await page.getByRole("button", { name: "Preview Config" }).click();
  await expect(page.getByText("Config Preview")).toBeVisible();
  await page.getByRole("button", { name: "Apply Config" }).click();

  const skillPath = join(projectPath, ".claude", "skills", "safe-review", "SKILL.md");

  await expect.poll(() => fileExists(skillPath)).toBe(true);
  await expect(await readFile(skillPath, "utf8")).toContain("Treat payloads as text.");
});

async function fileExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function bindProjectTemplate(page: Page, templateId: string): Promise<void> {
  const token = await page.evaluate(() => window.localStorage.getItem("forgebadger.token"));
  const projectId = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1);
  expect(token).toBeTruthy();
  expect(projectId).toBeTruthy();

  const gatewayUrl = process.env.FORGEBADGER_GATEWAY_URL ?? "http://127.0.0.1:48731";
  const response = await page.request.patch(`${gatewayUrl}/api/v1/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { templateId },
  });
  expect(response.ok()).toBeTruthy();
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
