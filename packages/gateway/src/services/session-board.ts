/**
 * Session board aggregation — one query surface for the session board UI:
 * the user's projects, their sessions, and a per-session summary of the
 * Project Manager work items linked to each session.
 */
import { ProjectManagerRepository, type ProjectManagerWorkItem } from "../db/repositories/project-manager-repository.js";
import { ProjectRepository, type Project } from "../db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../db/repositories/session-repository.js";
import type { Database } from "../db/types.js";
import { readTaskPacketDetails } from "./project-manager/task-packets.js";

export const SESSION_BOARD_TASKS_PER_SESSION = 10;

export interface SessionBoardTaskSummary {
  id: string;
  title: string;
  status: string;
  priority: number;
  projectId: string;
  updatedAt: number;
}

export interface SessionBoard {
  projects: Project[];
  sessions: Session[];
  sessionTasks: Record<string, SessionBoardTaskSummary[]>;
}

export function buildSessionBoard(db: Database, userId: string): SessionBoard {
  const projects = new ProjectRepository(db, userId).list();
  const sessions = new SessionRepository(db, userId).list();
  return {
    projects,
    sessions,
    sessionTasks: collectSessionTasks(db, userId, new Set(sessions.map((session) => session.id)))
  };
}

function collectSessionTasks(
  db: Database,
  userId: string,
  sessionIds: Set<string>
): Record<string, SessionBoardTaskSummary[]> {
  if (sessionIds.size === 0) return {};
  const workItems = new ProjectManagerRepository(db, userId).listWorkItemsWithSessionLink();
  const grouped: Record<string, SessionBoardTaskSummary[]> = {};
  for (const workItem of workItems) {
    const summary = toTaskSummary(workItem, sessionIds);
    if (!summary) continue;
    const list = grouped[summary.sessionId] ?? [];
    list.push(summary.task);
    grouped[summary.sessionId] = list;
  }
  for (const sessionId of Object.keys(grouped)) {
    const tasks = grouped[sessionId];
    if (!tasks) continue;
    grouped[sessionId] = tasks
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SESSION_BOARD_TASKS_PER_SESSION);
  }
  return grouped;
}

function toTaskSummary(
  workItem: ProjectManagerWorkItem,
  sessionIds: Set<string>
): { sessionId: string; task: SessionBoardTaskSummary } | null {
  const sessionId = readSessionLinkSessionId(workItem);
  if (!sessionId || !sessionIds.has(sessionId)) return null;
  return {
    sessionId,
    task: {
      id: workItem.id,
      title: workItem.title,
      status: workItem.status,
      priority: workItem.priority,
      projectId: workItem.projectId,
      updatedAt: workItem.updatedAt
    }
  };
}

function readSessionLinkSessionId(workItem: ProjectManagerWorkItem): string | null {
  const value = readTaskPacketDetails(workItem.details).sessionId;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
