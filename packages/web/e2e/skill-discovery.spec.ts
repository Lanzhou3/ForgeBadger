import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Run against test/fixtures/skill-browser-server.ts; opt-in because package preview uses public GitHub.
test("Skill discovery, reviewed installation, project handoff and retained restore", async ({
  page,
}) => {
  const authPath = process.env.FORGEBADGER_SKILL_SMOKE_AUTH;
  test.skip(!authPath, "Requires isolated Skill Gateway fixture");
  test.setTimeout(90_000);
  const auth = JSON.parse(await readFile(authPath!, "utf8")) as {
    token: string;
    user: { id: string; email: string };
    projectId: string;
    state: string;
  };
  const gateway =
    process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:49731";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ auth, gateway }) => {
      localStorage.setItem("forgebadger.token", auth.token);
      localStorage.setItem("forgebadger.user", JSON.stringify(auth.user));
      localStorage.setItem("forgebadger-language", "zh-CN");
      window.__FORGEBADGER_RUNTIME__ = { gatewayBaseUrl: gateway };
    },
    { auth, gateway },
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/skills/discover");
  await expect(
    page.getByRole("heading", { name: "发现 Skills" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "来源筛选" }).selectOption("github");
  await page.getByRole("textbox", { name: "搜索 Skills" }).fill("template");
  await expect(
    page.getByRole("heading", { name: "template-skill" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "预览安装" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "已审阅，确认安装" }),
  ).toBeVisible({ timeout: 40_000 });
  await dialog
    .getByRole("combobox", { name: "项目", exact: true })
    .selectOption(auth.projectId);
  await page.screenshot({
    path: "/tmp/skill-review-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/skill-review-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.getByRole("button", { name: "已审阅，确认安装" }).click();
  await expect(
    dialog.getByText("已保存。请在项目配置中预览并同步，使变更生效。"),
  ).toBeVisible();
  await dialog.getByRole("link", { name: "打开项目" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${auth.projectId}$`));
  const selected = await page.request.get(
    `${gateway}/api/v1/projects/${auth.projectId}/skills`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(
    (await selected.json()).data.skills.some(
      (skill: { name: string; isEnabled: boolean }) =>
        skill.name === "template-skill" && skill.isEnabled,
    ),
  ).toBe(true);
  for (const mode of ['preview', 'apply']) {
    const response = await page.request.post(`${gateway}/api/v1/projects/${auth.projectId}/config/sync/${mode}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: { templateId: 'builtin-claude-code', credentialMode: 'host_environment' },
    });
    expect(response.ok()).toBe(true);
  }
  expect(await readFile(`${auth.state}/project/.claude/skills/template-skill/SKILL.md`, 'utf8')).toContain('name: template-skill');
  await page.goto("/skills");
  await expect(page.getByText("template-skill", { exact: true })).toBeVisible();
  const row = page
    .getByText("template-skill", { exact: true })
    .locator("..")
    .locator("..");
  await row.getByRole("button", { name: "预览", exact: true }).click();
  await page.getByRole("button", { name: "预览恢复" }).click();
  await page.getByRole("button", { name: "已审阅，恢复此版本" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("已保存。请在项目配置中预览并同步，使变更生效。"),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.goto("/skills/sources");
  await expect(
    page.getByRole("heading", { name: "Skill 来源管理" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "停用", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "启用并同步" })).toHaveCount(3);
  await page.goto("/skills/discover");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "发现 Skills" }),
  ).toBeVisible();
  await expect(page.getByText("暂时没有匹配的 Skill")).toBeVisible();
  await page.screenshot({
    path: "/tmp/skill-discover-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
