import { useLanguage } from "@/hooks/use-language";

const zh = {
  paletteLabel: "斜杠命令",
  noMatch: "无匹配命令，Enter 将原样发送。",
  categories: {
    goal: "Goal",
    session: "会话",
    model: "模型",
    info: "信息",
  } as Record<string, string>,
  // Localized descriptions keyed by the server command name; unknown names
  // fall back to the server-provided English description.
  descriptions: {
    help: "查看可用命令与用法",
    goal: "创建长期目标：描述完成标准，自动拆分任务并逐步推进",
    goals: "查看全部 Goal 及进度",
    diff: "查看当前 Goal 的沙箱变更",
    merge: "把当前 Goal 的沙箱变更合并回项目",
    answer: "答复 Goal 中 agent 的提问并继续",
    model: "查看或切换当前模型",
    status: "查看当前会话与运行状态",
    stop: "停止当前运行的任务",
    new: "开始新对话",
    playbook: "查看或使用指定 Playbook",
    usage: "查看 token 与时间消耗",
    skills: "列出可用的 Skill",
    playbooks: "列出可用的 Playbook",
  } as Record<string, string>,
};

const en: typeof zh = {
  paletteLabel: "Slash commands",
  noMatch: "No matching commands; Enter sends the text as-is.",
  categories: {
    goal: "Goal",
    session: "Session",
    model: "Model",
    info: "Info",
  },
  descriptions: {
    help: "Show available commands and usage",
    goal: "Create a long-running goal: describe the completion criteria; tasks are split and advanced automatically",
    goals: "List all goals and their progress",
    diff: "Show the current goal's sandbox changes",
    merge: "Merge the current goal's sandbox changes back into the project",
    answer: "Answer the agent's pending question and continue the goal",
    model: "Show or switch the active model",
    status: "Show the current conversation and run status",
    stop: "Stop the currently running task",
    new: "Start a new conversation",
    playbook: "Show or run a playbook by name",
    usage: "Show token and time usage",
    skills: "List available skills",
    playbooks: "List available playbooks",
  },
};

const zhTW: typeof zh = {
  paletteLabel: "斜槓命令",
  noMatch: "無匹配命令，Enter 將原樣傳送。",
  categories: {
    goal: "Goal",
    session: "會話",
    model: "模型",
    info: "資訊",
  },
  descriptions: {
    help: "檢視可用命令與用法",
    goal: "建立長期目標：描述完成標準，自動拆分任務並逐步推進",
    goals: "檢視全部 Goal 及進度",
    diff: "檢視目前 Goal 的沙箱變更",
    merge: "把目前 Goal 的沙箱變更合併回專案",
    answer: "答覆 Goal 中 agent 的提問並繼續",
    model: "檢視或切換目前模型",
    status: "檢視目前會話與執行狀態",
    stop: "停止目前執行的任務",
    new: "開始新對話",
    playbook: "檢視或使用指定 Playbook",
    usage: "檢視 token 與時間消耗",
    skills: "列出可用的 Skill",
    playbooks: "列出可用的 Playbook",
  },
};

export function useCopilotCommandsCopy() {
  const { language } = useLanguage();
  return language === "en" ? en : language === "zh-TW" ? zhTW : zh;
}
