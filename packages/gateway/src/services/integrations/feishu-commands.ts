import { z } from "zod";

import {
  runCommand,
  type CommandResult,
  type CommandRunnerOptions
} from "../../lib/dependency-check.js";
import { redactCopilotPayload, redactCopilotText } from "../copilot/redaction.js";

export type FeishuCommandOperation =
  | "message_send"
  | "doc_create"
  | "doc_update"
  | "task_create"
  | "task_update";

export interface FeishuCommandRequest {
  operation: FeishuCommandOperation;
  input: unknown;
}

export type FeishuCommandResult =
  | {
      operation: FeishuCommandOperation;
      ok: true;
      output: Record<string, unknown>;
    }
  | {
      operation: FeishuCommandOperation;
      ok: false;
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };

export type FeishuCommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunnerOptions
) => Promise<CommandResult>;

export interface ExecuteFeishuCommandOptions {
  executable?: string;
  runner?: FeishuCommandRunner;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

interface FeishuCommandDefinition {
  operation: FeishuCommandOperation;
  timeoutMs: number;
  inputSchema: z.ZodType<unknown>;
  buildArgs(input: unknown): string[];
}

const defaultExecutable = "lark-cli";
const defaultTimeoutMs = 10_000;
const idInput = z.string().min(1).max(128);
const textInput = z.string().min(1).max(16_000);
const messageSendInput = z.object({
  chatId: idInput,
  text: textInput,
  reason: z.string().min(1).max(1024).optional()
}).strict();
const docCreateInput = z.object({
  title: z.string().min(1).max(256),
  content: textInput,
  folderId: idInput.optional(),
  reason: z.string().min(1).max(1024).optional()
}).strict();
const docUpdateInput = z.object({
  documentId: idInput,
  content: textInput,
  reason: z.string().min(1).max(1024).optional()
}).strict();
const taskCreateInput = z.object({
  summary: z.string().min(1).max(256),
  description: z.string().max(4_000).optional(),
  assigneeFeishuUserId: idInput.optional(),
  dueDate: z.string().min(1).max(32).optional(),
  chatId: idInput.optional(),
  reason: z.string().min(1).max(1024).optional()
}).strict();
const taskUpdateInput = z.object({
  taskId: idInput,
  summary: z.string().min(1).max(256).optional(),
  description: z.string().max(4_000).optional(),
  status: z.enum(["todo", "in_progress", "done", "cancelled"]).optional(),
  reason: z.string().min(1).max(1024).optional()
}).strict();

const feishuCommandRegistry = {
  message_send: {
    operation: "message_send",
    timeoutMs: defaultTimeoutMs,
    inputSchema: messageSendInput,
    buildArgs: (input) => {
      const parsed = messageSendInput.parse(input);
      return [
        "message",
        "send",
        "--chat-id",
        parsed.chatId,
        "--text",
        parsed.text,
        "--output",
        "json"
      ];
    }
  },
  doc_create: {
    operation: "doc_create",
    timeoutMs: defaultTimeoutMs,
    inputSchema: docCreateInput,
    buildArgs: (input) => {
      const parsed = docCreateInput.parse(input);
      return [
        "doc",
        "create",
        "--title",
        parsed.title,
        "--content",
        parsed.content,
        ...(parsed.folderId ? ["--folder-id", parsed.folderId] : []),
        "--output",
        "json"
      ];
    }
  },
  doc_update: {
    operation: "doc_update",
    timeoutMs: defaultTimeoutMs,
    inputSchema: docUpdateInput,
    buildArgs: (input) => {
      const parsed = docUpdateInput.parse(input);
      return [
        "doc",
        "update",
        "--document-id",
        parsed.documentId,
        "--content",
        parsed.content,
        "--output",
        "json"
      ];
    }
  },
  task_create: {
    operation: "task_create",
    timeoutMs: defaultTimeoutMs,
    inputSchema: taskCreateInput,
    buildArgs: (input) => {
      const parsed = taskCreateInput.parse(input);
      return [
        "task",
        "create",
        "--summary",
        parsed.summary,
        ...(parsed.description ? ["--description", parsed.description] : []),
        ...(parsed.assigneeFeishuUserId ? ["--assignee-id", parsed.assigneeFeishuUserId] : []),
        ...(parsed.dueDate ? ["--due-date", parsed.dueDate] : []),
        ...(parsed.chatId ? ["--chat-id", parsed.chatId] : []),
        "--output",
        "json"
      ];
    }
  },
  task_update: {
    operation: "task_update",
    timeoutMs: defaultTimeoutMs,
    inputSchema: taskUpdateInput,
    buildArgs: (input) => {
      const parsed = taskUpdateInput.parse(input);
      return [
        "task",
        "update",
        "--task-id",
        parsed.taskId,
        ...(parsed.summary ? ["--summary", parsed.summary] : []),
        ...(parsed.description ? ["--description", parsed.description] : []),
        ...(parsed.status ? ["--status", parsed.status] : []),
        "--output",
        "json"
      ];
    }
  }
} satisfies Record<FeishuCommandOperation, FeishuCommandDefinition>;

export async function executeFeishuCommand(
  request: FeishuCommandRequest,
  options: ExecuteFeishuCommandOptions = {}
): Promise<FeishuCommandResult> {
  const definition = getCommandDefinition(request.operation);
  if (!definition) {
    return commandError(request.operation, "feishu_command_unsupported", "Feishu command operation is not allowlisted");
  }

  const parsed = definition.inputSchema.safeParse(request.input);
  if (!parsed.success) {
    return commandError(definition.operation, "feishu_command_invalid", "Feishu command input is invalid");
  }

  const runner = options.runner ?? runCommand;
  const result = await runner(resolveExecutable(options), definition.buildArgs(parsed.data), {
    timeoutMs: options.timeoutMs ?? definition.timeoutMs,
    maxOutputBytes: 64 * 1024
  });

  if (result.exitCode !== 0) {
    return commandError(definition.operation, "feishu_command_failed", "Feishu command failed", {
      exitCode: result.exitCode,
      stderr: redactCopilotText(result.stderr).slice(0, 2_000)
    });
  }

  return {
    operation: definition.operation,
    ok: true,
    output: parseCommandOutput(result.stdout)
  };
}

function getCommandDefinition(operation: unknown): FeishuCommandDefinition | undefined {
  return typeof operation === "string"
    ? feishuCommandRegistry[operation as FeishuCommandOperation]
    : undefined;
}

function resolveExecutable(options: ExecuteFeishuCommandOptions): string {
  const configured = options.executable ?? options.env?.OPENFORGE_FEISHU_CLI_PATH;
  return typeof configured === "string" && configured.trim().length > 0
    ? configured.trim()
    : defaultExecutable;
}

function parseCommandOutput(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {};
  }

  for (const line of trimmed.split(/\r?\n/u)) {
    const candidate = line.trim();
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed)) {
        return redactRecord(parsed);
      }
    } catch {
      break;
    }
  }

  return {
    stdout: redactCopilotText(trimmed).slice(0, 8_000)
  };
}

function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactCopilotPayload(value);
  return isRecord(redacted) ? redacted : {};
}

function commandError(
  operation: unknown,
  code: string,
  message: string,
  details?: Record<string, unknown>
): FeishuCommandResult {
  return {
    operation: isFeishuCommandOperation(operation) ? operation : "message_send",
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details: redactRecord(details) } : {})
    }
  };
}

function isFeishuCommandOperation(value: unknown): value is FeishuCommandOperation {
  return typeof value === "string" && value in feishuCommandRegistry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
