import { useLanguage } from "@/hooks/use-language";

const zh = {
  stoppedTitle: "会话已停止",
  stoppedMessage: "会话已停止。点击下方「启动」按钮重新打开终端。",
};

const en: typeof zh = {
  stoppedTitle: "Session stopped",
  stoppedMessage: "This session is stopped. Use the Start button below to reopen its terminal.",
};

const zhTW: typeof zh = {
  stoppedTitle: "會話已停止",
  stoppedMessage: "會話已停止。點擊下方「啟動」按鈕重新開啟終端。",
};

/**
 * Copy for the session problem panels (stopped / lost / not-found), following
 * the project's feature copy-module pattern (cf. settings-copy.ts).
 */
export function useSessionProblemCopy() {
  const { language } = useLanguage();
  return language === "en" ? en : language === "zh-TW" ? zhTW : zh;
}
