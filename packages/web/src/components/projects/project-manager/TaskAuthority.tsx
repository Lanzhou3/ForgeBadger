"use client";
import { createContext, useContext } from "react";
import type { WorkspaceDetail } from "@/lib/collaboration-api";
export interface TaskAuthority {
  canEdit: boolean;
  canManage?: boolean;
  legacySessions: boolean;
  collaboration?: WorkspaceDetail;
  actorId?: string;
}
export const TaskAuthorityContext = createContext<TaskAuthority>({
  canEdit: false,
  canManage: false,
  legacySessions: false,
});
export function useTaskAuthority() {
  return useContext(TaskAuthorityContext);
}
