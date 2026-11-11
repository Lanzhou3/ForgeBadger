"use client";

import { Braces, Check, FileCode2, Moon, Palette, Sun, TerminalSquare } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useColorMode } from "@/hooks/use-color-mode";
import { useColorTheme } from "@/hooks/use-color-theme";
import { useLanguage } from "@/hooks/use-language";
import {
  COLOR_THEMES,
  setColorTheme,
  type ColorTheme,
  type ColorThemePreview,
} from "@/lib/color-theme";
import { setColorMode, type ResolvedColorMode } from "@/lib/color-mode";
import { cn } from "@/lib/utils";

function ThemePreview({ preview }: { preview: ColorThemePreview }) {
  return (
    <div
      className="flex h-32 overflow-hidden rounded-lg border border-black/10 text-left"
      style={{ backgroundColor: preview.background, color: preview.foreground }}
      aria-hidden="true"
    >
      <div
        className="flex w-[28%] shrink-0 flex-col border-r p-2"
        style={{ backgroundColor: preview.sidebar, borderColor: preview.card }}
      >
        <div className="mb-3 flex items-center gap-1.5">
          <span className="size-2 rounded-[3px]" style={{ backgroundColor: preview.accent }} />
          <span className="h-1 w-8 rounded-full" style={{ backgroundColor: preview.muted }} />
        </div>
        <div
          className="-mx-1 flex items-center gap-1.5 rounded px-1 py-1"
          style={{ backgroundColor: preview.card, color: preview.accent }}
        >
          <FileCode2 className="size-3" strokeWidth={1.8} />
          <span className="font-mono text-[7px]">theme.ts</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 px-1 py-1" style={{ color: preview.muted }}>
          <Braces className="size-3" strokeWidth={1.8} />
          <span className="font-mono text-[7px]">tokens.json</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 px-1 py-1" style={{ color: preview.muted }}>
          <TerminalSquare className="size-3" strokeWidth={1.8} />
          <span className="font-mono text-[7px]">terminal</span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="flex h-6 items-center gap-1.5 border-b px-2.5"
          style={{ backgroundColor: preview.card, borderColor: preview.sidebar }}
        >
          <FileCode2 className="size-2.5" style={{ color: preview.accent }} strokeWidth={1.8} />
          <span className="font-mono text-[7px]">theme.ts</span>
          <span className="ml-auto size-1 rounded-full" style={{ backgroundColor: preview.muted }} />
        </div>
        <div className="space-y-1.5 px-3 py-3 font-mono text-[8px] leading-none">
          <div><span style={{ color: preview.purple }}>const</span> <span style={{ color: preview.accent }}>workspace</span> = {"{"}</div>
          <div className="pl-3"><span style={{ color: preview.foreground }}>theme</span>: <span style={{ color: preview.green }}>"focused"</span>,</div>
          <div className="pl-3"><span style={{ color: preview.foreground }}>contrast</span>: <span style={{ color: preview.yellow }}>"comfortable"</span>,</div>
          <div>{"}"};</div>
        </div>
        <div
          className="mx-2.5 flex items-center gap-1.5 rounded px-2 py-1.5 font-mono text-[7px]"
          style={{ backgroundColor: preview.sidebar, color: preview.muted }}
        >
          <TerminalSquare className="size-2.5" style={{ color: preview.accent }} strokeWidth={1.8} />
          <span style={{ color: preview.green }}>●</span>
          <span>ready</span>
        </div>
      </div>
    </div>
  );
}

function ThemeChoice({ theme, preferred, active, followsSystem }: {
  theme: ColorTheme;
  preferred: boolean;
  active: boolean;
  followsSystem: boolean;
}) {
  const { t } = useLanguage();
  function selectTheme() {
    setColorTheme(theme.id);
    if (!followsSystem) setColorMode(theme.mode);
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={theme.name}
      data-theme-choice={theme.id}
      onClick={selectTheme}
      className={cn(
        "group rounded-xl border p-2.5 text-left outline-none transition-[border-color,box-shadow,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring/60",
        active
          ? "border-brand/70 bg-brand/[0.06] shadow-[0_0_0_1px_hsl(var(--brand)/0.16)]"
          : "border-border bg-card hover:border-brand/35 hover:bg-muted/30"
      )}
    >
      <ThemePreview preview={theme.preview} />
      <div className="flex items-start gap-2 px-0.5 pb-0.5 pt-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{theme.name}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(theme.descriptionKey)}</p>
        </div>
        {preferred && !active ? (
          <span className="mt-0.5 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {t("settings.themePreferred")}
          </span>
        ) : (
          <span
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
              active ? "border-brand bg-brand text-brand-foreground" : "border-border text-transparent"
            )}
          >
            <Check className="size-3" strokeWidth={2.5} />
          </span>
        )}
      </div>
    </button>
  );
}

export function ColorThemeSettings() {
  const selected = useColorTheme();
  const { mode, resolved } = useColorMode();
  const { t } = useLanguage();
  const followsSystem = mode === "system";
  const groups: Array<{
    mode: ResolvedColorMode;
    labelKey: "settings.themeDarkGroup" | "settings.themeLightGroup";
    systemLabelKey: "settings.themeSystemDarkGroup" | "settings.themeSystemLightGroup";
    icon: typeof Moon;
  }> = [
    { mode: "dark", labelKey: "settings.themeDarkGroup", systemLabelKey: "settings.themeSystemDarkGroup", icon: Moon },
    { mode: "light", labelKey: "settings.themeLightGroup", systemLabelKey: "settings.themeSystemLightGroup", icon: Sun },
  ];

  return (
    <Card className="forgebadger-animate-in" style={{ animationDelay: "40ms" }}>
      <SettingsCardHeader
        icon={<Palette className="size-4" />}
        title={t("settings.theme")}
        description={t("settings.themeDescription")}
        action={(
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {t("settings.colorModeSystem")}
            <Switch
              aria-label={t("settings.colorModeSystem")}
              checked={followsSystem}
              onCheckedChange={(checked) => setColorMode(checked ? "system" : resolved)}
            />
          </label>
        )}
      />
      <CardContent className="space-y-6">
        {groups.map((group) => (
          <fieldset key={group.mode}>
            <legend className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <group.icon className="size-3.5" strokeWidth={1.8} />
              {t(followsSystem ? group.systemLabelKey : group.labelKey)}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {COLOR_THEMES.filter((theme) => theme.mode === group.mode).map((theme) => {
                const preferred = selected[group.mode] === theme.id;
                return (
                  <ThemeChoice
                    key={theme.id}
                    theme={theme}
                    preferred={preferred}
                    active={preferred && resolved === group.mode}
                    followsSystem={followsSystem}
                  />
                );
              })}
            </div>
          </fieldset>
        ))}
      </CardContent>
    </Card>
  );
}
