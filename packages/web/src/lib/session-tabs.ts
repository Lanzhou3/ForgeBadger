import type { Session } from "@/lib/api";
import type { BrandStorage } from "@/lib/brand-storage";

export interface SessionTab {
  id: string;
  label: string;
  projectId?: string;
  projectName?: string;
  aiTool?: string;
  status?: string;
  /** Most recent prompt line captured from terminal input, shown in the tab. */
  lastPrompt?: string;
  updatedAt: number;
}

const SESSION_TABS_KEY = "forgebadger.sessionTabs.v1";
/** Most recent stopped/idle tabs kept. Running tabs are never capped — the
 *  strip exists to show what's active, so a live session is not trimmed. */
const MAX_INACTIVE_TABS = 8;
/** Most session tabs rendered inline before the rest fold into the overflow
 *  menu. A display safeguard so a pathological number of running tabs (which
 *  are never trimmed) can't stretch the strip into an endless scroll. */
export const MAX_VISIBLE_TABS = 12;

export function sessionToTab(session: Session, now = Date.now()): SessionTab {
  return {
    id: session.id,
    label: session.name || session.runtimeSessionName || session.id,
    ...(session.projectId ? { projectId: session.projectId } : {}),
    ...(session.projectName ? { projectName: session.projectName } : {}),
    ...(session.aiTool ? { aiTool: session.aiTool } : {}),
    ...(session.status ? { status: session.status } : {}),
    updatedAt: now
  };
}

export function readSessionTabs(storage: BrandStorage = window.localStorage): SessionTab[] {
  try {
    const raw = storage.getItem(SESSION_TABS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return capSessionTabs(parsed.filter(isSessionTab)).map((tab) => {
      const lastPrompt = sanitizeStoredPrompt(tab.lastPrompt);
      if (lastPrompt === tab.lastPrompt) return tab;
      const { lastPrompt: _dropped, ...rest } = tab;
      return lastPrompt ? { ...rest, lastPrompt } : rest;
    });
  } catch {
    return [];
  }
}

export function writeSessionTabs(
  tabs: SessionTab[],
  storage: BrandStorage = window.localStorage
): SessionTab[] {
  const normalized = normalizeTabs(tabs);
  storage.setItem(SESSION_TABS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function upsertSessionTab(
  tab: SessionTab,
  storage: BrandStorage = window.localStorage
): SessionTab[] {
  const existing = readSessionTabs(storage);
  const currentIndex = existing.findIndex((current) => current.id === tab.id);
  if (currentIndex >= 0) {
    const previous = existing[currentIndex];
    const preservedPrompt =
      tab.lastPrompt === undefined ? previous?.lastPrompt : tab.lastPrompt;
    const preservedProjectId =
      tab.projectId === undefined ? previous?.projectId : tab.projectId;
    const preservedProject =
      tab.projectName === undefined ? previous?.projectName : tab.projectName;
    const nextTabs = [...existing];
    nextTabs[currentIndex] = {
      ...tab,
      ...(preservedPrompt !== undefined ? { lastPrompt: preservedPrompt } : {}),
      ...(preservedProjectId !== undefined ? { projectId: preservedProjectId } : {}),
      ...(preservedProject !== undefined ? { projectName: preservedProject } : {}),
    };
    return writeSessionTabs(nextTabs, storage);
  }
  return writeSessionTabs([...existing, tab], storage);
}

/**
 * A captured prompt must look like human input. Terminal query responses
 * (e.g. OSC `10;rgb:…` color reports) are control traffic, not prompts.
 */
function sanitizeStoredPrompt(prompt: unknown): string | undefined {
  if (typeof prompt !== "string") return undefined;
  const cleaned = prompt.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 2) return undefined;
  if (/^\d+;/.test(cleaned)) return undefined;
  return cleaned;
}

export function setSessionTabPrompt(
  id: string,
  prompt: string,
  storage: BrandStorage = window.localStorage
): SessionTab[] {
  const tabs = readSessionTabs(storage);
  const index = tabs.findIndex((tab) => tab.id === id);
  const tab = index < 0 ? undefined : tabs[index];
  if (!tab) return tabs;
  const nextTabs = [...tabs];
  nextTabs[index] = { ...tab, lastPrompt: prompt, updatedAt: Date.now() };
  return writeSessionTabs(nextTabs, storage);
}

const TAB_GROUP_COLORS: readonly string[] = [
  "#38bdf8",
  "#4ade80",
  "#c084fc",
  "#f472b6",
  "#fb923c",
  "#facc15",
  "#2dd4bf",
  "#818cf8",
];

/** Stable Edge-style color for a project tab group, hashed from the name. */
export function sessionTabGroupColor(projectName: string): string {
  let hash = 0;
  for (let index = 0; index < projectName.length; index += 1) {
    hash = (hash * 31 + projectName.charCodeAt(index)) | 0;
  }
  return TAB_GROUP_COLORS[Math.abs(hash) % TAB_GROUP_COLORS.length] ?? "#38bdf8";
}

export function notifySessionTabsChanged() {
  window.dispatchEvent(new Event("forgebadger-session-tabs-changed"));
}

export function removeSessionTab(
  id: string,
  storage: BrandStorage = window.localStorage
): SessionTab[] {
  return writeSessionTabs(readSessionTabs(storage).filter((tab) => tab.id !== id), storage);
}

export interface SessionTabGroup {
  projectName?: string;
  tabs: SessionTab[];
}

/**
 * Groups tabs by project while preserving the order in which projects first
 * appear and the tab order within each project. Tabs without a project name
 * share one anonymous group.
 */
export function groupSessionTabs(tabs: SessionTab[]): SessionTabGroup[] {
  const groups: SessionTabGroup[] = [];
  const indexByProject = new Map<string, number>();
  for (const tab of tabs) {
    const key = tab.projectName ?? "";
    const groupIndex = indexByProject.get(key);
    const group = groupIndex === undefined ? undefined : groups[groupIndex];
    if (group) {
      group.tabs.push(tab);
      continue;
    }
    indexByProject.set(key, groups.length);
    groups.push({
      ...(tab.projectName ? { projectName: tab.projectName } : {}),
      tabs: [tab],
    });
  }
  return groups;
}

/**
 * Splits tabs into the set shown inline in the strip and the set folded into
 * the overflow menu. Tabs are considered in display (grouped) order: at most
 * `maxVisible` are shown inline. The active tab is the exception — if it would
 * otherwise fall past the limit it is still shown inline (so it costs no
 * budget only in that off-screen case); within the limit it occupies a slot
 * like any other tab. Hidden tabs keep display order.
 */
export function splitSessionTabsByVisibility(
  tabs: SessionTab[],
  activeId: string,
  maxVisible = MAX_VISIBLE_TABS
): { visibleIds: ReadonlySet<string>; hiddenTabs: SessionTab[] } {
  const ordered = groupSessionTabs(tabs).flatMap((group) => group.tabs);
  let budget = maxVisible;
  const visibleIds = new Set<string>();
  const hiddenTabs: SessionTab[] = [];
  for (const tab of ordered) {
    const inBudget = budget > 0;
    if (tab.id === activeId) {
      // Always inline; consumes a slot only if there is one left (i.e. it is
      // within the limit). Otherwise it is the off-screen active exception.
      visibleIds.add(tab.id);
      if (inBudget) budget -= 1;
      continue;
    }
    if (inBudget) {
      visibleIds.add(tab.id);
      budget -= 1;
    } else {
      hiddenTabs.push(tab);
    }
  }
  return { visibleIds, hiddenTabs };
}

/**
 * The most recently touched live session — the floating bookmark's jump-back
 * target. Only "running" tabs qualify: an idle or exited session is not
 * something the user can return to.
 */
export function getLatestRunningTab(tabs: SessionTab[]): SessionTab | undefined {
  let latest: SessionTab | undefined;
  for (const tab of tabs) {
    if (tab.status !== "running") continue;
    if (!latest || tab.updatedAt > latest.updatedAt) latest = tab;
  }
  return latest;
}

export function pruneSessionTabs(
  allowedIds: Set<string>,
  storage: BrandStorage = window.localStorage
): SessionTab[] {
  return writeSessionTabs(
    readSessionTabs(storage).filter((tab) => allowedIds.has(tab.id)),
    storage
  );
}

function normalizeTabs(tabs: SessionTab[]): SessionTab[] {
  const seen = new Set<string>();
  const deduped: SessionTab[] = [];
  for (const tab of tabs) {
    if (!tab.id || seen.has(tab.id)) continue;
    seen.add(tab.id);
    deduped.push(tab);
  }
  return capSessionTabs(deduped);
}

/**
 * Bounds the tab list without dropping a live session. Running tabs are kept
 * unconditionally (this mirrors the strip's own `status === "running"` check);
 * stopped/idle tabs are trimmed to the most recently used `MAX_INACTIVE_TABS`.
 * The result preserves the input's relative order.
 */
function capSessionTabs(tabs: SessionTab[]): SessionTab[] {
  const running = tabs.filter((tab) => tab.status === "running");
  const inactive = tabs
    .filter((tab) => tab.status !== "running")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_INACTIVE_TABS);
  const keep = new Set([...running, ...inactive].map((tab) => tab.id));
  return tabs.filter((tab) => keep.has(tab.id));
}

function isSessionTab(value: unknown): value is SessionTab {
  if (typeof value !== "object" || value === null) return false;
  const tab = value as Partial<SessionTab>;
  return typeof tab.id === "string" && typeof tab.label === "string" && typeof tab.updatedAt === "number";
}
