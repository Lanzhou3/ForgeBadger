import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { globalConfigRoot } from "./cli-config-target.js";

/**
 * CLI-native terminal notification settings (plain config keys, NOT hooks).
 *
 * These enable each CLI's own terminal notification feature (OSC 9 / OSC 99 /
 * BEL) so the Session Server daemon can intercept notifications from the PTY
 * byte stream as a channel parallel to the injected hooks. Unlike the hook
 * ensure* functions, these always run — including when the adapter is listed
 * in FORGEBADGER_DISABLE_CLI_HOOKS. See
 * docs/2026-09-22-terminal-native-notifications.md.
 */

/**
 * Kimi Code reads terminal notification settings from the GLOBAL tui.toml
 * (`$KIMI_CODE_HOME/tui.toml`, default `~/.kimi-code/tui.toml`). The default
 * `notification_condition = "unfocused"` never fires in a headless PTY
 * (focus is always true), so it must be pinned to "always". Merged via
 * smol-toml parse/stringify — the same approach cli-config-apply uses for
 * config.toml; all other keys and sections survive the round trip.
 */
export async function ensureKimiTerminalNotificationSettings(): Promise<{ path: string; changed: boolean }> {
  const tuiPath = path.join(globalConfigRoot("kimi"), "tui.toml");
  try {
    const existingText = await readText(tuiPath);
    const doc = parseTomlDocument(existingText, tuiPath);
    if (doc === undefined) return { path: tuiPath, changed: false };

    const notifications = isRecord(doc.notifications) ? doc.notifications : {};
    if (notifications.enabled === true && notifications.notification_condition === "always") {
      return { path: tuiPath, changed: false };
    }
    doc.notifications = { ...notifications, enabled: true, notification_condition: "always" };
    const nextText = `${stringifyToml(doc as never).trimEnd()}\n`;
    await mkdir(path.dirname(tuiPath), { recursive: true });
    await writeFile(tuiPath, nextText, "utf8");
    return { path: tuiPath, changed: true };
  } catch (error) {
    console.warn(`[terminal-notification-settings] failed to configure Kimi tui.toml at ${tuiPath}:`, error);
    return { path: tuiPath, changed: false };
  }
}

/**
 * Claude Code emits a terminal bell on completion/permission prompts when the
 * GLOBAL settings.json (`$CLAUDE_CONFIG_DIR/settings.json`, default
 * `~/.claude/settings.json`) carries `preferredNotifChannel: "terminal_bell"`.
 * This is deliberately NOT the project-local settings.local.json that the
 * ForgeBadger http hook lives in.
 */
export async function ensureClaudeTerminalNotificationSettings(): Promise<{ path: string; changed: boolean }> {
  const settingsPath = path.join(globalConfigRoot("claude"), "settings.json");
  try {
    const existing = await readJsonObject(settingsPath);
    if (existing.preferredNotifChannel === "terminal_bell") {
      return { path: settingsPath, changed: false };
    }
    const next = { ...existing, preferredNotifChannel: "terminal_bell" };
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return { path: settingsPath, changed: true };
  } catch (error) {
    console.warn(`[terminal-notification-settings] failed to configure Claude settings.json at ${settingsPath}:`, error);
    return { path: settingsPath, changed: false };
  }
}

/**
 * OpenCode's TUI attention notifications are off by default; the global
 * tui.json (`$OPENCODE_CONFIG_DIR/tui.json`, else `$XDG_CONFIG_HOME/opencode/tui.json`,
 * default `~/.config/opencode/tui.json`) needs `attention.enabled = true`.
 */
export async function ensureOpenCodeTerminalNotificationSettings(): Promise<{ path: string; changed: boolean }> {
  const tuiPath = path.join(globalConfigRoot("opencode"), "tui.json");
  try {
    const existing = await readJsonObject(tuiPath);
    const attention = isRecord(existing.attention) ? existing.attention : {};
    if (attention.enabled === true) {
      return { path: tuiPath, changed: false };
    }
    const next = { ...existing, attention: { ...attention, enabled: true } };
    await mkdir(path.dirname(tuiPath), { recursive: true });
    await writeFile(tuiPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return { path: tuiPath, changed: true };
  } catch (error) {
    console.warn(`[terminal-notification-settings] failed to configure OpenCode tui.json at ${tuiPath}:`, error);
    return { path: tuiPath, changed: false };
  }
}

/**
 * Parses existing TOML; returns undefined (fail-open, no write) when the file
 * exists but is invalid — clobbering a malformed user file would destroy it.
 */
function parseTomlDocument(content: string, targetPath: string): Record<string, unknown> | undefined {
  if (!content.trim()) return {};
  try {
    const value: unknown = parseToml(content);
    if (!isRecord(value)) return undefined;
    return value;
  } catch (error) {
    console.warn(`[terminal-notification-settings] existing TOML is invalid, leaving untouched: ${targetPath}:`, error);
    return undefined;
  }
}

async function readJsonObject(pathname: string): Promise<Record<string, unknown>> {
  const content = await readText(pathname);
  if (!content.trim()) return {};
  const parsed: unknown = JSON.parse(content);
  return isRecord(parsed) ? parsed : {};
}

async function readText(pathname: string): Promise<string> {
  try {
    return await readFile(pathname, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return "";
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
