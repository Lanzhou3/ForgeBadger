import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("forgebadger-language", "en");
  });
});

test("complete MVP-0 user journey", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `test-${suffix}@example.com`;
  const password = "password12345";
  const projectName = `Test Project ${suffix}`;
  const projectPath = `/tmp/forgebadger-gate-d-${suffix}`;

  // 1. Visit register page
  await page.goto("/register");

  // 2. Register a new user
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="confirmPassword"]', password);
  await page.click('button[type="submit"]');

  // 3. Should redirect to dashboard
  await expect(page).toHaveURL("/");
  await expect(page.locator('h1', { hasText: 'Dashboard' })).toBeVisible();

  // 4. Navigate to Projects
  await page.click('text=Projects');
  await expect(page).toHaveURL("/projects");

  // 5. Create a project
  await page.click('text=New Project');
  await expect(page).toHaveURL("/projects/new");
  await page.fill('input[name="name"]', projectName);
  await page.fill('input[name="path"]', projectPath);
  await page.click('button[type="submit"]');

  // 6. Should redirect to project details
  await expect(page).toHaveURL(/\/projects\/.+/);
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

  // 7. Open the session launch dialog, pick the runtime CLI, and create a session
  const runtimeAdapterSelect = page.locator("#runtime-adapter");
  await expect(runtimeAdapterSelect).toBeEnabled({ timeout: 5000 });
  // The runtime CLI picker is a Radix-based dropdown (to show CLI logos), so
  // select by opening the listbox and clicking the option.
  await runtimeAdapterSelect.click();
  await page.getByRole("option", { name: /Claude Code/ }).click();
  await page.getByRole("button", { name: "New Session" }).click();
  const launchDialog = page.getByRole("dialog");
  await expect(launchDialog).toBeVisible();
  await expect(launchDialog.locator("#launch-adapter")).toHaveValue("claude");
  await launchDialog.getByRole("button", { name: "New Session" }).click();

  // 8. Session creation navigates straight to the session terminal
  await page.waitForURL(/\/sessions\/.+/, { timeout: 5000 });
  await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 5000 });
});

test("auth guard redirects to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/login");
});

test("login flow", async ({ page }) => {
  const email = `e2e-test-${uniqueSuffix()}@example.com`;
  const password = "password12345";

  // Register first via UI to ensure user exists
  await page.goto("/register");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="confirmPassword"]', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/");

  // Logout
  await page.click('[aria-label="Log out"]');
  await page.waitForURL("/login");

  // Login with existing user
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/");
  await expect(page.locator('h1', { hasText: 'Dashboard' })).toBeVisible();
});

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
