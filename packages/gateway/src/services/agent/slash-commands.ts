/**
 * Copilot slash commands — a registry of local replies answered straight from
 * platform state. A command short-circuits the regular conversation flow
 * before any history projection or model call; the orchestrator persists the
 * reply as an ordinary assistant turn so clients render it exactly like a
 * normal answer. `/goal <spec>` is the exception: it binds the freshly created
 * goal to the current run and deliberately does NOT short-circuit, so the
 * user's spec drives the initializer model turn (see bindGoalCommand).
 */
import { existsSync } from "node:fs";
import type { Database } from "../../db/types.js";
import { CopilotPreferencesRepository } from "../../db/repositories/copilot-preferences-repository.js";
import { ModelProviderRepository } from "../../db/repositories/model-provider-repository.js";
import { CopilotFollowups } from "./followups.js";
import { diffGoalSandbox, goalSandboxDir, mergeGoalSandbox } from "./goal-sandbox.js";
import { CopilotGoalStore, type GoalRow } from "./goal-store.js";
import type { CopilotPlaybookSummary } from "./skills/skill-queries.js";
import { listCopilotPlaybooks } from "./skills/skill-queries.js";
import { AgentError } from "./types.js";

export type SlashCommandCategory = "goal" | "session" | "model" | "info";

export interface SlashCommandContext {
  db: Database;
  masterKey: string;
  userId: string;
  conversationId: string;
  runId: string;
  projectId?: string | undefined;
  /** Raw text after "/name ". */
  args: string;
  /** Lazy playbook summaries, byte-identical to the list_playbooks tool. */
  listPlaybooks: () => readonly CopilotPlaybookSummary[];
  /** Enqueue a goal continuation run (wraps the GoalDriver evaluation). */
  continueGoal: (goalId: string, userText?: string) => void;
}

export interface SlashCommand {
  /** Command name without the leading slash. */
  name: string;
  usage: string;
  description: string;
  category: SlashCommandCategory;
  handler(context: SlashCommandContext): string | Promise<string>;
}

const GOAL_LIFECYCLE_ARGS = new Set(["pause", "resume", "cancel"]);
const GOAL_SPEC_MAX_CHARS = 20_000;
const GOAL_TITLE_MAX_CHARS = 200;

/** Whole-args exact lifecycle form: "/goal cancel the legacy endpoint" is a create, not a cancel. */
function isLifecycleArgs(args: string): boolean {
  return GOAL_LIFECYCLE_ARGS.has(args.trim().toLowerCase());
}

function goalStore(context: SlashCommandContext): CopilotGoalStore {
  return new CopilotGoalStore(context.db, context.userId);
}

/** Latest goal of the conversation, optionally filtered. */
function latestGoal(context: SlashCommandContext, where = ""): GoalRow | undefined {
  return context.db.prepare(`SELECT * FROM copilot_goals WHERE user_id=? AND conversation_id=? ${where} ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(context.userId, context.conversationId) as GoalRow | undefined;
}

function goalSandbox(context: SlashCommandContext, goal: GoalRow): string | undefined {
  if (!goal.project_id) return undefined;
  const directory = goalSandboxDir(context.db, goal.id);
  return existsSync(directory) ? directory : undefined;
}

function latestSandboxGoal(context: SlashCommandContext): { goal: GoalRow; sandboxDir: string } | undefined {
  const candidates = context.db.prepare("SELECT * FROM copilot_goals WHERE user_id=? AND conversation_id=? AND project_id IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 5")
    .all(context.userId, context.conversationId) as GoalRow[];
  for (const goal of candidates) {
    const sandboxDir = goalSandbox(context, goal);
    if (sandboxDir) return { goal, sandboxDir };
  }
  return undefined;
}

function formatGoalLine(goal: GoalRow & { task_total?: number; task_passes?: number }): string {
  const progress = goal.task_total !== undefined ? ` (任务 ${goal.task_passes}/${goal.task_total})` : "";
  return `- [${goal.status}] ${goal.title}${progress} — /copilot/goals/${goal.id}`;
}

function conversationTokenUsage(context: SlashCommandContext): number {
  return (context.db.prepare(`SELECT COALESCE(SUM(c.charged_tokens),0) AS tokens FROM copilot_model_calls c
      JOIN copilot_runs r ON r.id=c.run_id AND r.user_id=c.user_id
      WHERE c.user_id=? AND r.conversation_id=?`)
    .get(context.userId, context.conversationId) as { tokens: number }).tokens;
}

function currentModelLabel(context: SlashCommandContext): string {
  const preferences = new CopilotPreferencesRepository(context.db, context.userId, context.masterKey).get();
  if (!preferences.modelId) return "默认（跟随运行选项）";
  const profile = new ModelProviderRepository(context.db, context.userId, context.masterKey)
    .listModelProfiles().find(model => model.id === preferences.modelId);
  return profile ? `${profile.name}（${profile.providerName}，id: ${profile.id}）` : preferences.modelId;
}

function listModelCatalog(context: SlashCommandContext): string[] {
  const repository = new ModelProviderRepository(context.db, context.userId, context.masterKey);
  const preferences = new CopilotPreferencesRepository(context.db, context.userId, context.masterKey).get();
  const lines: string[] = [];
  for (const provider of repository.listProviderProfiles()) {
    for (const model of repository.listModelProfiles(provider.id)) {
      const marker = model.id === preferences.modelId ? "（当前）" : "";
      lines.push(`- ${model.id}: ${model.name} @ ${provider.name}${marker}`);
    }
  }
  return lines;
}

function switchModel(context: SlashCommandContext, query: string): string {
  const repository = new ModelProviderRepository(context.db, context.userId, context.masterKey);
  const models = repository.listModelProfiles();
  const match = models.find(model => model.id === query)
    ?? models.find(model => model.name.toLowerCase() === query.toLowerCase());
  if (!match) return `没有找到模型 "${query}"。用 /model list 查看可用模型。`;
  new CopilotPreferencesRepository(context.db, context.userId, context.masterKey).set({ modelId: match.id });
  return `已切换模型到 ${match.name}（${match.providerName}，id: ${match.id}）。该偏好对该账号所有新会话生效；显式指定模型的运行不受影响。`;
}

function diffReport(context: SlashCommandContext): string {
  const target = latestSandboxGoal(context);
  if (!target) return "当前对话没有可用的沙箱 diff（Goal 尚无项目沙箱）。Goal 首次写文件后会自动创建沙箱。";
  const project = context.db.prepare("SELECT path FROM projects WHERE user_id=? AND id=?").get(context.userId, target.goal.project_id!) as { path: string } | undefined;
  if (!project) return "Goal 绑定的项目已不存在，无法生成 diff。";
  const { files } = diffGoalSandbox(target.sandboxDir, project.path);
  if (!files.length) return `Goal「${target.goal.title}」的沙箱与项目一致，没有变更。详情：/copilot/goals/${target.goal.id}`;
  const counts = { added: 0, modified: 0, deleted: 0 };
  for (const file of files) counts[file.status] += 1;
  const lines = [`Goal「${target.goal.title}」沙箱变更：added ${counts.added} / modified ${counts.modified} / deleted ${counts.deleted}（共 ${files.length} 个文件）`];
  for (const file of files.slice(0, 3)) {
    lines.push(`--- ${file.path} (${file.status})`);
    lines.push(file.diff.split("\n").slice(0, 8).join("\n"));
  }
  if (files.length > 3) lines.push(`… 其余 ${files.length - 3} 个文件见详情页`);
  lines.push(`详细 diff 与合入：/copilot/goals/${target.goal.id}`);
  return lines.join("\n");
}

function mergeLatestSandbox(context: SlashCommandContext): string {
  const target = latestSandboxGoal(context);
  if (!target) return "没有可合并的沙箱（Goal 尚无项目沙箱或沙箱不存在）。先用 Goal 完成写操作，或在详情页查看。";
  const gate = goalMergeGate(context, target.goal);
  if (gate) return gate;
  const project = context.db.prepare("SELECT path FROM projects WHERE user_id=? AND id=?").get(context.userId, target.goal.project_id!) as { path: string } | undefined;
  if (!project) return "Goal 绑定的项目已不存在，无法合并。";
  try {
    const result = mergeGoalSandbox(target.sandboxDir, project.path);
    const store = goalStore(context);
    const listing = [...result.merged, ...result.deleted.map(path => `${path} (deleted)`), ...result.kept.map(path => `${path} (kept)`)]
      .slice(0, 20).join(", ");
    store.appendJournal(target.goal.id, null, `Merged sandbox into project (slash command): ${listing || "(no changes)"}.`);
    return `已合并 Goal「${target.goal.title}」的沙箱到项目：${listing || "（无变更）"}。`;
  } catch (error) {
    if (error instanceof AgentError && error.code === "COPILOT_GOAL_MERGE_CONFLICT") return `合并被拒绝：${error.message}`;
    throw error;
  }
}

/** Shared merge gate (slash + HTTP route): active goal run or unsettled goal status. */
export function goalMergeGate(context: SlashCommandContext, goal: GoalRow): string | null {
  const active = context.db.prepare(`SELECT 1 FROM copilot_runs WHERE user_id=? AND goal_id=? AND status IN ('pending','running','awaiting_approval') LIMIT 1`)
    .get(context.userId, goal.id);
  if (active) return `Goal「${goal.title}」有活跃 run，暂不能合并。请先停止或等待其结束。`;
  if (goal.status !== "completed" && goal.status !== "blocked")
    return `Goal「${goal.title}」仍在 ${goal.status}，暂不能合并。请等待完成/阻塞后再合并（或到 /copilot/goals/${goal.id} 查看进度）。`;
  return null;
}

function answerGoal(context: SlashCommandContext): string {
  if (!context.args.trim()) return "用法：/answer <内容> — 答复等待决策的 Goal。";
  const goal = latestGoal(context, "AND status='blocked' AND blocked_reason='awaiting_user'");
  if (!goal?.pending_question) return "当前没有等待答复的 Goal（awaiting_user）。";
  goalStore(context).applyAnswer(goal.id, context.args, null);
  context.continueGoal(goal.id, `[Goal 用户答复] ${context.args}`);
  return `已答复 Goal「${goal.title}」，goal 已恢复执行。`;
}

function lifecycleGoal(context: SlashCommandContext): string {
  const action = context.args.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
  const goal = latestGoal(context, "AND status IN ('active','paused')");
  if (!goal) return "当前对话没有进行中的 Goal。用 /goal <spec> 创建一个。";
  const store = goalStore(context);
  if (action === "pause") {
    if (goal.status !== "active") return `Goal「${goal.title}」当前为 ${goal.status}，只有 active 才能暂停。`;
    store.setStatus(goal.id, "paused");
    return `Goal「${goal.title}」已暂停。`;
  }
  if (action === "resume") {
    if (goal.status !== "paused") return `Goal「${goal.title}」当前为 ${goal.status}，只有 paused 才能恢复。`;
    store.setStatus(goal.id, "active");
    context.continueGoal(goal.id);
    return `Goal「${goal.title}」已恢复。`;
  }
  store.setStatus(goal.id, "cancelled");
  return `Goal「${goal.title}」已取消。`;
}

function playbooksListing(context: SlashCommandContext): string {
  const summaries = context.listPlaybooks();
  return [
    `Available Copilot playbooks (${summaries.length}):`,
    ...summaries.map((skill) => `- ${skill.name}: ${skill.description}`)
  ].join("\n");
}

function playbookContent(context: SlashCommandContext): string {
  const name = context.args.trim();
  if (!name) return "用法：/playbook <name>。把指定 playbook 全文载入对话，后续 run 的模型即可看到。";
  const playbooks = listCopilotPlaybooks(context.db, context.userId, {});
  const match = playbooks.find(playbook => playbook.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    const available = playbooks.map(playbook => playbook.name).join(", ") || "(无可用 playbook)";
    return `没有找到 playbook "${name}"。可用：${available}`;
  }
  return `Playbook「${match.name}」全文：\n${match.content.slice(0, 20_000)}`;
}

function goalsListing(context: SlashCommandContext): string {
  const goals = goalStore(context).listGoals(context.conversationId);
  if (!goals.length) return "当前对话还没有 Goal。用 /goal <spec> 创建。";
  return ["当前对话的 Goals：", ...goals.map(formatGoalLine)].join("\n");
}

function statusReport(context: SlashCommandContext): string {
  const activeRun = context.db.prepare(`SELECT status,steps FROM copilot_runs WHERE user_id=? AND conversation_id=? AND status IN ('pending','running','awaiting_approval') ORDER BY created_at DESC LIMIT 1`)
    .get(context.userId, context.conversationId) as { status: string; steps: number } | undefined;
  const activeGoals = (context.db.prepare("SELECT count(*) AS count FROM copilot_goals WHERE user_id=? AND conversation_id=? AND status='active'")
    .get(context.userId, context.conversationId) as { count: number }).count;
  const usage = conversationTokenUsage(context);
  return [
    `活跃 run：${activeRun ? `${activeRun.status}（${activeRun.steps} 步）` : "无"}（本条 /status 即其命令回合）`,
    `当前模型：${currentModelLabel(context)}`,
    `本对话 token 用量：${usage}`,
    `活跃 Goal：${activeGoals} 个`
  ].join("\n");
}

function stopWork(context: SlashCommandContext): string {
  // Single-active-run invariant: the only active run is this command turn
  // itself, which must complete to deliver the reply — so /stop cancels what
  // can still be cancelled: queued follow-ups.
  const followups = new CopilotFollowups(context.db, context.userId).list(context.conversationId);
  let cancelled = 0;
  for (const item of followups) if (item.status === "queued" && new CopilotFollowups(context.db, context.userId).cancel(item.id)) cancelled += 1;
  const queuedLeft = followups.filter(item => item.status === "queued").length - cancelled;
  return `已取消 ${cancelled} 条排队 follow-up。当前对话没有其它活跃 run 可停止${queuedLeft > 0 ? "（仍有 follow-up 在排队）" : ""}。`;
}

function usageReport(context: SlashCommandContext): string {
  const lines = [`本对话 token 消耗：${conversationTokenUsage(context)}`];
  const goal = latestGoal(context);
  if (goal) {
    const usage = goalStore(context).usage(goal.id);
    lines.push(`最近 Goal「${goal.title}」：tokens ${usage.chargedTokens}/${goal.token_budget}，runs ${usage.runCount}/${goal.max_runs}，elapsed ${Math.round(usage.elapsedMs / 1000)}s`);
  }
  return lines.join("\n");
}

export function createSlashCommands(): SlashCommand[] {
  return [
    { name: "help", usage: "/help", description: "按类别列出全部命令与用法", category: "info", handler: () => helpText() },
    { name: "goal", usage: "/goal <spec>", description: "创建 Goal 并以当前 run 作为 initializer（/goal pause|resume|cancel 管理最近 Goal）", category: "goal", handler: lifecycleGoal },
    { name: "goals", usage: "/goals", description: "当前对话的 Goal 列表", category: "goal", handler: goalsListing },
    { name: "diff", usage: "/diff", description: "最近有沙箱 Goal 的变更摘要", category: "goal", handler: diffReport },
    { name: "merge", usage: "/merge", description: "把最近 Goal 的沙箱合并回项目", category: "goal", handler: mergeLatestSandbox },
    { name: "answer", usage: "/answer <内容>", description: "答复等待决策的 Goal", category: "goal", handler: answerGoal },
    { name: "model", usage: "/model [list|<id>]", description: "查看或切换模型（保存为服务端偏好）", category: "model", handler: (context) => {
      const args = context.args.trim();
      if (!args) return `当前模型：${currentModelLabel(context)}\n用 /model list 列出全部模型；/model <id> 切换（保存为服务端偏好）。`;
      if (args.toLowerCase() === "list") {
        const catalog = listModelCatalog(context);
        return ["可用模型：", ...(catalog.length ? catalog : ["（尚未配置模型，请先到模型页添加 provider）"])].join("\n");
      }
      return switchModel(context, args);
    } },
    { name: "status", usage: "/status", description: "当前对话状态：run、模型、token、Goal", category: "info", handler: statusReport },
    { name: "stop", usage: "/stop", description: "取消排队 follow-up 并停止当前工作", category: "session", handler: stopWork },
    { name: "new", usage: "/new", description: "如何开始一个新对话", category: "session", handler: () => "在 Web 控制台点击新建对话即可开始新会话（/copilot）。命令无法替你切换页面。" },
    { name: "playbook", usage: "/playbook <name>", description: "把指定 playbook 全文载入对话", category: "info", handler: playbookContent },
    { name: "playbooks", usage: "/playbooks", description: "列出可用 Copilot playbooks", category: "info", handler: playbooksListing },
    { name: "usage", usage: "/usage", description: "本对话 token 消耗与 Goal 用量", category: "info", handler: usageReport },
    { name: "skills", usage: "/skills", description: "CLI Skill 管理入口提示", category: "info", handler: () => "CLI Skills are managed on the Skills page. Use /playbooks for Copilot operating guides." }
  ];
}

let registry: SlashCommand[] | undefined;
export function listSlashCommands(): SlashCommand[] {
  registry ??= createSlashCommands();
  return registry;
}

export function helpText(): string {
  const lines: string[] = ["可用命令："];
  for (const category of ["goal", "session", "model", "info"] as const) {
    lines.push(`[${category}]`);
    for (const command of listSlashCommands().filter(entry => entry.category === category))
      lines.push(`  ${command.usage} — ${command.description}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Parsing, suggestions, and the /goal bind path
// ---------------------------------------------------------------------------

export interface ParsedSlashInput { name: string; args: string }

export function parseSlashInput(userText: string): ParsedSlashInput | undefined {
  const trimmed = userText.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const body = trimmed.slice(1);
  if (!body) return { name: "", args: "" };
  const space = body.search(/\s/u);
  const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  const args = space === -1 ? "" : body.slice(space + 1).trim();
  return { name, args };
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const upper = previous[j]!;
      previous[j] = Math.min(upper + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = upper;
    }
  }
  return previous[b.length]!;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) if (char === needle[index]) index += 1;
  return index === needle.length;
}

export function suggestCommands(name: string, limit = 3): string[] {
  if (!name) return [];
  const scored = listSlashCommands()
    .map(command => ({ command, distance: levenshtein(name, command.name) }))
    .filter(entry => entry.distance <= 2 || (name.length >= 3 && (isSubsequence(name, entry.command.name) || isSubsequence(entry.command.name, name))))
    .sort((a, b) => a.distance - b.distance);
  return scored.slice(0, limit).map(entry => `/${entry.command.name}`);
}

function unknownCommandReply(userText: string, parsed: ParsedSlashInput): string {
  const suggestions = suggestCommands(parsed.name);
  const lines = [`未知命令：${userText.trim()}`, "输入 /help 查看全部命令。"];
  if (suggestions.length) lines.push(`你是不是想用：${suggestions.join("、")}`);
  return lines.join("\n");
}

/**
 * Resolve a user turn that is a local command. Returns the formatted reply,
 * or null when the input must go through the regular model flow. Matching is
 * case-insensitive, tolerates surrounding whitespace, and passes everything
 * after the command name as args. `/` alone or an unknown command replies
 * with suggestions instead of hitting the model. `/goal <spec>` returns null
 * by design — the orchestrator binds the new goal to the current run first
 * (bindGoalCommand) and lets the spec drive the initializer model turn.
 */
export function resolveLocalCommandReply(
  userText: string,
  listPlaybooks: () => readonly CopilotPlaybookSummary[],
  context?: SlashCommandContext
): string | Promise<string> | null {
  const parsed = parseSlashInput(userText);
  if (!parsed) return null;
  if (parsed.name === "goal" && !isLifecycleArgs(parsed.args)) return null;
  const command = listSlashCommands().find(entry => entry.name === parsed.name);
  if (!command) return unknownCommandReply(userText, parsed);
  const runHandler = () => command.handler({ ...(context ?? EMPTY_CONTEXT), args: parsed.args, listPlaybooks });
  try {
    const result = runHandler();
    if (typeof result === "string") return result;
    return Promise.resolve(result).catch(error => `命令执行失败：${error instanceof Error ? error.message : "未知错误"}`);
  } catch (error) {
    // A broken command must not take down the run: answer with a local error reply.
    return `命令执行失败：${error instanceof Error ? error.message : "未知错误"}`;
  }
}

/** Context-free commands keep working for pure parsing callers. */
const EMPTY_CONTEXT: SlashCommandContext = {
  db: undefined as never, masterKey: "", userId: "", conversationId: "", runId: "",
  args: "", listPlaybooks: () => [], continueGoal: () => undefined
};

export interface GoalCommandBind { goalId?: string; reply?: string }

/**
 * Bind path for `/goal <spec>`: creates the goal and returns its id so the
 * orchestrator can attach it to the CURRENT run (goal_id + input_json) and
 * keep driving the model with the spec as the initializer turn. Lifecycle
 * forms (`/goal pause|resume|cancel`) return undefined so the registry
 * handler answers them; missing spec returns a usage reply.
 */
export function bindGoalCommand(userText: string, context: SlashCommandContext): GoalCommandBind | undefined {
  const parsed = parseSlashInput(userText);
  if (!parsed || parsed.name !== "goal") return undefined;
  if (isLifecycleArgs(parsed.args)) return undefined; // registry lifecycle handler answers these
  if (!parsed.args) return { reply: "用法：/goal <spec> — 创建 Goal 并以当前 run 作为 initializer 开始执行。也可以 /goal pause|resume|cancel 管理最近 Goal。" };
  if (Array.from(parsed.args).length > GOAL_SPEC_MAX_CHARS)
    return { reply: `Goal spec 过长（上限 ${GOAL_SPEC_MAX_CHARS} 字符）。` };
  try {
    const goal = goalStore(context).createGoal({
      conversationId: context.conversationId,
      ...(context.projectId ? { projectId: context.projectId } : {}),
      title: Array.from(parsed.args).slice(0, GOAL_TITLE_MAX_CHARS).join(""),
      spec: parsed.args
    });
    return { goalId: goal.id };
  } catch (error) {
    return { reply: `创建 Goal 失败：${error instanceof AgentError ? error.message : "未知错误"}` };
  }
}
