import { useLanguage } from "@/hooks/use-language";

const zh = {
  title: "定时自动化",
  description: "创建按计划自动运行的 Copilot 任务，结果投递到会话与通知。",
  suggestionsDescription: "根据使用历史推荐的可复用任务，接受后会加入下方自动化列表。",
  listDescription: "已创建的定时任务；可暂停、启用、立即运行或删除。",
  list: "自动化",
  create: "新建",
  prompt: "任务提示词",
  scheduleKind: "调度类型",
  expression: "表达式",
  save: "创建",
  createFailed: "创建失败，请检查输入。",
  empty: "暂无自动化，点击「新建」创建。",
  deleteConfirm: "删除该自动化？不可撤销。",
  runNow: "立即运行",
  pause: "暂停",
  enable: "启用",
  suggestions: "推荐自动化",
  accept: "接受",
  dismiss: "忽略",
  statusEnabled: "已启用",
  statusPaused: "已暂停",
  statusDraft: "草稿",
  invalidCron: "表达式格式不正确：cron 需为 5 段（分 时 日 月 周）。",
  // Catalog suggestion cards: keyed by the stable suggestion dedupKey from the
  // Gateway. Unknown keys fall back to the raw jobSpec name/prompt.
  catalogSuggestions: {
    "catalog:daily-briefing": {
      name: "每日项目简报",
      prompt: "汇总今天所有项目的进展：会话状态变化、新完成的工作项、以及需要我关注的事项。",
    },
    "catalog:weekly-review": {
      name: "每周项目回顾",
      prompt: "回顾本周的项目活动：完成的工作项、进行中的会话、以及下周需要优先处理的事项。",
    },
    "catalog:session-watch": {
      name: "进行中会话提醒",
      prompt: "检查当前是否有长时间运行的会话，列出它们的进度和状态，提醒我是否需要介入。",
    },
  } as Record<string, { name: string; prompt: string }>,
};
const en: typeof zh = {
  title: "Scheduled automations",
  description: "Create Copilot tasks that run on a schedule and deliver results to your conversation and notifications.",
  suggestionsDescription: "Recurring tasks suggested from your usage history; accepting one adds it to the automations list below.",
  listDescription: "Automations you have created; pause, enable, run immediately, or delete them.",
  list: "Automations",
  create: "New",
  prompt: "Task prompt",
  scheduleKind: "Schedule type",
  expression: "Expression",
  save: "Create",
  createFailed: "Creation failed; check your input.",
  empty: "No automations yet. Click \"New\" to create one.",
  deleteConfirm: "Delete this automation? This cannot be undone.",
  runNow: "Run now",
  pause: "Pause",
  enable: "Enable",
  suggestions: "Suggested automations",
  accept: "Accept",
  dismiss: "Dismiss",
  statusEnabled: "Enabled",
  statusPaused: "Paused",
  statusDraft: "Draft",
  invalidCron: "Invalid expression: cron needs 5 fields (minute hour day month weekday).",
  catalogSuggestions: {
    "catalog:daily-briefing": {
      name: "Daily project briefing",
      prompt: "Summarize today's progress across all projects: session status changes, newly completed work items, and anything that needs my attention.",
    },
    "catalog:weekly-review": {
      name: "Weekly project review",
      prompt: "Review this week's project activity: completed work items, in-progress sessions, and priorities for next week.",
    },
    "catalog:session-watch": {
      name: "Running session watch",
      prompt: "Check for long-running sessions, list their progress and status, and remind me whether I need to step in.",
    },
  },
};
const zhTW: typeof zh = {
  title: "定時自動化",
  description: "建立按計畫自動執行的 Copilot 任務，結果投遞到會話與通知。",
  suggestionsDescription: "根據使用歷史推薦的可複用任務，接受後會加入下方自動化列表。",
  listDescription: "已建立的定時任務；可暫停、啟用、立即執行或刪除。",
  list: "自動化",
  create: "新建",
  prompt: "任務提示詞",
  scheduleKind: "排程類型",
  expression: "運算式",
  save: "建立",
  createFailed: "建立失敗，請檢查輸入。",
  empty: "尚無自動化，點擊「新建」建立。",
  deleteConfirm: "刪除此自動化？無法復原。",
  runNow: "立即執行",
  pause: "暫停",
  enable: "啟用",
  suggestions: "推薦自動化",
  accept: "接受",
  dismiss: "忽略",
  statusEnabled: "已啟用",
  statusPaused: "已暫停",
  statusDraft: "草稿",
  invalidCron: "運算式格式不正確：cron 需為 5 段（分 時 日 月 週）。",
  catalogSuggestions: {
    "catalog:daily-briefing": {
      name: "每日專案簡報",
      prompt: "彙總今天所有專案的進展：會話狀態變化、新完成的工作項、以及需要我關注的事項。",
    },
    "catalog:weekly-review": {
      name: "每週專案回顧",
      prompt: "回顧本週的專案活動：完成的工作項、進行中的會話、以及下週需要優先處理的事項。",
    },
    "catalog:session-watch": {
      name: "進行中會話提醒",
      prompt: "檢查目前是否有長時間執行的會話，列出它們的進度和狀態，提醒我是否需要介入。",
    },
  },
};
export function useAutomationsCopy() {
  const { language } = useLanguage();
  return language === "en" ? en : language === "zh-TW" ? zhTW : zh;
}
