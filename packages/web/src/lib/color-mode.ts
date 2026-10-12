import type { BrandStorage } from "./brand-storage";

/**
 * Color mode (light / dark / system): mirrors the accent-theme persistence
 * pattern. The chosen mode is stamped on <html> as a `dark` class (present
 * when the resolved mode is dark) and persisted per user in localStorage.
 * `system` follows `prefers-color-scheme` via matchMedia.
 *
 * The first-paint class is applied by an inline beforeInteractive script in
 * `app/layout.tsx` to avoid a flash; this module is the client-side API used
 * by the settings UI and any runtime listener.
 */

export type ColorMode = "light" | "dark" | "system";
export type ResolvedColorMode = "light" | "dark";

export const COLOR_MODE_STORAGE_KEY = "forgebadger.color-mode";
export const DEFAULT_COLOR_MODE: ColorMode = "system";

const VALID_MODES: readonly ColorMode[] = ["light", "dark", "system"];

export function isColorMode(value: string | null | undefined): value is ColorMode {
  return VALID_MODES.includes(value as ColorMode);
}

/**
 * Resolve a stored mode to a concrete light/dark value. `system` is resolved
 * against the given matchMedia-like matcher (defaults to the live one); an
 * SSR/missing matcher falls back to dark so the terminal-heavy UI does not
 * flash a bright surface.
 */
export function resolveColorMode(
  mode: ColorMode,
  matcher: { matches: boolean } | undefined = typeof window !== "undefined"
    ? window.matchMedia?.("(prefers-color-scheme: dark)")
    : undefined
): ResolvedColorMode {
  if (mode === "system") {
    return matcher?.matches ? "dark" : "light";
  }
  return mode;
}

export function readStoredColorMode(storage: BrandStorage = window.localStorage): ColorMode {
  const stored = storage.getItem(COLOR_MODE_STORAGE_KEY);
  return isColorMode(stored) ? stored : DEFAULT_COLOR_MODE;
}

/**
 * Apply the resolved mode to <html>: toggle the `dark` class and the
 * `color-scheme` style. Returns the resolved mode so callers can update UI
 * state without re-reading the DOM.
 */
export function applyColorMode(
  mode: ColorMode,
  storage: BrandStorage = window.localStorage
): ResolvedColorMode {
  const modeId = isColorMode(mode) ? mode : DEFAULT_COLOR_MODE;
  const resolved = resolveColorMode(modeId);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  storage.setItem(COLOR_MODE_STORAGE_KEY, modeId);
  return resolved;
}

/**
 * Subscribe to system color-scheme changes. Only meaningful when the stored
 * mode is `system`; the caller should re-apply on change. Returns an unsubscribe
 * function (a no-op when matchMedia is unavailable).
 */
export function watchSystemColorMode(
  onChange: (resolved: ResolvedColorMode) => void
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (event: MediaQueryListEvent) => {
    onChange(event.matches ? "dark" : "light");
  };
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}

// --- Reactive store (for useSyncExternalStore) --------------------------------
//
// The resolved mode is document-global state (the `dark` class on <html>), so
// it lives in a module-level store instead of a React context: any mounted
// component (settings UI, live xterm instances) can observe it without a
// provider wrapper, and tests can render consumers without extra setup.

export interface ColorModeState {
  /** The user's stored preference. */
  mode: ColorMode;
  /** The concrete light/dark value actually applied to <html>. */
  resolved: ResolvedColorMode;
}

// `resolved` defaults to "dark" to match the beforeInteractive script's
// first-paint behavior for an empty localStorage on a dark-OS session.
let colorModeState: ColorModeState = { mode: DEFAULT_COLOR_MODE, resolved: "dark" };
const colorModeListeners = new Set<() => void>();

function setColorModeState(next: ColorModeState): void {
  colorModeState = next;
  for (const listener of colorModeListeners) listener();
}

export function subscribeToColorMode(listener: () => void): () => void {
  colorModeListeners.add(listener);
  return () => {
    colorModeListeners.delete(listener);
  };
}

export function getColorModeState(): ColorModeState {
  return colorModeState;
}

/**
 * UI action: switch the color mode. Applies it to <html>, persists the
 * preference, and updates the reactive store. Returns the resolved mode.
 */
export function setColorMode(mode: ColorMode): ResolvedColorMode {
  const modeId = isColorMode(mode) ? mode : DEFAULT_COLOR_MODE;
  const resolved = applyColorMode(modeId);
  setColorModeState({ mode: modeId, resolved });
  return resolved;
}

/**
 * Mount-time bootstrap: sync the store with localStorage + <html> (the
 * beforeInteractive script already painted the correct class), and keep
 * following the OS while the stored mode is `system`. Returns a cleanup
 * function suitable for a React effect.
 */
export function initColorMode(): () => void {
  const stored = readStoredColorMode();
  const resolved = applyColorMode(stored);
  setColorModeState({ mode: stored, resolved });
  return watchSystemColorMode((nextResolved) => {
    if (colorModeState.mode !== "system") return;
    applyColorMode("system");
    setColorModeState({ mode: "system", resolved: nextResolved });
  });
}
