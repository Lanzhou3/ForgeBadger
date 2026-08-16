import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { safeResolve } from "../lib/safe-resolve.js";

export interface ClaudeCommandHook {
  type: "command";
  command: string;
  timeout: number;
}

export interface ClaudeHttpHook {
  type: "http";
  url: string;
  headers: Record<string, string>;
  allowedEnvVars: string[];
  timeout: number;
}

type ClaudeOpenForgeHook = ClaudeCommandHook | ClaudeHttpHook;

export interface ClaudeHookGroup {
  matcher?: string | undefined;
  hooks: Array<ClaudeOpenForgeHook | Record<string, unknown>>;
}

export interface ClaudeHookSettings {
  allowedHttpHookUrls: string[];
  httpHookAllowedEnvVars: string[];
  hooks: Record<string, unknown> & {
    PermissionRequest: ClaudeHookGroup[];
    PermissionDenied: ClaudeHookGroup[];
    Stop: ClaudeHookGroup[];
    SessionEnd: ClaudeHookGroup[];
    Notification: ClaudeHookGroup[];
  };
}

export function buildOpenForgeClaudeHookSettings(gatewayUrl: string, sessionId?: string): ClaudeHookSettings {
  const httpHook = buildOpenForgeHttpHook(gatewayUrl, sessionId);
  return {
    allowedHttpHookUrls: [openForgeHookUrlAllowlist(gatewayUrl)],
    httpHookAllowedEnvVars: openForgeHookEnvVars(),
    hooks: {
      PermissionRequest: [
        {
          hooks: [httpHook]
        }
      ],
      PermissionDenied: [
        {
          hooks: [httpHook]
        }
      ],
      Stop: [
        {
          hooks: [httpHook]
        }
      ],
      SessionEnd: [
        {
          hooks: [httpHook]
        }
      ],
      Notification: [
        {
          matcher: "permission_prompt",
          hooks: [httpHook]
        }
      ]
    }
  };
}

export async function ensureClaudeNotificationSettings(
  projectRoot: string,
  gatewayUrl: string,
  sessionId?: string
): Promise<{ path: string; changed: boolean }> {
  const settingsPath = safeResolve(projectRoot, ".claude/settings.local.json");
  const existing = await readJsonObject(settingsPath);
  const merged = mergeOpenForgeHookSettings(existing, gatewayUrl, sessionId);
  const changed = JSON.stringify(existing) !== JSON.stringify(merged);

  if (changed) {
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  }

  return { path: settingsPath, changed };
}

/**
 * Installs only the worker SessionStart hook. The capability is deliberately
 * absent from the JSON settings: Claude resolves it from the worker process
 * environment at hook time.
 */
export async function ensureClaudePortfolioWorkerHookSettings(
  projectRoot: string,
  gatewayUrl: string,
  sessionId: string
): Promise<{ path: string; changed: boolean }> {
  const settingsPath = safeResolve(projectRoot, ".claude/settings.local.json");
  const existing = await readJsonObject(settingsPath);
  const merged = mergeClaudePortfolioWorkerHookSettings(existing, gatewayUrl, sessionId);
  const changed = JSON.stringify(existing) !== JSON.stringify(merged);

  if (changed) {
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  }

  return { path: settingsPath, changed };
}

function mergeOpenForgeHookSettings(
  existing: Record<string, unknown>,
  gatewayUrl: string,
  sessionId?: string
): Record<string, unknown> {
  const next = cloneRecord(existing);
  const existingHooks = isRecord(next.hooks) ? next.hooks : {};
  const hooks: Record<string, unknown> = { ...existingHooks };
  const openForgeHook = buildOpenForgeHttpHook(gatewayUrl, sessionId);

  hooks.PermissionRequest = ensureHookGroup(
    hooks.PermissionRequest,
    undefined,
    openForgeHook
  );
  hooks.PermissionDenied = ensureHookGroup(
    hooks.PermissionDenied,
    undefined,
    openForgeHook
  );
  hooks.Stop = ensureHookGroup(hooks.Stop, undefined, openForgeHook);
  hooks.SessionEnd = ensureHookGroup(hooks.SessionEnd, undefined, openForgeHook);
  hooks.Notification = ensureHookGroup(
    hooks.Notification,
    "permission_prompt",
    openForgeHook
  );
  next.allowedHttpHookUrls = mergeStringList(
    next.allowedHttpHookUrls,
    openForgeHookUrlAllowlist(gatewayUrl)
  );
  next.httpHookAllowedEnvVars = mergeStringList(
    next.httpHookAllowedEnvVars,
    ...openForgeHookEnvVars()
  );
  next.hooks = hooks;
  return next;
}

function mergeClaudePortfolioWorkerHookSettings(
  existing: Record<string, unknown>,
  gatewayUrl: string,
  sessionId: string
): Record<string, unknown> {
  const next = cloneRecord(existing);
  const existingHooks = isRecord(next.hooks) ? next.hooks : {};
  const hooks: Record<string, unknown> = { ...existingHooks };
  const workerHook = buildClaudePortfolioWorkerHttpHook(gatewayUrl, sessionId);

  hooks.SessionStart = ensureHookGroup(hooks.SessionStart, undefined, workerHook);
  next.allowedHttpHookUrls = mergeStringList(
    next.allowedHttpHookUrls,
    workerHookUrlAllowlist(gatewayUrl)
  );
  next.httpHookAllowedEnvVars = mergeStringList(
    next.httpHookAllowedEnvVars,
    ...workerHook.allowedEnvVars
  );
  next.hooks = hooks;
  return next;
}

/**
 * Build the isolated worker-only SessionStart hook. Its header references a
 * process-local capability variable; the raw HMAC is never written to JSON.
 */
export function buildClaudePortfolioWorkerHookSettings(
  gatewayUrl: string,
  sessionId?: string
): ClaudeHookSettings {
  const workerHook = buildClaudePortfolioWorkerHttpHook(gatewayUrl, sessionId);
  return {
    allowedHttpHookUrls: [workerHookUrlAllowlist(gatewayUrl)],
    httpHookAllowedEnvVars: workerHook.allowedEnvVars,
    hooks: {
      SessionStart: [{ hooks: [workerHook] }],
      PermissionRequest: [],
      PermissionDenied: [],
      Stop: [],
      SessionEnd: [],
      Notification: []
    }
  };
}

function ensureHookGroup(
  value: unknown,
  matcher: string | undefined,
  hook: ClaudeOpenForgeHook
): ClaudeHookGroup[] {
  const groups = Array.isArray(value) ? normalizeHookGroups(value) : [];
  const nextGroups: ClaudeHookGroup[] = [];
  let handled = false;

  for (const group of groups) {
    if (group.matcher !== matcher) {
      nextGroups.push(group);
      continue;
    }

    // Replacing prior OpenForge hooks prevents a later worker launch from
    // retaining a stale session-specific SessionStart target.
    const hooks = group.hooks.filter((item) => !isOpenForgeManagedHook(item));
    if (!handled && !hooks.some((item) => isSameOpenForgeHook(item, hook))) {
      hooks.push(hook);
    }
    nextGroups.push({ ...group, hooks });
    handled = true;
  }

  if (handled) {
    return nextGroups;
  }

  return [...nextGroups, matcher === undefined ? { hooks: [hook] } : { matcher, hooks: [hook] }];
}

function normalizeHookGroups(value: unknown): ClaudeHookGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((group) => {
      const hooks = Array.isArray(group.hooks)
        ? group.hooks.filter(isRecord)
        : [];
      return {
        ...(typeof group.matcher === "string" ? { matcher: group.matcher } : {}),
        hooks
      };
    });
}

function buildOpenForgeHttpHook(gatewayUrl: string, sessionId?: string): ClaudeHttpHook {
  const sessionPath = sessionId ? `/${encodeURIComponent(sessionId)}` : "";
  return {
    type: "http",
    url: `${gatewayUrl.replace(/\/+$/u, "")}/api/v1/session-hooks/claude-notification${sessionPath}`,
    headers: {
      "x-openforge-session-id": "$OPENFORGE_SESSION_ID",
      "x-openforge-session-token": "$OPENFORGE_ATTACH_TOKEN"
    },
    allowedEnvVars: ["OPENFORGE_SESSION_ID", "OPENFORGE_ATTACH_TOKEN"],
    timeout: 5
  };
}

function buildClaudePortfolioWorkerHttpHook(gatewayUrl: string, sessionId?: string): ClaudeHttpHook {
  const sessionPath = sessionId ? `/${encodeURIComponent(sessionId)}` : "";
  return {
    type: "http",
    url: `${gatewayUrl.replace(/\/+$/u, "")}/api/v1/session-hooks/claude-portfolio-worker${sessionPath}`,
    headers: {
      "x-openforge-session-id": "$OPENFORGE_SESSION_ID",
      "x-openforge-portfolio-worker-capability": "$OPENFORGE_PORTFOLIO_WORKER_ACK_CAPABILITY"
    },
    allowedEnvVars: ["OPENFORGE_SESSION_ID", "OPENFORGE_PORTFOLIO_WORKER_ACK_CAPABILITY"],
    timeout: 5
  };
}

function openForgeHookUrlAllowlist(gatewayUrl: string): string {
  const trimmed = gatewayUrl.replace(/\/+$/u, "");
  try {
    const url = new URL(trimmed);
    return `${url.origin}/api/v1/session-hooks/claude-notification*`;
  } catch {
    return `${trimmed}/api/v1/session-hooks/claude-notification*`;
  }
}

function workerHookUrlAllowlist(gatewayUrl: string): string {
  const trimmed = gatewayUrl.replace(/\/+$/u, "");
  try {
    const url = new URL(trimmed);
    return `${url.origin}/api/v1/session-hooks/claude-portfolio-worker*`;
  } catch {
    return `${trimmed}/api/v1/session-hooks/claude-portfolio-worker*`;
  }
}

function openForgeHookEnvVars(): string[] {
  return ["OPENFORGE_SESSION_ID", "OPENFORGE_ATTACH_TOKEN"];
}

function mergeStringList(value: unknown, ...items: string[]): string[] {
  const current = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  for (const item of items) {
    if (!current.includes(item)) {
      current.push(item);
    }
  }

  return current;
}

function isSameOpenForgeHook(
  value: ClaudeOpenForgeHook | Record<string, unknown>,
  expected: ClaudeOpenForgeHook
): boolean {
  if (value.type !== expected.type) return false;
  if (value.type === "command" && expected.type === "command") {
    return value.command === expected.command;
  }
  if (value.type === "http" && expected.type === "http") {
    return value.url === expected.url;
  }
  return false;
}

function isOpenForgeNotificationHook(value: ClaudeOpenForgeHook | Record<string, unknown>): boolean {
  if (value.type === "command") {
    return (
      typeof value.command === "string" &&
      value.command.includes("/api/v1/session-hooks/claude-notification")
    );
  }
  if (value.type === "http") {
    return (
      typeof value.url === "string" &&
      value.url.includes("/api/v1/session-hooks/claude-notification")
    );
  }
  return false;
}

function isOpenForgeManagedHook(value: ClaudeOpenForgeHook | Record<string, unknown>): boolean {
  return isOpenForgeNotificationHook(value) || isOpenForgePortfolioWorkerHook(value);
}

function isOpenForgePortfolioWorkerHook(value: ClaudeOpenForgeHook | Record<string, unknown>): boolean {
  if (value.type === "command") {
    return (
      typeof value.command === "string"
      && value.command.includes("/api/v1/session-hooks/claude-portfolio-worker")
    );
  }
  if (value.type === "http") {
    return (
      typeof value.url === "string"
      && value.url.includes("/api/v1/session-hooks/claude-portfolio-worker")
    );
  }
  return false;
}

async function readJsonObject(pathname: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(pathname, "utf8");
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
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
