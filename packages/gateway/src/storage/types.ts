import type { SessionStatus } from "../services/session-manager.js";
import type { TemplateFileInput } from "../config-generation/types.js";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  userId: string;
  name: string;
  rootPath: string;
  source: "created" | "imported";
  createdAt: string;
  updatedAt: string;
}

export interface TemplateRecord {
  id: string;
  name: string;
  adapter: "claude";
  files: TemplateFileInput[];
}

export interface Mvp0SessionRecord {
  id: string;
  userId: string;
  projectId: string;
  attachToken: string;
  tmuxName: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Mvp0State {
  users: UserRecord[];
  projects: ProjectRecord[];
  sessions: Mvp0SessionRecord[];
}
