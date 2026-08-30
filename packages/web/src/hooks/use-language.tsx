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
  getTranslation,
  normalizeLanguage,
  type Language,
  type TranslationKey,
} from "@/lib/i18n";
import { readMigratedStorageValue, writeMigratedStorageValue } from "@/lib/brand-storage";

const LANGUAGE_KEY = "forgebadger-language";
const LEGACY_LANGUAGE_KEY = "openforge-language";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("zh-CN");

  useEffect(() => {
    const stored = readMigratedStorageValue(
      window.localStorage,
      LANGUAGE_KEY,
      LEGACY_LANGUAGE_KEY
    );
    const nextLanguage = normalizeLanguage(stored);
    setLanguageState(nextLanguage);
    document.documentElement.lang = nextLanguage;
  }, []);

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    writeMigratedStorageValue(
      window.localStorage,
      LANGUAGE_KEY,
      LEGACY_LANGUAGE_KEY,
      nextLanguage
    );
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
