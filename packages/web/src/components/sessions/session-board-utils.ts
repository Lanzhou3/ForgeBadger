import type { Language } from "@/lib/i18n";
import type { Project, Session } from "@/lib/api";
import { normalizeSessionStatus } from "@/lib/session-status";

export const UNLINKED_COLUMN_KEY = "__unlinked__";

const STATUS_RANK: Record<string, number> = {
  running: 0,
  error: 1,
  stopped: 2,
};

export interface SessionBoardColumnData {
  key: string;
  projectId: string | null;
  projectName: string;
  sessions: Session[];
  runningCount: number;
  totalCount: number;
  lastActivity: number;
  unlinked: boolean;
}

export interface SessionTitle {
  title: string;
  /** True when the title is the user's last terminal prompt instead of a name. */
  fromPrompt: boolean;
  /** True when the session has no custom name and no recorded prompt yet. */
  showNoInputHint: boolean;
}

export function parseSessionTimestamp(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function sessionActivityTime(session: Session): number {
  return (
    parseSessionTimestamp(session.lastActive) ??
    parseSessionTimestamp(session.createdAt) ??
    0
  );
}

export function sessionMatchesQuery(session: Session, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }
  return [
    session.name,
    session.runtimeSessionName,
    session.id,
    session.projectName,
    session.projectId,
    session.aiTool,
    session.status,
    normalizeSessionStatus(session.status),
  ].some((value) => value?.toLowerCase().includes(normalizedQuery));
}

export interface BoardFilterOptions {
  query: string;
  statusFilter: string;
  cliTools: ReadonlySet<string>;
}

export function filterBoardSessions(
  sessions: Session[],
  options: BoardFilterOptions
): Session[] {
  const normalizedQuery = options.query.trim().toLowerCase();
  return sessions.filter((session) => {
    if (options.cliTools.size > 0 && (!session.aiTool || !options.cliTools.has(session.aiTool))) {
      return false;
    }
    if (options.statusFilter !== "all" && normalizeSessionStatus(session.status) !== options.statusFilter) {
      return false;
    }
    return sessionMatchesQuery(session, normalizedQuery);
  });
}

export function collectSessionCliTools(sessions: Session[]): string[] {
  const tools = new Set<string>();
  for (const session of sessions) {
    if (session.aiTool) {
      tools.add(session.aiTool);
    }
  }
  return Array.from(tools).sort();
}

/** Column order: running > error > stopped, then most recent activity first. */
export function sortSessionsForColumn(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    const rankDelta =
      (STATUS_RANK[normalizeSessionStatus(a.status)] ?? 3) -
      (STATUS_RANK[normalizeSessionStatus(b.status)] ?? 3);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return sessionActivityTime(b) - sessionActivityTime(a);
  });
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "zh-Hans-CN-u-co-pinyin");
}

/**
 * Groups filtered sessions into project columns. Columns with sessions sort by
 * their most recent activity descending; empty project columns are omitted
 * unless `showEmptyProjects` is set (then they trail active columns, by name).
 * The unlinked column always comes last.
 */
export function groupSessionsIntoColumns(
  sessions: Session[],
  projects: Project[],
  options: { showEmptyProjects: boolean }
): SessionBoardColumnData[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const buckets = new Map<string, Session[]>();
  const unlinked: Session[] = [];

  for (const session of sessions) {
    if (!session.projectId) {
      unlinked.push(session);
      continue;
    }
    const bucket = buckets.get(session.projectId);
    if (bucket) {
      bucket.push(session);
    } else {
      buckets.set(session.projectId, [session]);
    }
  }

  const linkedColumns: SessionBoardColumnData[] = [];
  const emptyColumns: SessionBoardColumnData[] = [];

  for (const [projectId, projectSessions] of buckets) {
    linkedColumns.push(buildColumn(projectId, projectById.get(projectId), projectSessions));
  }
  for (const project of projects) {
    if (buckets.has(project.id)) {
      continue;
    }
    const column = buildColumn(project.id, project, []);
    if (options.showEmptyProjects) {
      emptyColumns.push(column);
    }
  }
  emptyColumns.sort((a, b) => compareNames(a.projectName, b.projectName));
  linkedColumns.sort((a, b) => b.lastActivity - a.lastActivity);

  const columns = [...linkedColumns, ...emptyColumns];
  if (unlinked.length > 0) {
    columns.push(buildColumn(null, undefined, unlinked));
  }
  return columns;
}

function buildColumn(
  projectId: string | null,
  project: Project | undefined,
  sessions: Session[]
): SessionBoardColumnData {
  const sorted = sortSessionsForColumn(sessions);
  const projectName =
    project?.name ??
    sessions.find((session) => session.projectName)?.projectName ??
    projectId ??
    "";
  let lastActivity = 0;
  let runningCount = 0;
  for (const session of sorted) {
    lastActivity = Math.max(lastActivity, sessionActivityTime(session));
    if (normalizeSessionStatus(session.status) === "running") {
      runningCount += 1;
    }
  }
  return {
    key: projectId ?? UNLINKED_COLUMN_KEY,
    projectId,
    projectName,
    sessions: sorted,
    runningCount,
    totalCount: sorted.length,
    lastActivity,
    unlinked: projectId === null,
  };
}

export function formatColumnStats(template: string, running: number, total: number): string {
  return template.replace("{running}", String(running)).replace("{total}", String(total));
}

export function pickSessionTitle(session: Session, lastPrompt?: string): SessionTitle {
  const prompt = lastPrompt?.trim();
  if (prompt) {
    return { title: prompt, fromPrompt: true, showNoInputHint: false };
  }
  const title = session.name || session.runtimeSessionName || session.id;
  const hasCustomName = Boolean(session.name && session.name !== session.projectName);
  return { title, fromPrompt: false, showNoInputHint: !hasCustomName };
}

/** Recent-enough creations get a one-time highlight ring on the board card. */
export function isRecentlyCreated(session: Session, now: number, windowMs: number): boolean {
  const createdAt = parseSessionTimestamp(session.createdAt);
  if (createdAt === null) {
    return false;
  }
  const age = now - createdAt;
  return age >= 0 && age <= windowMs;
}

export function formatSessionRelativeTime(
  session: Session,
  now: number,
  language: Language
): string | null {
  const timestamp =
    parseSessionTimestamp(session.lastActive) ?? parseSessionTimestamp(session.createdAt);
  if (timestamp === null) {
    return null;
  }
  const diffSeconds = Math.round((timestamp - now) / 1000);
  const abs = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (abs < 60) {
    return formatter.format(diffSeconds, "second");
  }
  if (abs < 3600) {
    return formatter.format(Math.round(diffSeconds / 60), "minute");
  }
  if (abs < 86400) {
    return formatter.format(Math.round(diffSeconds / 3600), "hour");
  }
  if (abs < 2592000) {
    return formatter.format(Math.round(diffSeconds / 86400), "day");
  }
  if (abs < 31536000) {
    return formatter.format(Math.round(diffSeconds / 2592000), "month");
  }
  return formatter.format(Math.round(diffSeconds / 31536000), "year");
}

/**
 * Resolves the prompt shown as the card title: the freshest local capture wins
 * (this browser saw it most recently); otherwise fall back to the Gateway's
 * stored value so other devices' input is still visible.
 */
export function resolveSessionPrompt(
  session: Session,
  localPrompts: Readonly<Record<string, string>>
): string | undefined {
  const local = localPrompts[session.id]?.trim();
  if (local) {
    return local;
  }
  const remote = session.lastPrompt?.trim();
  return remote ? remote : undefined;
}

