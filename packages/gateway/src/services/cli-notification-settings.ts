import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseToml } from "smol-toml";

import { safeResolve } from "../lib/safe-resolve.js";
import { expandUserPath } from "../lib/user-path.js";
import { globalConfigRoot } from "./cli-config-target.js";

type NotificationAdapter = "codex" | "kimi" | "pi";

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
  "UserPromptSubmit",
  "TurnStarted",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
  "Interrupt",
  "StopFailure",
  "SessionEnd",
  "Notification"
] as const;
const codexEvents = ["UserPromptSubmit", "PostToolUse", "PermissionRequest", "Stop", "SessionEnd"] as const;

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
 * from the session environment at runtime, so non-ForgeBadger Kimi sessions no-op quietly.
 *
 * Also strips the obsolete per-project managed block that earlier versions
 * wrote into `<project>/.kimi-code/config.toml`.
 */
export async function ensureKimiNotificationSettings(
  projectRoot: string
): Promise<{ path: string; changed: boolean }> {
  const kimiHome = path.resolve(expandUserPath(
    process.env.KIMI_CODE_HOME?.trim() || path.join(os.homedir(), ".kimi-code")
  ));
  const stateDir = path.resolve(expandUserPath(
    process.env.FORGEBADGER_STATE_DIR?.trim() || path.join(os.homedir(), ".forgebadger")
  ));
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

/**
 * PI loads extensions from the GLOBAL config dir (`<PI_CODING_AGENT_DIR | ~/.pi/agent>/extensions/`)
 * at startup for every project — no project-local file, no trust prompt, no per-project
 * merge. The managed extension reads session identity from the environment at runtime,
 * so PI sessions started outside ForgeBadger (no FORGEBADGER_* env) no-op quietly.
 *
 * Event mapping (pi 0.86.0, verified against dist/core/extensions/types.d.ts):
 * - `agent_settled`      -> Stop            (task_completed; fires once per settled turn)
 * - `ui_prompt_start`    -> PermissionRequest (pi is waiting on a blocking user prompt)
 * - `session_shutdown`   -> SessionEnd      (quit/reload/new/resume/fork)
 */
export async function ensurePiNotificationSettings(): Promise<{ path: string; changed: boolean }> {
  const extensionsDir = path.join(globalConfigRoot("pi"), "extensions");
  const extensionPath = path.join(extensionsDir, "forgebadger-notify.ts");
  try {
    const changed = await writeIfChanged(extensionPath, piNotificationExtension());
    return { path: extensionPath, changed };
  } catch (error) {
    console.warn(`[cli-notification-settings] failed to configure PI extension at ${extensionPath}:`, error);
    return { path: extensionPath, changed: false };
  }
}

/**
 * Generated PI extension source. Deliberately JS-compatible TypeScript (pi loads
 * it through jiti); no type annotations, no imports, no secrets — the gateway URL,
 * session id, and attach token all come from the session environment at runtime.
 */
function piNotificationExtension(): string {
  return `// ForgeBadger managed PI notification extension — do not edit by hand.
// Session identity comes from the FORGEBADGER_* environment; sessions started
// outside ForgeBadger simply do nothing.
export default function (pi) {
  const sessionId = process.env.FORGEBADGER_SESSION_ID || "";
  const gatewayUrl = process.env.FORGEBADGER_GATEWAY_URL || "";
  const attachToken = process.env.FORGEBADGER_ATTACH_TOKEN || "";
  if (!sessionId || !gatewayUrl || !attachToken) return;

  const post = async (hookEventName, extra) => {
    try {
      const url =
        gatewayUrl.replace(/\\/+$/u, "") +
        "/api/v1/session-hooks/cli-notification/" +
        encodeURIComponent(sessionId);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forgebadger-session-id": sessionId,
          "x-forgebadger-session-token": attachToken
        },
        body: JSON.stringify({ hook_event_name: hookEventName, adapter: "pi", ...extra }),
        signal: AbortSignal.timeout(4500)
      });
      if (!response.ok) {
        const hint = response.status === 401
          ? " Restart this CLI session from ForgeBadger to refresh its notification identity."
          : " Check that the ForgeBadger Gateway is available.";
        console.warn("[ForgeBadger notifications] Delivery failed (HTTP " + response.status + ")." + hint);
      }
    } catch {
      // Fail-open; never print credentials, response bodies, or exception messages.
      console.warn("[ForgeBadger notifications] Delivery failed: could not reach Gateway.");
    }
  };

  let finalReply = "";
  let active = false;
  pi.on("message_end", (event, context) => {
    if (context?.hasUI !== true || !active || event.message?.role !== "assistant") return;
    const content = event.message.content;
    const text = Array.isArray(content) ? content.filter(part => part?.type === "text" && typeof part.text === "string")
      .map(part => part.text).join("\\n") : "";
    // Drop an oversized field as a whole. Never truncate a credential before
    // Gateway normalization/redaction, and never collect reasoning blocks.
    finalReply = Buffer.byteLength(text, "utf8") <= 256 * 1024 ? text : "";
  });
  pi.on("agent_settled", async (_event, context) => {
    if (context?.hasUI !== true) return;
    const reply = finalReply;
    finalReply = ""; active = false;
    await post("Stop", reply ? { last_assistant_message: reply } : {});
  });

  pi.on("agent_start", async (_event, context) => {
    if (context?.hasUI !== true) return;
    if (!active) finalReply = "";
    active = true;
    await post("TaskStarted");
  });

  pi.on("ui_prompt_start", (event, context) => {
    if (context?.hasUI !== true) return;
    const title = typeof event.title === "string" && event.title ? event.title : "";
    const kind = typeof event.kind === "string" && event.kind ? event.kind : "input";
    post("PermissionRequest", {
      message: "PI is waiting for your " + kind + (title ? ": " + title : "")
    });
  });

  pi.on("session_shutdown", async () => {
    finalReply = ""; active = false;
    // Awaited: pi waits for session_shutdown handlers before process exit, so
    // the report lands instead of dying with the in-flight fetch.
    await post("SessionEnd");
  });
}
`;
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
  const command = `node ${shellQuote(scriptPath)}`;
  const unmarked = existing.replace(
    /\n?# ForgeBadger managed notification hooks: start\r?\n[\s\S]*?# ForgeBadger managed notification hooks: end\r?\n?/gu,
    ""
  );
  const preserved = removeDuplicateKimiHooks(unmarked, command).replace(/\n+$/u, "");
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

/** Retire only exact managed definitions; user matchers/commands/timeouts survive. */
function removeDuplicateKimiHooks(text: string, command: string): string {
  const doc = parseKimiHookConfig(text);
  if (!Array.isArray(doc.hooks)) return text;
  const managed = (hook: unknown): boolean => isRecord(hook)
    && hook.command === command && hook.timeout === 5
    && kimiHookEvents.some((event) => event === hook.event)
    && Object.keys(hook).every((key) => ["event", "command", "timeout"].includes(key));
  const retained = doc.hooks.filter((hook) => !managed(hook));
  if (retained.length === doc.hooks.length) return text;
  const candidate = text.split(/(?=^\s*\[)/mu).filter((section) => {
    if (!/^\s*\[\[hooks\]\]/u.test(section)) return true;
    try {
      const parsed = parseToml(section);
      return !Array.isArray(parsed.hooks) || parsed.hooks.length !== 1 || !managed(parsed.hooks[0]);
    } catch { return true; }
  }).join("");
  if (retained.length) doc.hooks = retained;
  else delete doc.hooks;
  // Text splitting is only an editing aid. Parsing the entire result proves
  // multiline strings, nested tables and unrelated settings remain unchanged.
  if (!isDeepStrictEqual(parseKimiHookConfig(candidate), doc)) {
    throw new Error("Cannot safely consolidate Kimi notification hooks");
  }
  return candidate;
}

function parseKimiHookConfig(text: string): Record<string, unknown> {
  try { return parseToml(text); }
  catch {
    // TOML parser errors include source excerpts, which can contain credentials.
    throw new Error("Invalid Kimi configuration; notification hooks unchanged");
  }
}

function forwardingScript(adapter: NotificationAdapter): string {
  // The generated hook has no project secrets embedded in it. Session identity,
  // Gateway location, and the short-lived attach token come from the session
  // environment at runtime, matching the existing Claude and OpenCode
  // notification paths.
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
    const response = await fetch(
      gatewayUrl.replace(/\\/+$/u, "") + "/api/v1/session-hooks/cli-notification/" + encodeURIComponent(sessionId),
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
    if (!response.ok) {
      const hint = response.status === 401
        ? " Restart this CLI session from ForgeBadger to refresh its notification identity."
        : " Check that the ForgeBadger Gateway is available.";
      console.warn("[ForgeBadger notifications] Delivery failed (HTTP " + response.status + ")." + hint);
    }
  } catch {
    // Never print URLs, tokens, response bodies, or exception messages.
    // Delivery remains fail-open so a notification cannot fail the CLI turn.
    console.warn("[ForgeBadger notifications] Delivery failed: could not reach Gateway.");
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
