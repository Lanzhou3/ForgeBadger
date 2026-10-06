"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  detectSystemLanguage,
  getTranslation,
  localeForLanguage,
  supportedLanguages,
  type Language,
  type TranslationKey,
  type UiLocale,
} from "@/lib/i18n";
const LANGUAGE_KEY = "forgebadger-language";

// Server markup and the first client render must agree to avoid hydration
// mismatches, so the server snapshot is always the fallback language. After
// hydration React reads the client snapshot (stored preference or system
// locale) and re-renders once if it differs — the useSyncExternalStore
// contract, unlike a useEffect state flip, never races sibling hydration.
const serverLanguage: Language = "zh-CN";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readClientLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    if (stored && supportedLanguages.includes(stored as Language)) {
      return stored as Language;
    }
  } catch {
    // localStorage can be unavailable (private mode); fall through.
  }
  return detectSystemLanguage(window.navigator.languages);
}

function subscribeLanguage(): () => void {
  return () => {};
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const detected = useSyncExternalStore(
    subscribeLanguage,
    readClientLanguage,
    () => serverLanguage
  );
  const [override, setOverride] = useState<Language | null>(null);
  const language = override ?? detected;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = (nextLanguage: Language) => {
    try {
      window.localStorage.setItem(LANGUAGE_KEY, nextLanguage);
    } catch {
      // Persisting the preference is best-effort.
    }
    setOverride(nextLanguage);
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

/** BCP 47 locale matching the current UI language, for toLocale* calls. */
export function useUiLocale(): UiLocale {
  const { language } = useLanguage();
  return localeForLanguage(language);
}
