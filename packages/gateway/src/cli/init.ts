#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  createRenderPlan,
  detectConfigConflicts,
  writeConfigPlan
} from "../config-generation/index.js";
import type { CredentialMode, RenderPlan } from "../config-generation/types.js";
import { TemplateRepository } from "../db/repositories/template-repository.js";
import type { Template, TemplateFile } from "../db/repositories/template-repository.js";
import type { Database } from "../db/types.js";
import { expandUserPath } from "../lib/user-path.js";
import { buildProjectConfigFiles } from "../services/project-config-files.js";
import { adapterForTemplate } from "../services/project-config-render.js";

const defaultTemplateId = "builtin-claude-code";
const cliUserId = "forgebadger-cli";

export interface InitCommand {
  command: "init";
  projectPath: string | null;
  templateId: string;
  credentialMode: CredentialMode;
  listTemplates: boolean;
  dryRun: boolean;
}

export interface CreateInitRenderPlanInput {
  projectPath: string | null;
  templateId: string;
  credentialMode: CredentialMode;
  dryRun: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface CliTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  version: string;
  adapter: string | null;
  isBuiltin: boolean;
  usageCount: number;
}

export function parseForgeBadgerCliArgs(args: string[]): InitCommand {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  if (normalizedArgs[0] !== "init") {
    throw new Error(
      [
        "Usage: forgebadger init --path <project-path> [--template-id <id>] [--dry-run]",
        "       forgebadger init --list-templates"
      ].join("\n")
    );
  }

  const values = parseFlags(normalizedArgs.slice(1));
  const projectPath = values.path ?? values["project-path"] ?? null;
  const listTemplates = values["list-templates"] === "true";
  if (!listTemplates && !projectPath) {
    throw new Error("Missing required --path (or pass --list-templates)");
  }

  const credentialMode = values["credential-mode"] ?? "host_environment";
  if (credentialMode !== "host_environment" && credentialMode !== "stored_encrypted_key") {
    throw new Error("Invalid --credential-mode");
  }

  return {
    command: "init",
    projectPath,
    templateId: values["template-id"] ?? defaultTemplateId,
    credentialMode,
    listTemplates,
    dryRun: values["dry-run"] === "true"
  };
}

export async function createInitRenderPlan(input: CreateInitRenderPlanInput): Promise<RenderPlan> {
  const projectPath = input.projectPath;
  if (!projectPath) {
    throw new Error("Missing required --path");
  }
  const targetRoot = path.resolve(projectPath);
  if (!input.dryRun && !existsSync(targetRoot)) {
    await mkdir(targetRoot, { recursive: true });
  }
  if (existsSync(targetRoot) && !(await stat(targetRoot)).isDirectory()) {
    throw new Error("Project path must be a directory");
  }

  const env = input.env ?? process.env;
  const template = loadTemplate(input.templateId, env);
  return createRenderPlan({
    projectId: "forgebadger-cli-init",
    targetRoot,
    templateId: template.id,
    variables: {
      projectName: path.basename(targetRoot),
      projectRoot: targetRoot,
      gatewayUrl: env.FORGEBADGER_GATEWAY_URL ?? "http://127.0.0.1:48731"
    },
    templateFiles: buildProjectConfigFiles({
      adapter: adapterForTemplate(template),
      templateFiles: template.files.map((file) => ({
        id: String(file.id),
        relativePath: file.filePath,
        content: file.content
      }))
    }),
    credentialMode: input.credentialMode,
    dryRun: input.dryRun
  });
}

export async function runInitCommand(
  command: InitCommand,
  env: NodeJS.ProcessEnv = process.env
): Promise<unknown> {
  const plan = await createInitRenderPlan({ ...command, env });
  if (command.dryRun) {
    return {
      plan: publicRenderPlan(plan),
      conflicts: existsSync(plan.targetRoot) ? await detectConfigConflicts(plan) : []
    };
  }

  const result = await writeConfigPlan(plan);
  return {
    plan: publicRenderPlan(plan),
    result
  };
}

export async function runForgeBadgerCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  try {
    const command = parseForgeBadgerCliArgs(args);
    const data = command.listTemplates
      ? listAvailableTemplates(env)
      : await runInitCommand(command, env);
    process.stdout.write(`${JSON.stringify({ code: 0, data, message: "" }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "ForgeBadger CLI failed"}\n`);
    return 1;
  }
}

export function listAvailableTemplates(env: NodeJS.ProcessEnv = process.env): CliTemplateSummary[] {
  const db = openTemplateDb(env);
  try {
    return new TemplateRepository(db, cliUserId).listAll().map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      version: template.version,
      adapter: template.adapter,
      isBuiltin: template.isBuiltin,
      usageCount: template.usageCount
    }));
  } finally {
    db.close();
  }
}

function parseFlags(args: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    if (key === "dry-run" || key === "list-templates") {
      values[key] = "true";
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    values[key] = value;
    index += 1;
  }
  return values;
}

function loadTemplate(templateId: string, env: NodeJS.ProcessEnv): Template & { files: TemplateFile[] } {
  const db = openTemplateDb(env);
  try {
    const template = new TemplateRepository(db, cliUserId).getById(templateId, {
      bypassVisibility: true
    });
    const files = template?.files;
    if (!template || !files) {
      throw new Error(`Template not found: ${templateId}`);
    }
    return { ...template, files };
  } finally {
    db.close();
  }
}

function openTemplateDb(env: NodeJS.ProcessEnv): Database {
  const dbPath = resolveCliDbPath(env);
  if (!existsSync(dbPath)) {
    return createTemplateDb();
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new BetterSqlite3(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");
  try {
    migrate(drizzle(db), { migrationsFolder: migrationsFolder() });
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return db;
}

// Mirrors the gateway's own env normalization (src/config/env.ts) so the CLI
// resolves the same database file the published CLI's gateway process opens.
function resolveCliDbPath(env: NodeJS.ProcessEnv): string {
  const stateDir = path.resolve(
    expandUserPath(env.FORGEBADGER_STATE_DIR ?? path.join(homedir(), ".forgebadger"))
  );
  return path.resolve(
    expandUserPath(env.FORGEBADGER_DB_PATH ?? path.join(stateDir, "forgebadger.db"))
  );
}

function createTemplateDb(): Database {
  const db = new BetterSqlite3(":memory:");
  migrate(drizzle(db), { migrationsFolder: migrationsFolder() });
  return db;
}

function migrationsFolder(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../db/migrations"
  );
}

function publicRenderPlan(plan: RenderPlan) {
  return {
    projectId: plan.projectId,
    targetRoot: plan.targetRoot,
    templateId: plan.templateId,
    credentialMode: plan.credentialMode,
    dryRun: plan.dryRun,
    files: plan.files.map((file) => ({
      relativePath: file.relativePath,
      sha256: file.sha256
    }))
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runForgeBadgerCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
