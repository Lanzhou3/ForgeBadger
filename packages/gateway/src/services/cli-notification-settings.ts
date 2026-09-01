import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { safeResolve } from "../lib/safe-resolve.js";

type NotificationAdapter = "codex" | "kimi";

interface CodexHookCommand {
  type: "command";
  command: string;
  timeout: number;
}

interface CodexHookGroup {
  hooks: Array<CodexHookCommand | Record<string, unknown>>;
  [key: string]: unknown;
}

// Kimi Code's hook system is Beta and global-only: `[[hooks]]` rules are read
// from ~/.kimi-code/config.toml (or $KIMI_CODE_HOME), never from a project
// config. Keep this lifecycle set aligned with Kimi's documented event names.
const kimiHookEvents = [
  "PermissionRequest",
  "Stop",
  "Interrupt",
  "StopFailure",
  "SessionEnd",
  "Notification"
] as const;
const codexEvents = ["PermissionRequest", "Stop", "SessionEnd"] as const;

/**
 * Materialize the project-local Codex hook bundle without replacing user
 * groups or commands. Codex applies its own trust gate to project hooks, so
 * this function deliberately does not add the bypass flag to the launch plan.
 * Path validation happens before the fail-open block: a symlink escape or
 * denied project root remains a hard security error, while ordinary read/write
 * failures merely disable notifications for this launch.
 */
export async function ensureCodexNotificationSettings(
  projectRoot: string
): Promise<{ path: string; changed: boolean }> {
  const hooksPath = safeResolve(projectRoot, ".codex/hooks.json");
  const scriptPath = safeResolve(projectRoot, ".codex/hooks/forgebadger-notify.mjs");
  try {
    const existing = await readJsonObject(hooksPath);
    const next = mergeCodexHooks(existing, scriptPath);
    const scriptChanged = await writeIfChanged(scriptPath, forwardingScript("codex"));
    const settingsChanged = JSON.stringify(existing) !== JSON.stringify(next);

    if (settingsChanged) {
      await mkdir(path.dirname(hooksPath), { recursive: true });
      await writeFile(hooksPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    }
    return { path: hooksPath, changed: scriptChanged || settingsChanged };
  } catch (error) {
    console.warn(`[cli-notification-settings] failed to configure Codex hooks at ${hooksPath}:`, error);
    return { path: hooksPath, changed: false };
  }
}

/**
 * Kimi Code only loads `[[hooks]]` from the GLOBAL config
 * (`$KIMI_CODE_HOME/config.toml`, default `~/.kimi-code/config.toml`) — a
 * project-level `.kimi-code/config.toml` hook block is silently never read.
 * The managed block therefore lives in the global config and points at one
 * shared forwarding script in the ForgeBadger state dir; session identity comes
 * from tmux env at runtime, so non-ForgeBadger Kimi sessions no-op quietly.
 *
 * Also strips the obsolete per-project managed block that earlier versions
 * wrote into `<project>/.kimi-code/config.toml`.
 */
export async function ensureKimiNotificationSettings(
  projectRoot: string
): Promise<{ path: string; changed: boolean }> {
  const kimiHome = process.env.KIMI_CODE_HOME?.trim() || path.join(os.homedir(), ".kimi-code");
  const stateDir =
    process.env.FORGEBADGER_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".forgebadger");
  const configPath = path.join(kimiHome, "config.toml");
  const scriptPath = path.join(stateDir, "hooks", "kimi-notify.mjs");
  try {
    const existingText = await readText(configPath);
    const nextText = mergeKimiHookText(existingText, scriptPath);
    const scriptChanged = await writeIfChanged(scriptPath, forwardingScript("kimi"));
    const settingsChanged = existingText !== nextText;

    if (settingsChanged) {
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, nextText, "utf8");
    }
    const projectCleaned = await stripProjectKimiHookBlock(projectRoot);
    return { path: configPath, changed: scriptChanged || settingsChanged || projectCleaned };
  } catch (error) {
    console.warn(`[cli-notification-settings] failed to configure Kimi hooks at ${configPath}:`, error);
    return { path: configPath, changed: false };
  }
}

/** Best-effort removal of the legacy project-level managed block (never read by Kimi). */
async function stripProjectKimiHookBlock(projectRoot: string): Promise<boolean> {
  try {
    const configPath = safeResolve(projectRoot, ".kimi-code/config.toml");
    const existingText = await readText(configPath);
    if (!existingText) return false;
    const stripped = existingText
      .replace(/\n?# ForgeBadger managed notification hooks: start\n[\s\S]*?# ForgeBadger managed notification hooks: end\n?/u, "")
      .replace(/\n+$/u, "");
    if (stripped === existingText) return false;
    await writeFile(configPath, stripped.length > 0 ? `${stripped}\n` : stripped, "utf8");
    return true;
  } catch {
    return false;
  }
}

function mergeCodexHooks(existing: Record<string, unknown>, scriptPath: string): Record<string, unknown> {
  const next = cloneRecord(existing);
  const hooks = isRecord(next.hooks) ? { ...next.hooks } : {};

  for (const event of codexEvents) {
    const command: CodexHookCommand = {
      type: "command",
      command: `node ${shellQuote(scriptPath)}`,
      timeout: event === "SessionEnd" ? 3 : 5
    };
    hooks[event] = mergeCodexHookGroups(hooks[event], command);
  }
  next.hooks = hooks;
  return next;
}

// A Codex event may have several matcher groups. ForgeBadger has no matcher, so
// its command belongs in the first catch-all group while every other group is
// retained unchanged.
function mergeCodexHookGroups(value: unknown, command: CodexHookCommand): CodexHookGroup[] {
  const groups = Array.isArray(value) ? value.filter(isRecord) : [];
  if (groups.length === 0) {
    return [{ hooks: [command] }];
  }

  return groups.map((group, index) => {
    if (index !== 0) return group as CodexHookGroup;
    const existingHooks = Array.isArray(group.hooks) ? group.hooks.filter(isRecord) : [];
    const hooks = existingHooks.filter((hook) => !isForgeBadgerCommand(hook.command));
    return { ...group, hooks: [...hooks, command] } as CodexHookGroup;
  });
}

function mergeKimiHookText(existing: string, scriptPath: string): string {
  const preserved = existing
    .replace(/\n?# ForgeBadger managed notification hooks: start\n[\s\S]*?# ForgeBadger managed notification hooks: end\n?/u, "")
    .replace(/\n+$/u, "");
  const command = `node ${shellQuote(scriptPath)}`;
  const managed = kimiHookEvents.flatMap((event) => [
    "[[hooks]]",
    `event = ${JSON.stringify(event)}`,
    `command = ${JSON.stringify(command)}`,
    "timeout = 5",
    ""
  ]);
  const prefix = preserved.length > 0 ? `${preserved}\n\n` : "";
  return `${prefix}# ForgeBadger managed notification hooks: start\n${managed.join("\n")}# ForgeBadger managed notification hooks: end\n`;
}

function forwardingScript(adapter: NotificationAdapter): string {
  // The generated hook has no project secrets embedded in it. Session identity,
  // Gateway location, and the short-lived attach token come from tmux env at
  // runtime, matching the existing Claude and OpenCode notification paths.
  return `// ForgeBadger managed lifecycle hook — do not edit by hand
const chunks = [];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", async () => {
  const gatewayUrl = process.env.FORGEBADGER_GATEWAY_URL || "";
  const sessionId = process.env.FORGEBADGER_SESSION_ID || "";
  const attachToken = process.env.FORGEBADGER_ATTACH_TOKEN || "";
  if (!gatewayUrl || !sessionId || !attachToken) return;

  let payload = {};
  try { payload = JSON.parse(chunks.join("")); } catch { return; }
  const requestTimeoutMs = ${
    adapter === "codex" ? 'payload.hook_event_name === "SessionEnd" ? 2500 : 4500' : "4500"
  };
  try {
    await fetch(
      gatewayUrl.replace(/\\/+$/u, "") + "/api/v1/session-hooks/claude-notification/" + encodeURIComponent(sessionId),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forgebadger-session-id": sessionId,
          "x-forgebadger-session-token": attachToken
        },
        body: JSON.stringify({ ...payload, adapter: "${adapter}" }),
        signal: AbortSignal.timeout(requestTimeoutMs)
      }
    );
  } catch {
    // Notification delivery is fail-open and must never block the CLI.
  }
});
`;
}

async function writeIfChanged(pathname: string, content: string): Promise<boolean> {
  // Avoid touching mtime because both CLIs reload project configuration based
  // on file changes and users may have their own file watchers.
  const existing = await readText(pathname);
  if (existing === content) return false;
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, content, "utf8");
  return true;
}

async function readJsonObject(pathname: string): Promise<Record<string, unknown>> {
  const content = await readText(pathname);
  if (!content) return {};
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function isForgeBadgerCommand(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.includes("forgebadger-notify.mjs")
  );
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
