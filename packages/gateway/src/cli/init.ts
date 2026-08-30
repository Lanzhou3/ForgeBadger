#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
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
import type { CredentialMode, RenderPlan, TemplateFileInput } from "../config-generation/types.js";
import { TemplateRepository } from "../db/repositories/template-repository.js";
import type { Database } from "../db/types.js";
import { buildProjectConfigFiles } from "../services/project-config-files.js";

const defaultTemplateId = "builtin-claude-code";

export interface InitCommand {
  command: "init";
  projectPath: string;
  templateId: string;
  credentialMode: CredentialMode;
  dryRun: boolean;
}

export interface CreateInitRenderPlanInput {
  projectPath: string;
  templateId: string;
  credentialMode: CredentialMode;
  dryRun: boolean;
  env?: NodeJS.ProcessEnv;
}

export function parseForgeBadgerCliArgs(args: string[]): InitCommand {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  if (normalizedArgs[0] !== "init") {
    throw new Error("Usage: forgebadger init --path <project-path> [--template-id <id>] [--dry-run]");
  }

  const values = parseFlags(normalizedArgs.slice(1));
  const projectPath = values.path ?? values["project-path"];
  if (!projectPath) {
    throw new Error("Missing required --path");
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
    dryRun: values["dry-run"] === "true"
  };
}

export async function createInitRenderPlan(input: CreateInitRenderPlanInput): Promise<RenderPlan> {
  const targetRoot = path.resolve(input.projectPath);
  if (!input.dryRun && !existsSync(targetRoot)) {
    await mkdir(targetRoot, { recursive: true });
  }
  if (existsSync(targetRoot) && !(await stat(targetRoot)).isDirectory()) {
    throw new Error("Project path must be a directory");
  }

  const templateFiles = loadTemplateFiles(input.templateId);
  const env = input.env ?? process.env;
  return createRenderPlan({
    projectId: "forgebadger-cli-init",
    targetRoot,
    templateId: input.templateId,
    variables: {
      projectName: path.basename(targetRoot),
      projectRoot: targetRoot,
      gatewayUrl: env.FORGEBADGER_GATEWAY_URL ?? env.OPENFORGE_GATEWAY_URL ?? "http://127.0.0.1:48731"
    },
    templateFiles: buildProjectConfigFiles({
      adapter: "claude",
      templateFiles
    }),
    credentialMode: input.credentialMode,
    dryRun: input.dryRun
  });
}

export async function runInitCommand(command: InitCommand): Promise<unknown> {
  const plan = await createInitRenderPlan(command);
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

export async function runForgeBadgerCli(args: string[]): Promise<number> {
  try {
    const command = parseForgeBadgerCliArgs(args);
    const data = await runInitCommand(command);
    process.stdout.write(`${JSON.stringify({ code: 0, data, message: "" }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "ForgeBadger CLI failed"}\n`);
    return 1;
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
    if (key === "dry-run") {
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

function loadTemplateFiles(templateId: string): TemplateFileInput[] {
  const db = createTemplateDb();
  try {
    const template = new TemplateRepository(db, "forgebadger-cli").getById(templateId);
    if (!template?.files) {
      throw new Error(`Template not found: ${templateId}`);
    }
    return template.files.map((file) => ({
      id: String(file.id),
      relativePath: file.filePath,
      content: file.content
    }));
  } finally {
    db.close();
  }
}

function createTemplateDb(): Database {
  const db = new BetterSqlite3(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
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
