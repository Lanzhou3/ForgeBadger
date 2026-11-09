/**
 * Global Grok Build notification hook.
 *
 * Grok reads `~/.grok/hooks/*.json` (or `$GROK_HOME/hooks`) without a project
 * trust prompt. Project hooks would require `/hooks-trust`, which also trusts
 * repo MCP and LSP servers, so ForgeBadger does not write those.
 *
 * The hook file never contains a session id or attach token. The generated
 * script reads FORGEBADGER_SESSION_ID, FORGEBADGER_ATTACH_TOKEN, and
 * FORGEBADGER_GATEWAY_URL from the process environment and does nothing when
 * any of them is missing, so a Grok session started outside ForgeBadger does
 * not call the Gateway.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { globalConfigRoot } from "./cli-config-target.js";

const HOOK_EVENTS = ["Stop", "StopFailure", "Notification", "PermissionDenied"] as const;
const SCRIPT_NAME = "forgebadger-notify.mjs";
const HOOK_FILE = "forgebadger.json";

export async function ensureGrokNotificationSettings(): Promise<{ path: string; changed: boolean }> {
  const root = path.join(globalConfigRoot("grok"), "hooks");
  const scriptPath = path.join(root, SCRIPT_NAME);
  const hookPath = path.join(root, HOOK_FILE);
  try {
    const scriptChanged = await writeIfChanged(scriptPath, forwardingScript());
    const existing = await readHookDocument(hookPath);
    if (existing === undefined) {
      console.warn(`[grok-notification-settings] existing hook file is invalid, leaving untouched: ${hookPath}`);
      return { path: hookPath, changed: scriptChanged };
    }
    const command = `node ${shellQuote(scriptPath)}`;
    const merged = mergeGrokHooks(existing, command);
    const next = `${JSON.stringify(merged, null, 2)}\n`;
    const hookChanged = await writeIfChanged(hookPath, next);
    return { path: hookPath, changed: scriptChanged || hookChanged };
  } catch (error) {
    console.warn(`[grok-notification-settings] failed to configure hooks at ${root}:`, error);
    return { path: hookPath, changed: false };
  }
}

function mergeGrokHooks(doc: Record<string, unknown>, command: string): Record<string, unknown> {
  const next = { ...doc };
  const hooks = isRecord(next.hooks) ? { ...next.hooks } : {};
  const managed = { type: "command", command, timeout: 5 };
  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event].filter(isRecord) : [];
    const retained = groups.flatMap((group) => {
      const list = Array.isArray(group.hooks) ? group.hooks.filter(isRecord) : [];
      const kept = list.filter((hook) => !isManagedCommand(hook));
      if (kept.length === 0) return [];
      return [{ ...group, hooks: kept }];
    });
    hooks[event] = [...retained, { hooks: [managed] }];
  }
  next.hooks = hooks;
  return next;
}

function isManagedCommand(hook: Record<string, unknown>): boolean {
  return hook.type === "command"
    && typeof hook.command === "string"
    && hook.command.includes(SCRIPT_NAME);
}

function forwardingScript(): string {
  return `// ForgeBadger managed lifecycle hook — do not edit by hand
const chunks = [];
let settled = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => { void finish(); });
setTimeout(() => { void finish(); }, 1000);

async function finish() {
  if (settled) return;
  settled = true;
  const gatewayUrl = process.env.FORGEBADGER_GATEWAY_URL || "";
  const sessionId = process.env.FORGEBADGER_SESSION_ID || "";
  const attachToken = process.env.FORGEBADGER_ATTACH_TOKEN || "";
  if (!gatewayUrl || !sessionId || !attachToken) return;

  let payload = {};
  const raw = chunks.join("");
  if (raw.trim()) {
    try { payload = JSON.parse(raw); } catch { return; }
  }
  try {
    const response = await fetch(
      gatewayUrl.replace(/\\/+$/u, "") + "/api/v1/session-hooks/cli-notification",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forgebadger-session-id": sessionId,
          "x-forgebadger-session-token": attachToken
        },
        body: JSON.stringify({ ...payload, adapter: "grok" }),
        signal: AbortSignal.timeout(4500)
      }
    );
    if (!response.ok) {
      console.warn("[ForgeBadger notifications] Delivery failed (HTTP " + response.status + ").");
    }
  } catch {
    console.warn("[ForgeBadger notifications] Delivery failed: could not reach Gateway.");
  }
}
`;
}

async function readHookDocument(pathname: string): Promise<Record<string, unknown> | undefined> {
  let content: string;
  try {
    content = await readFile(pathname, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw error;
  }
  if (!content.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

async function writeIfChanged(pathname: string, content: string): Promise<boolean> {
  let existing = "";
  try {
    existing = await readFile(pathname, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
  if (existing === content) return false;
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, content, "utf8");
  return true;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
