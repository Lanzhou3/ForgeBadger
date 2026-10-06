import { useLanguage } from "@/hooks/use-language";

const zh = {
  moveToolbar: "拖动工具栏（双击或 Home 键复位）",
  fontSmaller: "减小字号",
  fontLarger: "增大字号",
  clear: "清屏",
  copySelection: "复制选中内容",
  copyAll: "复制全部",
  clearAlternate: "全屏 CLI 界面由 CLI 管理，无法清屏",
  copied: "已复制到剪贴板",
  copyFailed: "复制失败，请检查浏览器剪贴板权限",
  copyEmpty: "没有可复制的内容",
};

const en: typeof zh = {
  moveToolbar: "Drag toolbar (double-click or Home to reset)",
  fontSmaller: "Decrease font size",
  fontLarger: "Increase font size",
  clear: "Clear screen",
  copySelection: "Copy selection",
  copyAll: "Copy all",
  clearAlternate: "The CLI controls this full-screen view; clearing is unavailable",
  copied: "Copied to clipboard",
  copyFailed: "Copy failed. Check your browser clipboard permissions",
  copyEmpty: "There is no text to copy",
};

const zhTW: typeof zh = {
  moveToolbar: "拖動工具列（按兩下或 Home 鍵復位）",
  fontSmaller: "減小字級",
  fontLarger: "增大字級",
  clear: "清屏",
  copySelection: "複製選取內容",
  copyAll: "複製全部",
  clearAlternate: "全螢幕 CLI 畫面由 CLI 管理，無法清屏",
  copied: "已複製到剪貼簿",
  copyFailed: "複製失敗，請檢查瀏覽器剪貼簿權限",
  copyEmpty: "沒有可複製的內容",
};

/**
 * Copy for the terminal chrome toolbar (font size, clear, copy actions).
 * Connection status labels reuse the existing `terminal.status.*` i18n keys.
 * Local three-language module because src/lib/i18n.ts is owned by another
 * change stream this round; note that lib/terminal-copy.ts is an unrelated
 * utility (clipboard helpers), not a copy module.
 */
export function useTerminalToolbarCopy() {
  const { language } = useLanguage();
  return language === "en" ? en : language === "zh-TW" ? zhTW : zh;
}
