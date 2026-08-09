import { AuditLogRepository } from "../../db/repositories/audit-log-repository.js";
import { FeishuIntegrationRepository } from "../../db/repositories/feishu-integration-repository.js";
import { ProjectManagerRepository, type ProjectManagerWorkItem } from "../../db/repositories/project-manager-repository.js";
import { ProjectRepository, type Project } from "../../db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../../db/repositories/session-repository.js";
import type { Database } from "../../db/types.js";
import { redactCopilotText } from "../copilot/redaction.js";

export interface FeishuBotCommand {
  chatId: string;
  feishuUserId: string;
  text: string;
  messageId?: string | undefined;
  eventId?: string | undefined;
}

export interface FeishuBotReplyPlan {
  receiveId: string;
  receiveIdType: "chat_id";
  msgType: "text";
  text: string;
}

export type FeishuBotCommandRoute = "status" | "sessions" | "task" | "help";

export type FeishuBotCommandResult =
  | {
      ok: true;
      route: FeishuBotCommandRoute;
      reply: FeishuBotReplyPlan;
    }
  | {
      ok: false;
      reasonCode: string;
      reply?: FeishuBotReplyPlan;
    };

export interface RouteFeishuBotCommandInput {
  db: Database;
  userId: string;
  command: FeishuBotCommand;
  ipAddress?: string | undefined;
}

export type FeishuBotConnectionState = "connected" | "reconnecting" | "reconnected" | "disconnected";

export interface RecordFeishuBotConnectionEventInput {
  state: FeishuBotConnectionState;
  connectionId?: string | undefined;
  attempt?: number | undefined;
  eventSubscription?: string | undefined;
  reason?: string | undefined;
  ipAddress?: string | undefined;
}

const supportedEventType = "im.message.receive_v1";
const defaultEventSubscription = supportedEventType;
const botLongConnectionReplayScope = "bot-long-connection";
const botLongConnectionReplayTtlMs = 5 * 60 * 1000;
const terminalCommandPattern =
  /(?:^|\s)(?:[$#>]\s+\S+|tmux\b|(?:bash|zsh|sh|cmd|powershell)\b|(?:terminal|input|exec|shell|pty|stdin)\b)/iu;
const appSecretPattern = /\bapp[_-]?secret(\s*[:=]\s*)([^\s,;]+)/giu;

export function normalizeFeishuBotLongConnectionEvent(event: unknown): FeishuBotCommand | undefined {
  if (!isRecord(event)) return undefined;
  const header = event.header;
  const eventType = isRecord(header) && typeof header.event_type === "string"
    ? header.event_type
    : undefined;
  if (eventType !== supportedEventType) return undefined;

  const eventBody = event.event;
  if (!isRecord(eventBody)) return undefined;
  const message = eventBody.message;
  if (!isRecord(message)) return undefined;
  if (typeof message.message_type === "string" && message.message_type !== "text") return undefined;

  const sender = eventBody.sender;
  const senderId = isRecord(sender) ? sender.sender_id : undefined;
  const feishuUserId = firstString(
    isRecord(senderId) ? senderId.open_id : undefined,
    isRecord(senderId) ? senderId.user_id : undefined,
    isRecord(senderId) ? senderId.union_id : undefined
  );
  const chatId = firstString(message.chat_id);
  const text = parseFeishuTextContent(message.content);
  if (!chatId || !feishuUserId || !text) return undefined;

  const messageId = firstString(message.message_id);
  const eventId = isRecord(header) ? firstString(header.event_id) : undefined;
  return {
    chatId,
    feishuUserId,
    text,
    ...(messageId ? { messageId } : {}),
    ...(eventId ? { eventId } : {})
  };
}

export function routeFeishuBotCommand(input: RouteFeishuBotCommandInput): FeishuBotCommandResult {
  const repo = new FeishuIntegrationRepository(input.db, input.userId);
  const config = repo.getConfig();
  const reject = (reasonCode: string, replyText?: string): FeishuBotCommandResult => {
    recordBotReject(input.db, input.userId, input.ipAddress, input.command, reasonCode);
    return {
      ok: false,
      reasonCode,
      ...(replyText ? { reply: replyPlan(input.command.chatId, replyText) } : {})
    };
  };

  if (!config.enabled) return reject("feishu_integration_disabled");
  if (config.emergencyDisabled) return reject("feishu_integration_emergency_disabled");
  if (config.identityMode !== "user" && config.identityMode !== "bot") {
    return reject("feishu_identity_mode_required");
  }
  if (config.allowedChatIds.length === 0) return reject("feishu_chat_allowlist_required");
  if (!config.allowedChatIds.includes(input.command.chatId)) return reject("feishu_chat_not_allowed");
  if (findMappedOpenForgeUserId(repo, input.command.feishuUserId) !== input.userId) {
    return reject("feishu_user_not_mapped");
  }
  const replayKey = input.command.messageId ?? input.command.eventId;
  if (replayKey && !repo.consumePublicWebhookReplayKey({
    userId: input.userId,
    publicWebhookId: botLongConnectionReplayScope,
    replayKey,
    ttlMs: botLongConnectionReplayTtlMs
  })) return reject("feishu_bot_event_replayed");

  const parsed = parseOpenForgeCommand(input.command.text, config.commandPrefix);
  if (!parsed.ok) return reject(parsed.reasonCode, parsed.replyText);
  if (isTerminalControlCommand(parsed.command, parsed.args)) {
    return reject(
      "feishu_terminal_input_rejected",
      "OpenForge rejected terminal input from Feishu. Use bounded commands such as /openforge status, /openforge sessions, or /openforge task <id>."
    );
  }

  const routed = routeBoundedCommand(input.db, input.userId, input.command.chatId, parsed.command, parsed.args);
  if (!routed) {
    return reject(
      "feishu_command_unsupported",
      "Supported OpenForge commands: /openforge status, /openforge sessions, /openforge task <id>."
    );
  }

  recordBotAccept(input.db, input.userId, input.ipAddress, input.command, routed.route);
  return routed;
}

export function recordFeishuBotConnectionEvent(
  db: Database,
  userId: string,
  input: RecordFeishuBotConnectionEventInput
): void {
  new AuditLogRepository(db, userId).create({
    action: "feishu.bot_ws.connection",
    resourceType: "feishu_bot_websocket",
    resourceId: input.connectionId ?? null,
    details: {
      state: input.state,
      connectionId: input.connectionId ?? null,
      attempt: input.attempt ?? null,
      eventSubscription: input.eventSubscription ?? defaultEventSubscription,
      publicCallbackRequired: false,
      ...(input.reason ? { reason: redactFeishuText(input.reason) } : {})
    },
    ipAddress: input.ipAddress
  });
}

function routeBoundedCommand(
  db: Database,
  userId: string,
  chatId: string,
  command: string,
  args: string[]
): Extract<FeishuBotCommandResult, { ok: true }> | undefined {
  if (command === "help") {
    return {
      ok: true,
      route: "help",
      reply: replyPlan(chatId, "Supported OpenForge commands: /openforge status, /openforge sessions, /openforge task <id>.")
    };
  }
  if (command === "status") {
    return {
      ok: true,
      route: "status",
      reply: replyPlan(chatId, statusReply(db, userId))
    };
  }
  if (command === "sessions") {
    return {
      ok: true,
      route: "sessions",
      reply: replyPlan(chatId, sessionsReply(db, userId))
    };
  }
  if (command === "task") {
    return {
      ok: true,
      route: "task",
      reply: replyPlan(chatId, taskReply(db, userId, args[0]))
    };
  }
  return undefined;
}

function statusReply(db: Database, userId: string): string {
  const projects = new ProjectRepository(db, userId).list();
  const sessions = new SessionRepository(db, userId).list();
  const workItems = listAllWorkItems(db, userId, projects);
  const activeSessions = sessions.filter((session) => session.status === "running").length;
  const openTasks = workItems.filter((item) => item.status !== "done" && item.status !== "cancelled").length;
  return [
    "OpenForge status",
    `Projects: ${projects.length}`,
    `Sessions: ${sessions.length} (${activeSessions} running)`,
    `Open tasks: ${openTasks}`,
    "Feishu route: bot long connection; public callback is optional compatibility evidence."
  ].join("\n");
}

function sessionsReply(db: Database, userId: string): string {
  const sessions = new SessionRepository(db, userId).list();
  if (sessions.length === 0) return "No OpenForge sessions are recorded.";
  const rows = sessions.slice(0, 5).map((session) => sessionSummary(session));
  const suffix = sessions.length > rows.length ? `\n...and ${sessions.length - rows.length} more.` : "";
  return ["OpenForge sessions", ...rows].join("\n") + suffix;
}

function taskReply(db: Database, userId: string, workItemId: string | undefined): string {
  if (!workItemId) return "Usage: /openforge task <id>";
  const projects = new ProjectRepository(db, userId).list();
  for (const project of projects) {
    const item = new ProjectManagerRepository(db, userId).getWorkItem(project.id, workItemId);
    if (!item) continue;
    return taskSummary(project, item);
  }
  return "Task not found or not visible to the mapped OpenForge user.";
}

function listAllWorkItems(db: Database, userId: string, projects: Project[]): ProjectManagerWorkItem[] {
  const repo = new ProjectManagerRepository(db, userId);
  return projects.flatMap((project) => repo.listWorkItems(project.id, { limit: 100 }));
}

function sessionSummary(session: Session): string {
  return `- ${session.name}: ${session.status} (${session.aiTool})`;
}

function taskSummary(project: Project, item: ProjectManagerWorkItem): string {
  return [
    `Task: ${item.title}`,
    `Project: ${project.name}`,
    `Status: ${item.status}`,
    `Acceptance criteria: ${item.acceptanceCriteria.length}`,
    `Evidence refs: ${item.evidenceRefs.length}`,
    `Feishu refs: ${item.feishuRefs.length}`
  ].join("\n");
}

function replyPlan(chatId: string, text: string): FeishuBotReplyPlan {
  return {
    receiveId: chatId,
    receiveIdType: "chat_id",
    msgType: "text",
    text
  };
}

function parseOpenForgeCommand(
  text: string,
  commandPrefix: string
): { ok: true; command: string; args: string[] } | { ok: false; reasonCode: string; replyText?: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith(commandPrefix)) {
    return { ok: false, reasonCode: "feishu_command_prefix_required" };
  }
  const raw = trimmed.slice(commandPrefix.length).trim();
  if (!raw) return { ok: true, command: "help", args: [] };
  const [command = "", ...args] = raw.split(/\s+/);
  return {
    ok: true,
    command: command.toLowerCase(),
    args
  };
}

function isTerminalControlCommand(command: string, args: string[]): boolean {
  if (["terminal", "input", "exec", "shell", "pty", "stdin", "approve"].includes(command)) return true;
  return terminalCommandPattern.test([command, ...args].join(" "));
}

function recordBotAccept(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  command: FeishuBotCommand,
  route: FeishuBotCommandRoute
): void {
  new AuditLogRepository(db, userId).create({
    action: "feishu.bot_ws.accept",
    resourceType: "feishu_bot_websocket",
    resourceId: command.messageId ?? command.eventId ?? null,
    details: baseCommandDetails(command, { route }),
    ipAddress
  });
}

function recordBotReject(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  command: FeishuBotCommand,
  reasonCode: string
): void {
  new AuditLogRepository(db, userId).create({
    action: "feishu.bot_ws.reject",
    resourceType: "feishu_bot_websocket",
    resourceId: command.messageId ?? command.eventId ?? null,
    details: baseCommandDetails(command, { reasonCode }),
    ipAddress
  });
}

function baseCommandDetails(command: FeishuBotCommand, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...extra,
    source: "bot_long_connection",
    eventSubscription: supportedEventType,
    publicCallbackRequired: false,
    chatId: command.chatId,
    feishuUserId: command.feishuUserId,
    messageId: command.messageId ?? null,
    eventId: command.eventId ?? null,
    textSummary: textSummary(command.text)
  };
}

function findMappedOpenForgeUserId(repo: FeishuIntegrationRepository, feishuUserId: string): string | null {
  return repo.listUserMappings()
    .find((mapping) => mapping.feishuUserId === feishuUserId)
    ?.openforgeUserId ?? null;
}

function textSummary(text: string): string {
  const redacted = redactFeishuText(text).replace(/\s+/g, " ").trim();
  return redacted.length > 160 ? `${redacted.slice(0, 157)}...` : redacted;
}

function redactFeishuText(text: string): string {
  return redactCopilotText(text).replace(appSecretPattern, "app_secret$1[REDACTED]");
}

function parseFeishuTextContent(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  try {
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) && typeof parsed.text === "string" ? parsed.text.trim() : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}
