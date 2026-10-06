import { useLanguage } from "@/hooks/use-language";

/**
 * Localized dashboard health copy. The Gateway returns a stable `code` on each
 * health item (the English `message` stays for backward compatibility and
 * diagnostics); clients map code → user text here. Unknown items/codes fall
 * back to the Gateway message so newer Gateways never render blank.
 */
const zh = {
  health: {
    models: {
      ready: "已配置模型",
      host_environment: "可选：CLI 会话使用主机环境中配置的模型",
    },
    projectConfig: {
      ready: "项目可使用可用模板",
      create_project: "创建或导入项目",
    },
    sessions: {
      ready: "已有会话",
      create_session: "从项目创建会话",
    },
    skills: {
      ready: "已配置 Skill",
      create_skill: "创建 Skill",
    },
  } as Record<string, Record<string, string>>,
};

const en: typeof zh = {
  health: {
    models: {
      ready: "Models are configured",
      host_environment: "Optional: CLI sessions use models configured in the host environment",
    },
    projectConfig: {
      ready: "Projects can use available templates",
      create_project: "Create or import a project",
    },
    sessions: {
      ready: "Sessions exist",
      create_session: "Create a session from a project",
    },
    skills: {
      ready: "Skills are configured",
      create_skill: "Create a Skill",
    },
  },
};

const zhTW: typeof zh = {
  health: {
    models: {
      ready: "已設定模型",
      host_environment: "可選：CLI 會話使用主機環境中設定的模型",
    },
    projectConfig: {
      ready: "專案可使用可用範本",
      create_project: "建立或匯入專案",
    },
    sessions: {
      ready: "已有會話",
      create_session: "從專案建立會話",
    },
    skills: {
      ready: "已設定 Skill",
      create_skill: "建立 Skill",
    },
  },
};

export function useDashboardCopy() {
  const { language } = useLanguage();
  return language === "en" ? en : language === "zh-TW" ? zhTW : zh;
}

/** Resolve a health item's detail text: mapped copy → Gateway message → raw code. */
export function dashboardHealthDetail(
  copy: typeof zh,
  item: string,
  code: string | undefined,
  message: string | undefined,
): string {
  const mapped = code ? copy.health[item]?.[code] : undefined;
  return mapped ?? message ?? code ?? "";
}
