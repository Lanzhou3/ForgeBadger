import type { TranslationKey } from "./i18n";
import type { BrandStorage } from "./brand-storage";

/**
 * Accent themes (shadcn/tweakcn-style): a curated palette that recolors the
 * brand accent (`--brand`) plus focus rings, leaving the dark surface tokens
 * untouched. Applied by stamping `data-accent` on <html>; persisted per user
 * in localStorage. The default is cyan (蓝青).
 */

export interface AccentTheme {
  id: string;
  nameKey: TranslationKey;
  /** HSL triplet written to --brand. */
  brand: string;
  /** HSL triplet written to --brand-foreground. */
  brandForeground: string;
  /** Hex used for the settings swatch dot. */
  swatch: string;
}

export const DEFAULT_ACCENT_ID = "cyan";

export const ACCENT_THEMES: readonly AccentTheme[] = [
  { id: "cyan", nameKey: "settings.themeCyan", brand: "187 86% 53%", brandForeground: "220 30% 6%", swatch: "#22d3ee" },
  { id: "orange", nameKey: "settings.themeOrange", brand: "24 100% 50%", brandForeground: "0 0% 100%", swatch: "#ff8000" },
  { id: "violet", nameKey: "settings.themeViolet", brand: "258 90% 66%", brandForeground: "0 0% 100%", swatch: "#8b5cf6" },
  { id: "emerald", nameKey: "settings.themeEmerald", brand: "160 84% 39%", brandForeground: "160 60% 6%", swatch: "#10b981" },
  { id: "blue", nameKey: "settings.themeBlue", brand: "217 91% 60%", brandForeground: "0 0% 100%", swatch: "#3b82f6" },
  { id: "rose", nameKey: "settings.themeRose", brand: "350 89% 60%", brandForeground: "0 0% 100%", swatch: "#f43f5e" },
  { id: "amber", nameKey: "settings.themeAmber", brand: "38 92% 55%", brandForeground: "38 60% 8%", swatch: "#f59e0b" },
] as const;

const ACCENT_STORAGE_KEY = "forgebadger.accent";

export function isAccentThemeId(value: string | null | undefined): value is string {
  return ACCENT_THEMES.some((theme) => theme.id === value);
}

export function getAccentTheme(id: string | null | undefined): AccentTheme {
  // The literal palette guarantees index 0 (the default cyan) exists.
  return ACCENT_THEMES.find((theme) => theme.id === id) ?? ACCENT_THEMES[0]!;
}

export function readStoredAccent(storage: BrandStorage = window.localStorage): string {
  const stored = storage.getItem(ACCENT_STORAGE_KEY);
  return isAccentThemeId(stored) ? stored : DEFAULT_ACCENT_ID;
}

export function applyAccentTheme(
  id: string,
  storage: BrandStorage = window.localStorage
): string {
  const themeId = isAccentThemeId(id) ? id : DEFAULT_ACCENT_ID;
  document.documentElement.dataset.accent = themeId;
  storage.setItem(ACCENT_STORAGE_KEY, themeId);
  return themeId;
}
