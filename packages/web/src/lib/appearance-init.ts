import { COLOR_THEMES, COLOR_THEME_STORAGE_KEYS, DEFAULT_COLOR_THEMES } from "./color-theme";
import { COLOR_MODE_STORAGE_KEY } from "./color-mode";

// The same registry drives first paint, settings, and live terminal palettes.
// Only trusted, static theme identifiers are serialized into this script.
export const APPEARANCE_INIT_SCRIPT = `(() => {
  const root = document.documentElement;
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const mode = read(${JSON.stringify(COLOR_MODE_STORAGE_KEY)});
  const dark = mode === "dark" || (mode !== "light" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const darkTheme = read(${JSON.stringify(COLOR_THEME_STORAGE_KEYS.dark)});
  const lightTheme = read(${JSON.stringify(COLOR_THEME_STORAGE_KEYS.light)});
  root.dataset.darkTheme = ${JSON.stringify(COLOR_THEMES.filter((theme) => theme.mode === "dark").map((theme) => theme.id))}.includes(darkTheme) ? darkTheme : ${JSON.stringify(DEFAULT_COLOR_THEMES.dark)};
  root.dataset.lightTheme = ${JSON.stringify(COLOR_THEMES.filter((theme) => theme.mode === "light").map((theme) => theme.id))}.includes(lightTheme) ? lightTheme : ${JSON.stringify(DEFAULT_COLOR_THEMES.light)};
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
})();`;
