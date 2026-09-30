import type { BrandStorage } from "./brand-storage";

/**
 * Terminal font preference (family + size): persisted per browser in
 * localStorage and observed by the xterm instances via a module-level store
 * (same pattern as color-mode.ts). The default family leads with the bundled
 * "ForgeBadger Nerd" font (see globals.css @font-face) so Oh My Posh /
 * oh-my-zsh-style prompts render Nerd glyphs out of the box; users can
 * override with any installed font family name.
 */

export interface TerminalFontSettings {
  /** CSS font-family list applied to xterm. */
  fontFamily: string;
  /** xterm font size in px. */
  fontSize: number;
}

export const TERMINAL_FONT_STORAGE_KEY = "forgebadger.terminal-font";

export const DEFAULT_TERMINAL_FONT: TerminalFontSettings = {
  fontFamily:
    '"ForgeBadger Nerd", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: 14,
};

export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 32;

const MAX_FAMILY_LENGTH = 200;

function clampFontSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TERMINAL_FONT.fontSize;
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(value)));
}

/** Parse + validate a stored JSON payload; anything malformed → defaults. */
export function parseTerminalFont(value: string | null | undefined): TerminalFontSettings {
  if (!value) return DEFAULT_TERMINAL_FONT;
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    const family = typeof raw.fontFamily === "string" ? raw.fontFamily.trim() : "";
    if (family.length === 0 || family.length > MAX_FAMILY_LENGTH) {
      return { fontFamily: DEFAULT_TERMINAL_FONT.fontFamily, fontSize: clampFontSize(raw.fontSize) };
    }
    return { fontFamily: family, fontSize: clampFontSize(raw.fontSize) };
  } catch {
    return DEFAULT_TERMINAL_FONT;
  }
}

export function readStoredTerminalFont(storage: BrandStorage = window.localStorage): TerminalFontSettings {
  return parseTerminalFont(storage.getItem(TERMINAL_FONT_STORAGE_KEY));
}

export function writeTerminalFont(settings: TerminalFontSettings, storage: BrandStorage = window.localStorage): void {
  const sanitized: TerminalFontSettings = {
    fontFamily: settings.fontFamily.trim().length > 0 ? settings.fontFamily.trim() : DEFAULT_TERMINAL_FONT.fontFamily,
    fontSize: clampFontSize(settings.fontSize),
  };
  storage.setItem(TERMINAL_FONT_STORAGE_KEY, JSON.stringify(sanitized));
}

// --- Reactive store (for useSyncExternalStore) -------------------------------

let terminalFontState: TerminalFontSettings = DEFAULT_TERMINAL_FONT;
const terminalFontListeners = new Set<() => void>();

function setTerminalFontState(next: TerminalFontSettings): void {
  terminalFontState = next;
  for (const listener of terminalFontListeners) listener();
}

export function subscribeToTerminalFont(listener: () => void): () => void {
  terminalFontListeners.add(listener);
  return () => {
    terminalFontListeners.delete(listener);
  };
}

export function getTerminalFontState(): TerminalFontSettings {
  return terminalFontState;
}

/** UI action: apply + persist the font settings, updating live terminals. */
export function setTerminalFont(settings: TerminalFontSettings): TerminalFontSettings {
  const family = settings.fontFamily.trim().length > 0 ? settings.fontFamily.trim() : DEFAULT_TERMINAL_FONT.fontFamily;
  const next: TerminalFontSettings = { fontFamily: family, fontSize: clampFontSize(settings.fontSize) };
  writeTerminalFont(next);
  setTerminalFontState(next);
  return next;
}

/**
 * Mount-time bootstrap: sync the store with localStorage (no DOM side
 * effects; xterm instances read the store at creation and via the
 * subscription). Returns a no-op cleanup for effect symmetry.
 */
export function initTerminalFont(): () => void {
  setTerminalFontState(readStoredTerminalFont());
  return () => {};
}

/**
 * Ensure the bundled "ForgeBadger Nerd" faces are loaded before an xterm
 * instance renders, so the first frame already uses Nerd glyphs. No-op when
 * the CSS Font Loading API is unavailable or the active family does not use
 * the bundled font.
 */
export async function ensureTerminalFontLoaded(family: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  if (!family.includes("ForgeBadger Nerd")) return;
  try {
    await document.fonts.load('400 14px "ForgeBadger Nerd"');
    await document.fonts.load('700 14px "ForgeBadger Nerd"');
  } catch {
    // Font load failures degrade to the next font in the stack.
  }
}
