import { describe, expect, it } from "vitest";

import { getTranslation, normalizeLanguage } from "./i18n";

describe("i18n", () => {
  it("returns localized labels for each supported language", () => {
    expect(getTranslation("zh-CN", "settings.title")).toBe("设置");
    expect(getTranslation("zh-TW", "settings.title")).toBe("設定");
    expect(getTranslation("en", "settings.title")).toBe("Settings");
    expect(getTranslation("zh-CN", "projects.configNeedsReviewTitle")).toBe("配置需要处理");
    expect(getTranslation("zh-TW", "projects.configNeedsReviewTitle")).toBe("設定需要處理");
    expect(getTranslation("en", "projects.configNeedsReviewTitle")).toBe("Config needs review");
    expect(getTranslation("zh-CN", "sessions.searchPlaceholder")).toBe("搜索会话、项目或工具");
    expect(getTranslation("zh-TW", "sessions.searchPlaceholder")).toBe("搜尋會話、專案或工具");
    expect(getTranslation("en", "sessions.searchPlaceholder")).toBe("Search sessions, projects, or tools");
    expect(getTranslation("zh-CN", "projects.overwrite")).toBe("覆盖");
    expect(getTranslation("zh-TW", "projects.overwrite")).toBe("覆蓋");
    expect(getTranslation("en", "projects.overwrite")).toBe("Overwrite");
    expect(getTranslation("zh-CN", "notifications.title")).toBe("通知");
    expect(getTranslation("zh-TW", "notifications.title")).toBe("通知");
    expect(getTranslation("en", "notifications.title")).toBe("Notifications");
    expect(getTranslation("zh-CN", "plugins.explanationTitle")).toBe("插件 Tab 是什么");
    expect(getTranslation("en", "plugins.materializationNote")).toContain("--plugin-dir");
    expect(getTranslation("zh-CN", "nav.members")).toBe("成员");
    expect(getTranslation("zh-TW", "members.accessDeniedTitle")).toBe("需要管理員權限");
    expect(getTranslation("en", "members.admin")).toBe("Admin");
    expect(getTranslation("zh-CN", "agents.quickCreateTemplates")).toBe("快速创建模板");
    expect(getTranslation("en", "agents.templatesDescription")).toContain("prefills");
    expect(getTranslation("zh-CN", "skills.quickCreateTemplates")).toBe("快速创建模板");
    expect(getTranslation("en", "skills.templatesDescription")).toContain("SKILL.md");
    expect(getTranslation("zh-CN", "projects.configCompliance")).toBe("配置合规");
    expect(getTranslation("zh-TW", "projects.staleFiles")).toBe("過期");
    expect(getTranslation("en", "projects.checkCompliance")).toBe("Check Compliance");
    expect(getTranslation("zh-CN", "templates.catalogInstall")).toBe("从目录安装");
    expect(getTranslation("en", "templates.catalogEmpty")).toContain("catalog");
    expect(getTranslation("zh-CN", "nav.history")).toBe("历史");
    expect(getTranslation("zh-TW", "snapshots.title")).toBe("歷史快照");
    expect(getTranslation("en", "snapshots.noTerminalHistory")).toContain("terminal scrollback");
    expect(getTranslation("zh-CN", "nav.usage")).toBe("使用统计");
    expect(getTranslation("en", "usage.estimatedCostNotice")).toContain("estimates");
    expect(getTranslation("zh-CN", "skills.catalogInstall")).toContain("目录");
    expect(getTranslation("en", "skills.discoveryRoots")).toContain("Scan roots");
    expect(getTranslation("zh-CN", "skills.discoveryHint")).toContain("OPENFORGE_SKILL_DIRS");
    expect(getTranslation("en", "plugins.catalogInstalled")).toContain("disabled");
    expect(getTranslation("zh-CN", "plugins.whatItDoes")).toContain("Claude Code");
    expect(getTranslation("en", "plugins.whatItDoes")).toContain("skills");
    expect(getTranslation("zh-CN", "common.visibility")).toBe("可见性");
    expect(getTranslation("en", "visibility.sharedDescription")).toContain("local instance");
    expect(getTranslation("zh-CN", "commandPalette.title")).toBe("命令面板");
    expect(getTranslation("en", "sessions.focusMode")).toBe("Focus mode");
    expect(getTranslation("zh-CN", "models.applyTargets")).toBe("可应用到 CLI");
    expect(getTranslation("zh-CN", "models.deleteProviderInlineLabel")).toBe("删除服务商");
    expect(getTranslation("zh-TW", "models.deleteProviderConfirm")).toContain("供應商");
    expect(getTranslation("en", "models.codexOfficialDocs")).toContain("OpenAI Codex docs");
    expect(getTranslation("zh-CN", "codexAppServer.title")).toBe("Codex 后台任务");
    expect(getTranslation("zh-TW", "codexAppServer.turnDisabled")).toBe("任務輸入已關閉");
    expect(getTranslation("en", "codexAppServer.turnDisabled")).toBe("Task input disabled");
  });

  it("normalizes unsupported language values to Simplified Chinese", () => {
    expect(normalizeLanguage("fr")).toBe("zh-CN");
    expect(normalizeLanguage(null)).toBe("zh-CN");
  });
});
