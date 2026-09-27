import { expect, test } from "@playwright/test";

// Exercise browser layout, not just DOM presence: a mounted transcript can
// still be unreadable when controls consume its flex height.
for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`history remains readable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(() => {
      localStorage.setItem("forgebadger-language", "zh");
      localStorage.setItem("forgebadger.token", "fixture");
      localStorage.setItem("forgebadger.user", JSON.stringify({ id: "layout-user", email: "layout@example.test", role: "admin", status: "active" }));
    });
    await page.routeWebSocket("**/ws/**", () => {});
    await page.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown;
      if (path === "/api/v1/auth/me") data = { id: "layout-user", email: "layout@example.test", role: "admin", status: "active" };
      else if (path === "/api/v1/notifications") data = { notifications: [] };
      else if (path === "/api/v1/projects") data = { projects: [] };
      else if (path === "/api/v1/copilot/preferences") data = { modelId: null, thinkingEffort: "medium" };
      else if (path === "/api/v1/model-providers") data = { providers: [], credentials: [], models: [{ id: "model", providerName: "测试供应商", name: "历史布局验证模型", isDefault: true, status: "active" }] };
      else if (path === "/api/v1/copilot/conversations") data = { conversations: ["a", "b"].map(id => ({ id, title: `历史会话 ${id}`, status: "active", created_at: Date.now(), updated_at: Date.now() })) };
      else if (path.endsWith("/messages")) {
        const id = path.split("/").at(-2);
        data = { messages: Array.from({ length: 40 }, (_, i) => ({ id: `${id}-${i}`, conversationId: id, userId: "layout-user", role: i % 2 ? "assistant" : "user", kind: "text", content: `会话 ${id} 消息 ${i}：项目分析与验证记录。`, sequence: i + 1, createdAt: new Date().toISOString() })) };
      } else if (path.endsWith("/runs")) data = { runs: [], activeRun: null };
      else if (path.endsWith("/followups")) data = { followups: [] };
      else throw new Error(`Unexpected API: ${path}`);
      await route.fulfill({ json: { code: 0, data, message: "" } });
    });
    await page.goto("/copilot?c=a");
    await expect(page).toHaveURL(/copilot\?c=a$/);
    await expect(page).toHaveTitle("ForgeBadger");
    const history = page.getByTestId("copilot-message-history");
    await expect(history.getByText("会话 a 消息 39：项目分析与验证记录。", { exact: true })).toBeInViewport();
    const height = await history.evaluate(el => el.clientHeight);
    expect(height).toBeGreaterThan(viewport.height * 0.6);
    await expect(page.getByTestId("copilot-composer")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(await page.locator("#main-content").evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);

    await history.evaluate(el => el.scrollTo({ top: 0, behavior: "instant" }));
    await expect(history.getByText("会话 a 消息 0：项目分析与验证记录。", { exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "执行选项", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("checkbox", { name: /任务结束后自动只读复核/ }).check();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    expect(await history.evaluate(el => el.clientHeight)).toBe(height);
    await expect(history.getByText("会话 a 消息 0：项目分析与验证记录。", { exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "执行选项", exact: true }).click();
    await expect(dialog.getByRole("checkbox", { name: /任务结束后自动只读复核/ })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    for (const id of ["b", "a"]) {
      if (viewport.width < 768) await page.getByRole("button", { name: "对话", exact: true }).click();
      const navigation = viewport.width < 768 ? page.getByRole("dialog") : page.locator("#main-content");
      await navigation.getByText(`历史会话 ${id}`, { exact: true }).first().click();
      await expect(history.getByText(`会话 ${id} 消息 39：项目分析与验证记录。`, { exact: true })).toBeInViewport();
      await history.evaluate(el => el.scrollTo({ top: 0, behavior: "instant" }));
      await expect(history.getByText(`会话 ${id} 消息 0：项目分析与验证记录。`, { exact: true })).toBeInViewport();
    }
    expect(errors).toEqual([]);
  });
}
