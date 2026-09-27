import { expect, test, type Page } from "@playwright/test";

// Real tokens have 48 hex digits. Short placeholders miss intrinsic grid overflow.
const plaintext = `fbmcp_${"a".repeat(48)}`;

async function mockMcpSettings(page: Page) {
  const user = { id: "mcp-qa", email: "mcp-qa@example.test", role: "user", status: "active" };
  await page.addInitScript(user => {
    localStorage.setItem("forgebadger-language", "zh-CN");
    localStorage.setItem("forgebadger.token", "fixture");
    localStorage.setItem("forgebadger.user", JSON.stringify(user));
  }, user);
  await page.routeWebSocket("**/ws/**", () => {});
  await page.route("**/api/v1/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    let data: unknown;
    if (pathname === "/api/v1/auth/me") data = user;
    else if (pathname === "/api/v1/mcp") data = { enabled: true, endpoint: "http://127.0.0.1:48731/mcp" };
    else if (pathname === "/api/v1/projects") data = { projects: [{ id: "p1", name: "Test project", path: "/projects/test" }] };
    else if (pathname === "/api/v1/mcp/tokens") {
      data = route.request().method() === "POST"
        ? { token: { id: "t1", name: "layout-test", projectIds: ["p1"], scopes: ["read"], expiresAt: null, revoked: false }, plaintext }
        : { tokens: [] };
    } else if (pathname === "/api/v1/notifications") data = { notifications: [], unreadCount: 0 };
    else if (pathname.endsWith("/unread-count")) data = { count: 0 };
    else if (pathname === "/api/v1/copilot/status") data = { enabled: false };
    else throw new Error(`Unhandled MCP fixture request: ${pathname}`);
    await route.fulfill({ json: { code: 0, data, message: "" } });
  });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 1024, height: 500 }]) {
  test(`full-length MCP token stays inside the dialog at ${viewport.width}x${viewport.height}`, async ({ page, context }, testInfo) => {
    await page.setViewportSize(viewport);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mockMcpSettings(page);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/settings?section=integrations");
    await expect(page).toHaveTitle("ForgeBadger");
    await page.getByLabel("名称", { exact: true }).fill("layout-test");
    await page.getByLabel("Test project", { exact: true }).click();
    await page.getByRole("button", { name: "创建令牌", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Wait for Radix's opening animation before taking geometric measurements.
    await expect(dialog).toHaveCSS("opacity", "1");
    const bounds = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
        children: [...element.children].map(child => {
          const box = child.getBoundingClientRect();
          return { left: box.left, right: box.right };
        }),
      };
    });
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
    expect(bounds.top).toBeGreaterThanOrEqual(15);
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height - 15);
    for (const child of bounds.children) {
      expect(child.left).toBeGreaterThanOrEqual(bounds.left);
      expect(child.right).toBeLessThanOrEqual(bounds.right);
    }
    await dialog.getByRole("button", { name: "MCP 客户端 JSON 配置", exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copied).mcpServers.forgebadger.headers.Authorization).toBe(`Bearer ${plaintext}`);
    const snippet = dialog.locator("pre");
    expect(await snippet.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("mcp-token-dialog.png") });
    const close = dialog.getByRole("button", { name: "关闭", exact: true });
    await close.scrollIntoViewIfNeeded();
    await expect(close).toBeInViewport();
    await close.click();
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
