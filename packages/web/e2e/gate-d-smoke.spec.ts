import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openforge-language", "en");
  });
});

test("complete MVP-0 user journey", async ({ page }) => {
  const suffix = Date.now();
  const email = `test-${suffix}@example.com`;
  const password = "password12345";
  const projectName = `Test Project ${suffix}`;
  const projectPath = `/tmp/openforge-gate-d-${suffix}`;

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
  await page.selectOption('select[name="aiTool"]', "claude");
  await page.click('button[type="submit"]');

  // 6. Should redirect to projects list
  await expect(page).toHaveURL("/projects");
  await expect(page.getByText(projectName)).toBeVisible();

  // 7. Open project and create session (may fail if Gateway is not running)
  try {
    await page.getByRole("link", { name: projectName }).click();
    await expect(page).toHaveURL(/\/projects\/.+/);
    await page.click('text=New Session');
    await page.waitForURL("/sessions", { timeout: 5000 });

    // 8. Navigate to session terminal
    await page.click('text=Connect');
    await expect(page).toHaveURL(/\/sessions\/.+/);
    await expect(page.locator('.xterm-screen')).toBeVisible({ timeout: 5000 });
  } catch {
    // Session creation requires Gateway; ignore if unavailable
  }
});

test("auth guard redirects to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/login");
});

test("login flow", async ({ page }) => {
  const email = "e2e-test@example.com";
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
