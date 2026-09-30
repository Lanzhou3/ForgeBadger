"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  detectSystemLanguage,
  getTranslation,
  supportedLanguages,
  type Language,
  type TranslationKey,
} from "@/lib/i18n";
const LANGUAGE_KEY = "forgebadger-language";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("zh-CN");

  useEffect(() => {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    // A valid stored preference always wins; otherwise follow the system
    // locale so first-time visitors see the UI in their own language.
    const nextLanguage =
      stored !== null && supportedLanguages.includes(stored as Language)
        ? (stored as Language)
        : detectSystemLanguage(window.navigator.languages);
    setLanguageState(nextLanguage);
    document.documentElement.lang = nextLanguage;
  }, []);

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(LANGUAGE_KEY, nextLanguage);
    document.documentElement.lang = nextLanguage;
  };

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key) => getTranslation(language, key),
    }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return value;
}
