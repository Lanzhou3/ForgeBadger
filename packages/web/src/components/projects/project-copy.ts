import { useLanguage } from "@/hooks/use-language";

const zh = {
  projectStatuses: {
    active: "活跃",
    disabled: "已停用",
    archived: "已归档",
  } as Record<string, string>,
  activityTypes: {
    session_created: "会话已创建",
    session_started: "会话已启动",
    session_connected: "会话已连接",
    session_stopped: "会话已停止",
    session_error: "会话出错",
  } as Record<string, string>,
};

const en: typeof zh = {
  projectStatuses: {
    active: "Active",
    disabled: "Disabled",
    archived: "Archived",
  },
  activityTypes: {
    session_created: "Session created",
    session_started: "Session started",
    session_connected: "Session connected",
    session_stopped: "Session stopped",
    session_error: "Session error",
  },
};

const zhTW: typeof zh = {
  projectStatuses: {
    active: "活躍",
    disabled: "已停用",
    archived: "已歸檔",
  },
  activityTypes: {
    session_created: "會話已建立",
    session_started: "會話已啟動",
    session_connected: "會話已連線",
    session_stopped: "會話已停止",
    session_error: "會話出錯",
  },
};

/**
 * Display labels for raw Gateway enum values (project status, session
 * activity type). Unknown values fall back to the raw string so newer
 * Gateway types never render blank. Feature copy module, cf. settings-copy.ts.
 */
export function useProjectCopy() {
  const { language } = useLanguage();
  return language === "en" ? en : language === "zh-TW" ? zhTW : zh;
}

export function projectStatusLabel(copy: typeof zh, status: string): string {
  return copy.projectStatuses[status] ?? status;
}

export function activityTypeLabel(copy: typeof zh, type: string): string {
  return copy.activityTypes[type] ?? type;
}
