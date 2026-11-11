import type { BrandStorage } from "./brand-storage";
import type { ResolvedColorMode } from "./color-mode";
import type { TranslationKey } from "./i18n";

export type DarkColorThemeId = "one-dark" | "tokyo-night";
export type LightColorThemeId = "github-light" | "solarized-light";
export type ColorThemeId = DarkColorThemeId | LightColorThemeId;

export interface ColorThemePreview {
  background: string;
  sidebar: string;
  card: string;
  foreground: string;
  muted: string;
  accent: string;
  purple: string;
  green: string;
  yellow: string;
}

export interface ColorTheme {
  id: ColorThemeId;
  name: string;
  mode: ResolvedColorMode;
  descriptionKey: TranslationKey;
  preview: ColorThemePreview;
}

export const DEFAULT_COLOR_THEMES = {
  dark: "one-dark",
  light: "github-light",
} as const;

export const COLOR_THEME_STORAGE_KEYS = {
  dark: "forgebadger.dark-theme",
  light: "forgebadger.light-theme",
} as const;

export const COLOR_THEMES = [
  {
    id: "one-dark",
    name: "One Dark",
    mode: "dark",
    descriptionKey: "settings.themeOneDarkDescription",
    preview: {
      background: "#282c34",
      sidebar: "#21252b",
      card: "#2c313a",
      foreground: "#abb2bf",
      muted: "#7f848e",
      accent: "#61afef",
      purple: "#c678dd",
      green: "#98c379",
      yellow: "#e5c07b",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    mode: "dark",
    descriptionKey: "settings.themeTokyoNightDescription",
    preview: {
      background: "#1a1b26",
      sidebar: "#16161e",
      card: "#1f2335",
      foreground: "#c0caf5",
      muted: "#7982a9",
      accent: "#7aa2f7",
      purple: "#bb9af7",
      green: "#9ece6a",
      yellow: "#e0af68",
    },
  },
  {
    id: "github-light",
    name: "GitHub Light",
    mode: "light",
    descriptionKey: "settings.themeGithubLightDescription",
    preview: {
      background: "#f6f8fa",
      sidebar: "#f6f8fa",
      card: "#ffffff",
      foreground: "#1f2328",
      muted: "#59636e",
      accent: "#0969da",
      purple: "#8250df",
      green: "#1a7f37",
      yellow: "#9a6700",
    },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    mode: "light",
    descriptionKey: "settings.themeSolarizedLightDescription",
    preview: {
      background: "#eee8d5",
      sidebar: "#eee8d5",
      card: "#fdf6e3",
      foreground: "#586e75",
      muted: "#657b83",
      accent: "#268bd2",
      purple: "#6c71c4",
      green: "#859900",
      yellow: "#b58900",
    },
  },
] as const satisfies readonly ColorTheme[];

export interface ColorThemeState {
  dark: DarkColorThemeId;
  light: LightColorThemeId;
}

const initialState: ColorThemeState = { ...DEFAULT_COLOR_THEMES };
let colorThemeState: ColorThemeState = initialState;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function isColorThemeId(value: string | null | undefined): value is ColorThemeId {
  return COLOR_THEMES.some((theme) => theme.id === value);
}

export function getColorTheme(id: string | null | undefined): ColorTheme {
  return COLOR_THEMES.find((theme) => theme.id === id) ?? COLOR_THEMES[0];
}

export function getDefaultColorTheme(mode: "dark"): DarkColorThemeId;
export function getDefaultColorTheme(mode: "light"): LightColorThemeId;
export function getDefaultColorTheme(mode: ResolvedColorMode): ColorThemeId;
export function getDefaultColorTheme(mode: ResolvedColorMode): ColorThemeId {
  return DEFAULT_COLOR_THEMES[mode];
}

export function readStoredColorTheme(
  mode: "dark",
  storage?: BrandStorage
): DarkColorThemeId;
export function readStoredColorTheme(
  mode: "light",
  storage?: BrandStorage
): LightColorThemeId;
export function readStoredColorTheme(
  mode: ResolvedColorMode,
  storage?: BrandStorage
): ColorThemeId;
export function readStoredColorTheme(
  mode: ResolvedColorMode,
  storage: BrandStorage = window.localStorage
): ColorThemeId {
  const stored = storage.getItem(COLOR_THEME_STORAGE_KEYS[mode]);
  const theme = COLOR_THEMES.find((candidate) => candidate.id === stored);
  return theme?.mode === mode ? theme.id : DEFAULT_COLOR_THEMES[mode];
}

function applyThemeAttributes(state: ColorThemeState): void {
  const root = document.documentElement;
  root.dataset.darkTheme = state.dark;
  root.dataset.lightTheme = state.light;
}

export function initColorThemes(): void {
  colorThemeState = {
    dark: readStoredColorTheme("dark"),
    light: readStoredColorTheme("light"),
  };
  applyThemeAttributes(colorThemeState);
  notify();
}

export function setColorTheme(id: ColorThemeId): ColorThemeId {
  const theme = getColorTheme(id);
  const next = { ...colorThemeState };
  if (theme.mode === "dark") {
    next.dark = theme.id as DarkColorThemeId;
  } else {
    next.light = theme.id as LightColorThemeId;
  }
  colorThemeState = next;
  window.localStorage.setItem(COLOR_THEME_STORAGE_KEYS[theme.mode], theme.id);
  applyThemeAttributes(next);
  notify();
  return theme.id;
}

export function readDocumentColorTheme(mode: "dark"): DarkColorThemeId;
export function readDocumentColorTheme(mode: "light"): LightColorThemeId;
export function readDocumentColorTheme(mode: ResolvedColorMode): ColorThemeId;
export function readDocumentColorTheme(mode: ResolvedColorMode): ColorThemeId {
  const stored = mode === "dark"
    ? document.documentElement.dataset.darkTheme
    : document.documentElement.dataset.lightTheme;
  const theme = COLOR_THEMES.find((candidate) => candidate.id === stored);
  return theme?.mode === mode ? theme.id : DEFAULT_COLOR_THEMES[mode];
}

export function subscribeToColorThemes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getColorThemeState(): ColorThemeState {
  return colorThemeState;
}
