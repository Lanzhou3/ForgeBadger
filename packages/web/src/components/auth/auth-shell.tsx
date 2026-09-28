"use client";

import type { ReactNode } from "react";

import { useLanguage } from "@/hooks/use-language";
import { brandAssets } from "@/lib/brand-assets";
import type { Language, TranslationKey } from "@/lib/i18n";

const languageOptions: Array<{ code: Language; shortLabel: string; label: string }> = [
  { code: "zh-CN", shortLabel: "简", label: "简体中文" },
  { code: "zh-TW", shortLabel: "繁", label: "繁體中文" },
  { code: "en", shortLabel: "EN", label: "English" }
];

interface AuthShellProps {
  title: string;
  description: string;
  titleKey?: TranslationKey;
  descriptionKey?: TranslationKey;
  showLanguageSwitcher?: boolean;
  children: ReactNode;
}

export function AuthShell({
  title,
  description,
  titleKey,
  descriptionKey,
  showLanguageSwitcher = false,
  children
}: AuthShellProps) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-45"
        style={{ backgroundImage: `url(${brandAssets.background})` }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,hsl(var(--background)/0.22)_0%,hsl(var(--background)/0.72)_48%,hsl(var(--background)/0.96)_100%)]"
      />
      <section className="forgebadger-animate-in relative z-10 w-full max-w-[420px] rounded-lg border border-border bg-card/85 p-6 text-card-foreground shadow-2xl shadow-black/40 backdrop-blur-md">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="size-10 shrink-0 overflow-hidden rounded-lg">
              <img
                src={brandAssets.logoSvg}
                alt=""
                className="size-full translate-y-[1.2%] scale-[1.28] select-none object-cover"
                aria-hidden="true"
                draggable={false}
              />
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold tracking-tight">ForgeBadger</div>
              <p className="text-xs text-muted-foreground">{t("auth.brandTagline")}</p>
            </div>
          </div>
          {showLanguageSwitcher ? (
            <div
              className="flex shrink-0 items-center gap-0.5 rounded-md border border-border/70 bg-background/50 p-0.5"
              aria-label={t("auth.languageLabel")}
            >
              {languageOptions.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={language === option.code}
                  className={`rounded px-1.5 py-1 text-[10px] font-medium transition-colors ${
                    language === option.code
                      ? "bg-brand text-brand-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  onClick={() => setLanguage(option.code)}
                >
                  {option.shortLabel}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">
            {titleKey ? t(titleKey) : title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {descriptionKey ? t(descriptionKey) : description}
          </p>
        </div>
        {children}
      </section>
    </main>
  );
}
