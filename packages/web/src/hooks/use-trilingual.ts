"use client";
import { useLanguage } from "./use-language";

/**
 * Trilingual text picker for component-local copy tables: call sites keep
 * zh-CN and en text verbatim and add a zh-TW variant, so Traditional-Chinese
 * users no longer fall back to English or Simplified Chinese.
 */
export function useTrilingual() {
  const { language } = useLanguage();
  return (zh: string, zhTW: string, en: string): string =>
    language === "en" ? en : language === "zh-TW" ? zhTW : zh;
}
