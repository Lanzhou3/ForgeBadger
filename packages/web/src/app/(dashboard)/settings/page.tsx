"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Bell,
  Cpu,
  Globe2,
  Moon,
  Palette,
  Plug,
  Server,
  Settings2,
  ShieldCheck,
  Sun,
  MonitorSmartphone,
  Type,
  type LucideIcon,
} from "lucide-react";

import { AccountSecuritySettings } from "@/components/settings/AccountSecuritySettings";
import { AdapterSettings } from "@/components/settings/AdapterSettings";
import { AuditHistorySettings } from "@/components/settings/AuditHistorySettings";
import { ClaudeRouteSettings } from "@/components/settings/ClaudeRouteSettings";
import { DiagnosticsSettings } from "@/components/settings/DiagnosticsSettings";
import { InstanceRuntimeSettings } from "@/components/settings/InstanceRuntimeSettings";
import { McpIntegrationSettings } from "@/components/settings/McpIntegrationSettings";
import { PetSettings } from "@/components/settings/PetSettings";
import { SecurityBaselineSettings } from "@/components/settings/SecurityBaselineSettings";
import { SettingsCardHeader, SettingsSection, SettingRow } from "@/components/settings/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useColorMode } from "@/hooks/use-color-mode";
import { useLanguage } from "@/hooks/use-language";
import {
  ACCENT_THEMES,
  DEFAULT_ACCENT_ID,
  applyAccentTheme,
  readStoredAccent,
} from "@/lib/accent-theme";
import { setColorMode } from "@/lib/color-mode";
import {
  DEFAULT_TERMINAL_FONT,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  readStoredTerminalFont,
  setTerminalFont,
} from "@/lib/terminal-font";
import {
  getBrowserNotificationPermission,
  getBrowserNotificationPreference,
  requestBrowserNotificationPermission,
  setBrowserNotificationPreference,
  type BrowserNotificationPermission,
} from "@/lib/browser-notifications";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const languageOptions = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
];

type SectionId = "appearance" | "account" | "adapters" | "integrations" | "instance";

const SECTION_DEFS = [
  { id: "appearance", icon: Palette, labelKey: "settings.section.appearance", descriptionKey: "settings.section.appearanceDescription" },
  { id: "account", icon: ShieldCheck, labelKey: "settings.section.account", descriptionKey: "settings.section.accountDescription" },
  { id: "adapters", icon: Cpu, labelKey: "settings.section.adapters", descriptionKey: "settings.section.adaptersDescription" },
  { id: "integrations", icon: Plug, labelKey: "settings.section.integrations", descriptionKey: "settings.section.integrationsDescription" },
  { id: "instance", icon: Server, labelKey: "settings.section.instance", descriptionKey: "settings.section.instanceDescription" },
] as const satisfies ReadonlyArray<{
  id: SectionId;
  icon: LucideIcon;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
}>;

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false);
  const [browserNotificationPermission, setBrowserNotificationPermission] =
    useState<BrowserNotificationPermission>("unsupported");
  const [accentId, setAccentId] = useState(DEFAULT_ACCENT_ID);
  // The color mode is app-global (see Providers -> initColorMode): the hook
  // observes the module store, and setColorMode applies + persists it.
  const { mode: colorMode } = useColorMode();
  // Terminal font draft inputs commit on blur/Enter so each keystroke does
  // not re-render every live xterm instance. Initialized from localStorage on
  // mount (same pattern as accentId).
  const [fontFamilyDraft, setFontFamilyDraft] = useState(DEFAULT_TERMINAL_FONT.fontFamily);
  const [fontSizeDraft, setFontSizeDraft] = useState(String(DEFAULT_TERMINAL_FONT.fontSize));

  useEffect(() => {
    setAccentId(readStoredAccent());
    const storedFont = readStoredTerminalFont();
    setFontFamilyDraft(storedFont.fontFamily);
    setFontSizeDraft(String(storedFont.fontSize));
    setBrowserNotificationsEnabled(getBrowserNotificationPreference());
    setBrowserNotificationPermission(getBrowserNotificationPermission());
  }, []);

  function commitTerminalFont() {
    const size = Number(fontSizeDraft);
    setTerminalFont({
      fontFamily: fontFamilyDraft,
      fontSize: Number.isFinite(size) && fontSizeDraft !== "" ? size : DEFAULT_TERMINAL_FONT.fontSize
    });
  }

  function resetTerminalFont() {
    setFontFamilyDraft(DEFAULT_TERMINAL_FONT.fontFamily);
    setFontSizeDraft(String(DEFAULT_TERMINAL_FONT.fontSize));
    setTerminalFont(DEFAULT_TERMINAL_FONT);
  }

  const isAdmin = user?.role === "admin";
  const sections = isAdmin
    ? SECTION_DEFS
    : SECTION_DEFS.filter((section) => section.id !== "instance");
  const requested = searchParams.get("section");
  const active = sections.find((section) => section.id === requested) ?? SECTION_DEFS[0];

  async function toggleBrowserNotifications(enabled: boolean) {
    if (!enabled) {
      setBrowserNotificationPreference(false);
      setBrowserNotificationsEnabled(false);
      setBrowserNotificationPermission(getBrowserNotificationPermission());
      return;
    }

    const permission =
      getBrowserNotificationPermission() === "default"
        ? await requestBrowserNotificationPermission()
        : getBrowserNotificationPermission();
    setBrowserNotificationPermission(permission);
    const allowed = permission === "granted";
    setBrowserNotificationPreference(allowed);
    setBrowserNotificationsEnabled(allowed);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.subtitle")}
        </p>
      </div>

      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
        <nav
          aria-label={t("settings.title")}
          className="mb-4 flex gap-1 overflow-x-auto lg:sticky lg:top-6 lg:mb-0 lg:flex-col lg:self-start"
        >
          {sections.map((section) => (
            <Link
              key={section.id}
              href={`/settings?section=${section.id}`}
              aria-current={active.id === section.id ? "page" : undefined}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors duration-150",
                active.id === section.id
                  ? "bg-brand/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <section.icon
                className={cn(
                  "size-4 shrink-0",
                  active.id === section.id ? "text-brand" : "text-muted-foreground/70"
                )}
              />
              {t(section.labelKey)}
            </Link>
          ))}
        </nav>

        <div key={active.id} className="min-w-0">
          {active.id === "appearance" && (
            <SettingsSection title={t(active.labelKey)} description={t(active.descriptionKey)}>
              <Card className="forgebadger-animate-in">
                <SettingsCardHeader
                  icon={<Palette className="size-4" />}
                  title={t("settings.colorMode")}
                  description={t("settings.colorModeDescription")}
                />
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { id: "light", labelKey: "settings.colorModeLight", icon: Sun },
                      { id: "dark", labelKey: "settings.colorModeDark", icon: Moon },
                      { id: "system", labelKey: "settings.colorModeSystem", icon: MonitorSmartphone },
                    ] as const).map((option) => {
                      const selected = colorMode === option.id;
                      return (
                        <Button
                          key={option.id}
                          type="button"
                          aria-pressed={selected}
                          variant={selected ? "brand" : "outline"}
                          size="sm"
                          onClick={() => setColorMode(option.id)}
                        >
                          <option.icon className="size-4" />
                          {t(option.labelKey)}
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card className="forgebadger-animate-in" style={{ animationDelay: "40ms" }}>
                <SettingsCardHeader
                  icon={<Globe2 className="size-4" />}
                  title={t("settings.language")}
                  description={t("settings.languageDescription")}
                />
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {languageOptions.map((option) => (
                      <Button
                        key={option.code}
                        type="button"
                        variant={language === option.code ? "brand" : "outline"}
                        size="sm"
                        onClick={() => setLanguage(option.code as typeof language)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="forgebadger-animate-in" style={{ animationDelay: "80ms" }}>
                <SettingsCardHeader
                  icon={<Palette className="size-4" />}
                  title={t("settings.theme")}
                  description={t("settings.themeDescription")}
                />
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {ACCENT_THEMES.map((theme) => {
                      const selected = accentId === theme.id;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setAccentId(applyAccentTheme(theme.id))}
                          className={
                            selected
                              ? "flex items-center gap-2 rounded-md border border-brand/60 bg-brand/10 px-3 py-2 text-sm text-foreground transition-colors duration-150"
                              : "flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:border-brand/40 hover:bg-muted/40 hover:text-foreground"
                          }
                        >
                          <span
                            className="size-3.5 rounded-full ring-1 ring-border"
                            style={{ backgroundColor: theme.swatch }}
                            aria-hidden="true"
                          />
                          {t(theme.nameKey)}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card className="forgebadger-animate-in" style={{ animationDelay: "120ms" }}>
                <SettingsCardHeader
                  icon={<Type className="size-4" />}
                  title={t("settings.terminalFont")}
                  description={t("settings.terminalFontDescription")}
                />
                <CardContent>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="grid min-w-52 flex-1 gap-2">
                      <Label htmlFor="terminal-font-family" className="text-xs text-muted-foreground">
                        {t("settings.terminalFontFamily")}
                      </Label>
                      <Input
                        id="terminal-font-family"
                        value={fontFamilyDraft}
                        onChange={(e) => setFontFamilyDraft(e.target.value)}
                        onBlur={commitTerminalFont}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitTerminalFont();
                        }}
                        spellCheck={false}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="grid w-24 gap-2">
                      <Label htmlFor="terminal-font-size" className="text-xs text-muted-foreground">
                        {t("settings.terminalFontSize")}
                      </Label>
                      <Input
                        id="terminal-font-size"
                        type="number"
                        min={MIN_TERMINAL_FONT_SIZE}
                        max={MAX_TERMINAL_FONT_SIZE}
                        value={fontSizeDraft}
                        onChange={(e) => setFontSizeDraft(e.target.value)}
                        onBlur={commitTerminalFont}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitTerminalFont();
                        }}
                      />
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={resetTerminalFont}>
                      {t("settings.terminalFontReset")}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="forgebadger-animate-in" style={{ animationDelay: "160ms" }}>
                <PetSettings />
              </div>

              <Card className="forgebadger-animate-in" style={{ animationDelay: "200ms" }}>
                <SettingsCardHeader
                  icon={<Settings2 className="size-4" />}
                  title={t("settings.console")}
                  description={t("settings.consoleDescription")}
                />
                <CardContent className="space-y-2">
                  <SettingRow
                    title={t("settings.browserNotifications")}
                    description={
                      browserNotificationPermission === "denied"
                        ? t("settings.browserNotificationsDenied")
                        : t("settings.browserNotificationsDescription")
                    }
                    checked={browserNotificationsEnabled && browserNotificationPermission === "granted"}
                    disabled={browserNotificationPermission === "unsupported"}
                    onCheckedChange={toggleBrowserNotifications}
                    icon={<Bell className="size-4 text-muted-foreground" />}
                  />
                </CardContent>
              </Card>
            </SettingsSection>
          )}

          {active.id === "account" && (
            <SettingsSection title={t(active.labelKey)} description={t(active.descriptionKey)}>
              <div className="forgebadger-animate-in">
                <AccountSecuritySettings />
              </div>
              <div className="forgebadger-animate-in" style={{ animationDelay: "40ms" }}>
                <SecurityBaselineSettings />
              </div>
            </SettingsSection>
          )}

          {active.id === "adapters" && (
            <SettingsSection title={t(active.labelKey)} description={t(active.descriptionKey)}>
              <div className="forgebadger-animate-in">
                <AdapterSettings />
              </div>
              <div className="forgebadger-animate-in" style={{ animationDelay: "40ms" }}>
                <ClaudeRouteSettings />
              </div>
            </SettingsSection>
          )}

          {active.id === "integrations" && (
            <SettingsSection title={t(active.labelKey)} description={t(active.descriptionKey)}>
              <div className="forgebadger-animate-in">
                <McpIntegrationSettings />
              </div>
            </SettingsSection>
          )}

          {active.id === "instance" && isAdmin && (
            <SettingsSection title={t(active.labelKey)} description={t(active.descriptionKey)}>
              <div className="forgebadger-animate-in">
                <InstanceRuntimeSettings />
              </div>
              <div className="forgebadger-animate-in" style={{ animationDelay: "40ms" }}>
                <DiagnosticsSettings />
              </div>
              <div className="forgebadger-animate-in" style={{ animationDelay: "80ms" }}>
                <AuditHistorySettings />
              </div>
            </SettingsSection>
          )}
        </div>
      </div>
    </div>
  );
}
