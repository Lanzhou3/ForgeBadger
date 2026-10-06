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
    localStorage.setItem("forgebadger.color-mode", options.mode ?? "system");
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
  test(`keeps manual colors and can resume following OS after initial ${initial}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const errors = await mockGateway(page, { mode: initial });
    await page.goto("/settings?section=appearance");
    await expect(page.getByRole("heading", { name: "Appearance & Preferences" })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("forgebadger.color-mode"))).toBe("light");
    // Exercise the actual compiled Tailwind dark utility with OS still dark.
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
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    expect(await page.locator("#dark-utility-probe").evaluate(el => getComputedStyle(el).color)).not.toBe(lightColor);
    await page.getByRole("button", { name: "System", exact: true }).click();
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByRole("button", { name: "System", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("forgebadger.color-mode"))).toBe("system");
    await page.screenshot({ path: `/tmp/forgebadger-appearance-${initial}.png` });
    expect(errors).toEqual([]);
  });
}

for (const scenario of [
  { browserPlatform: "Win32", gatewayPlatform: "linux", installed: ["bash"], selected: "bash" },
  { browserPlatform: "MacIntel", gatewayPlatform: "win32", installed: ["powershell", "cmd"], selected: "powershell" },
]) {
  test(`offers Gateway shells for ${scenario.browserPlatform} browser and ${scenario.gatewayPlatform} Gateway`, async ({ page }) => {
    const errors = await mockGateway(page, scenario);
    await page.goto("/sessions/shell-qa?attachToken=qa-attach");
    await expect(page.getByTestId("terminal-host")).toBeVisible();
    await page.getByRole("button", { name: "New Session · Shell QA", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(dialog.locator("#launch-shell")).toHaveValue(scenario.selected);
    await expect(dialog.getByRole("button", { name: "New Session", exact: true })).toBeEnabled();
    const available = await dialog.locator("#launch-shell option:enabled").evaluateAll(options => options.map(el => (el as HTMLOptionElement).value));
    expect(available).toEqual(scenario.installed);
    await page.screenshot({ path: `/tmp/forgebadger-shell-${scenario.gatewayPlatform}.png` });
    expect(errors).toEqual([]);
  });
}
