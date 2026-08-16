import { randomUUID } from "node:crypto";
import { hashSync, compareSync } from "bcryptjs";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { createClaudeLaunchPlan } from "../adapters/claude.js";
import {
  ConfigWriteError,
  createRenderPlan,
  detectConfigConflicts,
  writeConfigPlan,
  type ConfigWriteAction,
  type CredentialMode,
  type RenderPlan
} from "../config-generation/index.js";
import { signJwt } from "../auth/index.js";
import { validateProjectRoot } from "../lib/safe-resolve.js";
import type { CreateSessionInput, GateASession } from "../services/session-manager.js";
import type { Database } from "../db/types.js";
import {
  ProjectRepository,
  SessionRepository,
  TemplateRepository,
  UserRepository
} from "../db/repositories/index.js";
import type { Mvp0SessionRecord, ProjectRecord, UserRecord } from "../storage/types.js";

/**
 * @deprecated MVP0 API is deprecated. Use the REST routes in src/routes/ instead.
 * This module is kept only for backward compatibility in existing tests.
 */
export interface Mvp0ApiOptions {
  jwtSecret: string;
  db: Database;
  sessionLauncher?: SessionLauncher;
}

export interface SessionLauncher {
  createSession(input: CreateSessionInput): Promise<GateASession>;
}

export interface RegisterInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ProjectInput {
  name: string;
  rootPath: string;
}

export interface ProjectConfigInput {
  projectId: string;
  templateId: string;
  credentialMode: CredentialMode;
  decisions?: Record<string, ConfigWriteAction>;
}

export interface CreateMvp0SessionInput {
  projectId: string;
  credentialMode: CredentialMode;
}

export interface ApiResponse<T> {
  status: number;
  body: {
    code: number;
    data: T;
    message: string;
  };
}

export interface ApiErrorResponse {
  status: number;
  body: {
    code: 1;
    data?: unknown;
    message: string;
  };
}

export function createMvp0Api(options: Mvp0ApiOptions) {
  const db = options.db;

  return {
    async register(input: RegisterInput) {
      const validationError = validateCredentialsInput(input);
      if (validationError) {
        return error(400, validationError);
      }

      try {
        const userRepo = new UserRepository(db);
        const user = userRepo.create(input.email, hashPassword(input.password));
        return success(201, createAuthPayload(toUserRecord(user), options.jwtSecret));
      } catch (err) {
        return error(409, err instanceof Error ? err.message : "failed to register");
      }
    },

    async login(input: LoginInput) {
      const validationError = validateCredentialsInput(input);
      if (validationError) {
        return error(400, validationError);
      }

      const userRepo = new UserRepository(db);
      const user = userRepo.findByEmail(input.email);
      if (!user || !verifyPassword(input.password, user.passwordHash)) {
        return error(401, "Invalid email or password");
      }

      return success(200, createAuthPayload(toUserRecord(user), options.jwtSecret));
    },

    async listProjects(userId: string) {
      const projectRepo = new ProjectRepository(db, userId);
      const projects = projectRepo.list();
      return success(200, { projects: projects.map(toProjectRecord) });
    },

    async createProject(userId: string, input: ProjectInput) {
      return createProjectResponse(userId, input, "create");
    },

    async importProject(userId: string, input: ProjectInput) {
      return createProjectResponse(userId, input, "import");
    },

    async listTemplates() {
      const templateRepo = new TemplateRepository(db, "system");
      const templates = templateRepo.listBuiltIn();
      return success(200, { templates: templates.map(toTemplateRecord) });
    },

    async previewProjectConfig(userId: string, input: ProjectConfigInput) {
      const planResponse = await createProjectRenderPlan(userId, input, true);
      if (isApiErrorResponse(planResponse)) {
        return planResponse;
      }
      const plan = planResponse;
      const conflicts = await detectConfigConflicts(plan);
      return success(200, { plan, conflicts });
    },

    async writeProjectConfig(userId: string, input: ProjectConfigInput) {
      const planResponse = await createProjectRenderPlan(userId, input, false);
      if (isApiErrorResponse(planResponse)) {
        return planResponse;
      }
      try {
        const result = await writeConfigPlan(
          planResponse,
          input.decisions === undefined ? {} : { decisions: input.decisions }
        );
        return success(200, { result });
      } catch (err) {
        if (err instanceof ConfigWriteError) {
          return {
            status: 409,
            body: {
              code: 1,
              data: { conflicts: err.conflicts },
              message: err.message
            }
          };
        }
        return error(400, err instanceof Error ? err.message : "failed to write config");
      }
    },

    async createSession(userId: string, input: CreateMvp0SessionInput) {
      if (!options.sessionLauncher) {
        return error(500, "Session launcher is not configured");
      }
      const projectRepo = new ProjectRepository(db, userId);
      const project = projectRepo.getById(input.projectId);
      if (!project) {
        return error(404, "Project not found");
      }
      const sessionId = randomUUID();
      const launchPlan = createClaudeLaunchPlan({
        projectRoot: project.path,
        credentialMode: input.credentialMode,
        env: { OPENFORGE_SESSION_ID: sessionId }
      });
      const session = await options.sessionLauncher.createSession({
        userId,
        sessionId,
        launchPlan
      });
      const sessionRepo = new SessionRepository(db, userId);
      sessionRepo.upsert({
        id: sessionId,
        userId,
        projectId: project.id,
        name: session.tmuxName,
        aiTool: "claude",
        modelId: null,
        status: session.status,
        attachToken: session.attachToken,
        tmuxSession: session.tmuxName,
        workingDir: project.path,
        credentialMode: input.credentialMode,
        apiKeyId: null,
        lastActive: null,
        errorMessage: null,
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt)
      });
      return success(201, { session });
    },

    async listSessions(userId: string) {
      const sessionRepo = new SessionRepository(db, userId);
      const sessions = sessionRepo.list();
      return success(200, { sessions: sessions.map(toSessionRecord) });
    }
  };

  async function createProjectRenderPlan(
    userId: string,
    input: ProjectConfigInput,
    dryRun: boolean
  ): Promise<RenderPlan | ApiErrorResponse> {
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(input.projectId);
    if (!project) {
      return error(404, "Project not found");
    }

    const templateRepo = new TemplateRepository(db, userId);
    const template = templateRepo.getBuiltInClaude();
    if (input.templateId !== template.id) {
      return error(404, "Template not found");
    }

    const templateWithFiles = templateRepo.getById(template.id);
    const templateFiles = (templateWithFiles?.files ?? []).map((file) => ({
      id: String(file.id),
      relativePath: file.filePath,
      content: file.content
    }));

    return createRenderPlan({
      projectId: project.id,
      targetRoot: project.path,
      templateId: template.id,
      variables: {
        projectName: project.name,
        projectRoot: project.path
      },
      templateFiles,
      credentialMode: input.credentialMode,
      dryRun
    });
  }

  async function createProjectResponse(
    userId: string,
    input: ProjectInput,
    mode: "create" | "import"
  ): Promise<ApiResponse<{ project: ProjectRecord }> | ApiErrorResponse> {
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      return error(400, "Project name is required");
    }
    if (typeof input.rootPath !== "string" || input.rootPath.trim().length === 0) {
      return error(400, "Project root path is required");
    }

    try {
      const rootPath =
        mode === "create"
          ? await prepareCreatedProjectRoot(input.rootPath)
          : await prepareImportedProjectRoot(input.rootPath);
      const projectRepo = new ProjectRepository(db, userId);
      const project =
        mode === "create"
          ? projectRepo.create({ name: input.name.trim(), path: rootPath, aiTool: "claude" })
          : projectRepo.import({ name: input.name.trim(), path: rootPath, aiTool: "claude" });
      return success(201, { project: toProjectRecord(project) });
    } catch (err) {
      return error(400, err instanceof Error ? err.message : "failed to save project");
    }
  }
}

async function prepareCreatedProjectRoot(projectRoot: string): Promise<string> {
  let targetRoot = resolve(projectRoot.trim());
  if (!existsSync(targetRoot)) {
    targetRoot = validateNearestExistingParent(targetRoot);
    await mkdir(targetRoot, { recursive: true });
  }

  const rootPath = validateProjectRoot(targetRoot);
  await assertDirectory(rootPath, "Project root path must be a directory");
  return rootPath;
}

async function prepareImportedProjectRoot(projectRoot: string): Promise<string> {
  const targetRoot = resolve(projectRoot.trim());
  if (!existsSync(targetRoot)) {
    throw new Error("Imported project directory must already exist");
  }

  const rootPath = validateProjectRoot(targetRoot);
  await assertDirectory(rootPath, "Imported project path must be an existing directory");
  return rootPath;
}

function validateNearestExistingParent(targetRoot: string): string {
  let current = dirname(targetRoot);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Project parent directory does not exist");
    }
    current = parent;
  }

  const parentRoot = validateProjectRoot(current);
  const canonicalTargetRoot = resolve(parentRoot, relative(current, targetRoot));
  const parentWithSeparator = parentRoot.endsWith(sep) ? parentRoot : `${parentRoot}${sep}`;
  if (canonicalTargetRoot !== parentRoot && !canonicalTargetRoot.startsWith(parentWithSeparator)) {
    throw new Error("Project root escapes approved parent directory");
  }
  return canonicalTargetRoot;
}

async function assertDirectory(pathname: string, message: string): Promise<void> {
  const stats = await stat(pathname);
  if (!stats.isDirectory()) {
    throw new Error(message);
  }
}

function isApiErrorResponse(value: RenderPlan | ApiErrorResponse): value is ApiErrorResponse {
  return "body" in value && value.body.code === 1;
}

function toSessionRecord(session: import("../db/repositories/session-repository.js").Session): Mvp0SessionRecord {
  return {
    id: session.id,
    userId: session.userId,
    projectId: session.projectId,
    attachToken: "",
    tmuxName: session.tmuxSession ?? "",
    status: session.status as import("../services/session-manager.js").SessionStatus,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString()
  };
}

function createAuthPayload(user: UserRecord, jwtSecret: string) {
  return {
    token: signJwt({ userId: user.id, email: user.email }, jwtSecret),
    user: {
      id: user.id,
      email: user.email
    }
  };
}

function validateCredentialsInput(input: RegisterInput | LoginInput): string | undefined {
  if (typeof input.email !== "string" || !input.email.includes("@")) {
    return "Valid email is required";
  }
  if (typeof input.password !== "string" || input.password.length < 12) {
    return "Password must be at least 12 characters";
  }
  return undefined;
}

function hashPassword(password: string): string {
  return hashSync(password, 10);
}

function verifyPassword(password: string, passwordHash: string): boolean {
  return compareSync(password, passwordHash);
}

function success<T>(status: number, data: T): ApiResponse<T> {
  return {
    status,
    body: {
      code: 0,
      data,
      message: ""
    }
  };
}

function error(status: number, message: string): ApiErrorResponse {
  return {
    status,
    body: {
      code: 1,
      message
    }
  };
}

function toUserRecord(user: import("../db/repositories/user-repository.js").User): UserRecord {
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

function toProjectRecord(project: import("../db/repositories/project-repository.js").Project): ProjectRecord {
  return {
    id: project.id,
    userId: project.userId,
    name: project.name,
    rootPath: project.path,
    source: project.isImported ? "imported" : "created",
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
}

function toTemplateRecord(template: import("../db/repositories/template-repository.js").Template & { files?: import("../db/repositories/template-repository.js").TemplateFile[] }) {
  return {
    id: template.id,
    name: template.name,
    adapter: "claude" as const,
    files: (template.files ?? []).map((file) => ({
      id: String(file.id),
      relativePath: file.filePath,
      content: file.content
    }))
  };
}
