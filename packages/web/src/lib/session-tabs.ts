import type { Session } from "@/lib/api";

export interface SessionTab {
  id: string;
  label: string;
  projectName?: string;
  aiTool?: string;
  status?: string;
  updatedAt: number;
}

const SESSION_TABS_KEY = "openforge.sessionTabs.v1";
const MAX_SESSION_TABS = 8;

export function sessionToTab(session: Session, now = Date.now()): SessionTab {
  return {
    id: session.id,
    label: session.name || session.tmuxName || session.tmuxSession || session.id,
    ...(session.projectName ? { projectName: session.projectName } : {}),
    ...(session.aiTool ? { aiTool: session.aiTool } : {}),
    ...(session.status ? { status: session.status } : {}),
    updatedAt: now
  };
}

export function readSessionTabs(storage: Pick<Storage, "getItem"> = window.localStorage): SessionTab[] {
  try {
    const raw = storage.getItem(SESSION_TABS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSessionTab).slice(0, MAX_SESSION_TABS);
  } catch {
    return [];
  }
}

export function writeSessionTabs(
  tabs: SessionTab[],
  storage: Pick<Storage, "setItem"> = window.localStorage
): SessionTab[] {
  const normalized = normalizeTabs(tabs);
  storage.setItem(SESSION_TABS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function upsertSessionTab(
  tab: SessionTab,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage
): SessionTab[] {
  const existing = readSessionTabs(storage);
  const currentIndex = existing.findIndex((current) => current.id === tab.id);
  if (currentIndex >= 0) {
    const nextTabs = [...existing];
    nextTabs[currentIndex] = tab;
    return writeSessionTabs(nextTabs, storage);
  }
  return writeSessionTabs([...existing, tab], storage);
}

export function removeSessionTab(
  id: string,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage
): SessionTab[] {
  return writeSessionTabs(readSessionTabs(storage).filter((tab) => tab.id !== id), storage);
}

export function pruneSessionTabs(
  allowedIds: Set<string>,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage
): SessionTab[] {
  return writeSessionTabs(
    readSessionTabs(storage).filter((tab) => allowedIds.has(tab.id)),
    storage
  );
}

function normalizeTabs(tabs: SessionTab[]): SessionTab[] {
  const seen = new Set<string>();
  const normalized: SessionTab[] = [];
  for (const tab of tabs) {
    if (!tab.id || seen.has(tab.id)) continue;
    seen.add(tab.id);
    normalized.push(tab);
  }
  return normalized.slice(-MAX_SESSION_TABS);
}

function isSessionTab(value: unknown): value is SessionTab {
  if (typeof value !== "object" || value === null) return false;
  const tab = value as Partial<SessionTab>;
  return typeof tab.id === "string" && typeof tab.label === "string" && typeof tab.updatedAt === "number";
}
