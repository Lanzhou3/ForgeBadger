import { expect, test, type Page } from "@playwright/test";

async function mockGateway(page: Page, options: {
  browserPlatform?: string; gatewayPlatform?: string; installed?: string[]; mode?: string;
} = {}) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(options => {
    Object.defineProperty(navigator, "platform", { value: options.browserPlatform ?? "MacIntel" });
    localStorage.setItem("forgebadger.token", "appearance-shell-qa");
    localStorage.setItem("forgebadger-language", "en");
    if (!localStorage.getItem("forgebadger.color-mode")) {
      localStorage.setItem("forgebadger.color-mode", options.mode ?? "system");
    }
  }, options);
  const session = { id: "shell-qa", projectId: "qa-project", projectName: "Shell QA", aiTool: "terminal",
    name: "Shell QA", status: "running", attachToken: "qa-attach", createdAt: new Date().toISOString() };
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: object = {};
    if (path === "/api/v1/auth/me") data = { id: "qa-user", email: "qa@example.test", role: "admin", status: "active" };
    else if (path === "/api/v1/sessions/shells") data = { platform: options.gatewayPlatform ?? "linux",
      shells: ["sh", "bash", "zsh", "pwsh", "powershell", "cmd"].map(shell => ({ shell, command: shell,
        available: (options.installed ?? ["bash"]).includes(shell) })) };
    else if (path === "/api/v1/adapters/discovery") data = { adapters: [] };
    else if (path === "/api/v1/sessions") data = { sessions: [session] };
    else if (path === "/api/v1/sessions/shell-qa" || path.endsWith("/connect")) data = { session };
    else if (path.endsWith("/writer")) data = { mode: "manual" };
    else if (path.includes("task-packets")) data = { taskPackets: [] };
    else if (path.includes("notifications")) data = { notifications: [], unreadCount: 0 };
    else if (path.includes("git")) data = { git: { isGitRepo: false, files: [] } };
    else if (path.includes("projects")) data = { projects: [], project: { id: "qa-project", name: "Shell QA", rootPath: "/tmp/shell-qa" } };
    await route.fulfill({ json: { code: 0, data, message: "" } });
  });
  await page.routeWebSocket("**/ws/**", socket => {
    if (!socket.url().includes("/terminal/")) return;
    let sent = false;
    socket.onMessage(() => {
      if (sent) return;
      sent = true;
      socket.send(JSON.stringify({ type: "terminal_history_end", payload: { sequence: 1, data: "" } }));
    });
  });
  return errors;
}

for (const initial of ["system", "dark"]) {
  test(`uses theme cards for manual colors and can resume following OS after initial ${initial}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const errors = await mockGateway(page, { mode: initial });
    await page.goto("/settings?section=appearance");
    await expect(page.getByRole("heading", { name: "Appearance & Preferences" })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);
    const systemSwitch = page.getByRole("switch", { name: "System", exact: true });
    if (initial === "system") await systemSwitch.click();
    await expect(systemSwitch).not.toBeChecked();
    await page.getByRole("button", { name: "GitHub Light", exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.locator("[data-theme-choice][aria-pressed=true]")).toHaveCount(1);
    await page.emulateMedia({ colorScheme: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.getByRole("button", { name: "GitHub Light", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("forgebadger.color-mode"))).toBe("light");
    const lightColor = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.id = "dark-utility-probe";
      probe.className = "dark:text-amber-300";
      const parent = document.createElement("div");
      parent.style.color = "rgb(0, 0, 0)";
      parent.appendChild(probe);
      document.body.appendChild(parent);
      return getComputedStyle(probe).color;
    });
    expect(lightColor).toBe("rgb(0, 0, 0)");
    await page.getByRole("button", { name: "One Dark", exact: true }).click();
    expect(await page.locator("#dark-utility-probe").evaluate(el => getComputedStyle(el).color)).not.toBe(lightColor);
    await systemSwitch.click();
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.getByRole("button", { name: "GitHub Light", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByRole("button", { name: "One Dark", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(systemSwitch).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem("forgebadger.color-mode"))).toBe("system");
    expect(errors).toEqual([]);
  });
}

test("separates the active theme from system preferences and persists both palettes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const errors = await mockGateway(page, { mode: "system" });
  await page.goto("/settings?section=appearance");
  await expect(page.getByRole("button", { name: "One Dark", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "GitHub Light", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Tokyo Night", exact: true }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(26, 27, 38)");
  await page.getByRole("button", { name: "Solarized Light", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tokyo Night", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Solarized Light", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Preferred", { exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(238, 232, 213)");
  await expect(page.getByRole("button", { name: "Solarized Light", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("switch", { name: "System", exact: true }).click();
  await page.getByRole("button", { name: "Solarized Light", exact: true }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(238, 232, 213)");
  expect(await page.evaluate(() => localStorage.getItem("forgebadger.color-mode"))).toBe("light");
  await page.reload();
  await expect(page.getByRole("button", { name: "Solarized Light", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "GitHub Light", exact: true }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 248, 250)");
  await page.getByRole("button", { name: "One Dark", exact: true }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(40, 44, 52)");
  expect(await page.evaluate(() => localStorage.getItem("forgebadger.dark-theme"))).toBe("one-dark");
  expect(await page.evaluate(() => localStorage.getItem("forgebadger.light-theme"))).toBe("github-light");
  expect(errors).toEqual([]);
});

for (const scenario of [
  { browserPlatform: "Win32", gatewayPlatform: "linux", installed: ["bash"], selected: "bash" },
  { browserPlatform: "MacIntel", gatewayPlatform: "win32", installed: ["powershell", "cmd"], selected: "powershell" },
]) {
  test(`offers Gateway shells for ${scenario.browserPlatform} browser and ${scenario.gatewayPlatform} Gateway`, async ({ page }) => {
    const errors = await mockGateway(page, scenario);
    await page.goto("/sessions/shell-qa?attachToken=qa-attach");
    await expect(page.getByTestId("terminal-host")).toBeVisible();
    await page.getByRole("button", { name: "New session · Shell QA", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(dialog.locator("#launch-shell")).toHaveValue(scenario.selected);
    await expect(dialog.getByRole("button", { name: "New session", exact: true })).toBeEnabled();
    const available = await dialog.locator("#launch-shell option:enabled").evaluateAll(options => options.map(el => (el as HTMLOptionElement).value));
    expect(available).toEqual(scenario.installed);
    await page.screenshot({ path: `/tmp/forgebadger-shell-${scenario.gatewayPlatform}.png` });
    expect(errors).toEqual([]);
  });
}
