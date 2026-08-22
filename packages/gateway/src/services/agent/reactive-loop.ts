/**
 * Reactive loop for the Copilot harness — the proactive wake-up seam.
 *
 * The platform event bus is the wake signal: on relevant project/session/
 * portfolio events the loop debounces per user, then starts a proactive
 * Copilot turn (source: "reactive") in a freshly-created conversation. The
 * agent reads current platform state with its read tools and reports a concise
 * update to the owner. Operate tools stay behind the security-policy approval
 * gate, so the loop grants no new authority.
 *
 * `copilot_run_updated` never wakes the loop (a proactive turn would otherwise
 * re-trigger itself); `claude_notification` is excluded as too noisy (permission/
 * idle prompts would wake the agent mid-session). All timers are `.unref()`d so a
 * pending debounce never keeps the process alive in tests.
 */
import type { OpenForgeEvent, OpenForgeEventBus } from "../event-bus.js";
import { CopilotConversationLog } from "./conversation-log.js";
import type { AgentStack, AgentStackDeps } from "./agent-stack.js";

const DEFAULT_DEBOUNCE_MS = 20_000;
const DEFAULT_COOLDOWN_MS = 60_000;
export const PROACTIVE_CONVERSATION_TITLE = "Copilot 主动更新";

/** Event types that wake the proactive loop. Tune here as the policy evolves. */
const REACTIVE_TRIGGERS = new Set<string>([
  "session_status_changed",
  "session_created",
  "session_deleted",
  "activity_created",
  "portfolio_projection_updated"
]);

const MAX_EVENT_DESC_CHARS = 200;

export interface CopilotReactiveLoopOptions {
  deps: AgentStackDeps;
  buildAgentStack: (deps: AgentStackDeps, userId: string) => AgentStack;
  /** Collapse a burst of events per user into one fire. */
  debounceMs?: number;
  /** Minimum interval between two proactive fires for the same user. */
  cooldownMs?: number;
}

export interface CopilotReactiveLoop {
  stop(): void;
}

export function attachCopilotReactiveLoop(options: CopilotReactiveLoopOptions): CopilotReactiveLoop {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const latestEvent = new Map<string, OpenForgeEvent>();
  const lastFireAt = new Map<string, number>();
  const inFlight = new Set<string>();
  let stopped = false;

  function schedule(userId: string, event: OpenForgeEvent): void {
    latestEvent.set(userId, event);
    const existing = debounceTimers.get(userId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(userId);
      void fire(userId);
    }, debounceMs);
    timer.unref?.();
    debounceTimers.set(userId, timer);
  }

  async function fire(userId: string): Promise<void> {
    if (stopped) return;
    const event = latestEvent.get(userId);
    if (!event) return;

    if (inFlight.has(userId)) {
      // A proactive turn is already running; re-arm so the latest change still
      // gets reported once the current turn finishes.
      schedule(userId, event);
      return;
    }

    const now = Date.now();
    const last = lastFireAt.get(userId) ?? 0;
    if (now - last < cooldownMs) {
      // Still inside the cooldown window — defer to the next debounce tick.
      schedule(userId, event);
      return;
    }

    latestEvent.delete(userId);
    inFlight.add(userId);
    lastFireAt.set(userId, now);
    try {
      const prompt = buildProactivePrompt(event);
      if (options.deps.dshBff) {
        // dsh path (M3): the proactive turn runs on the per-user kernel via the
        // BFF with the same run contract; debounce/cooldown semantics above are
        // unchanged. A parked approval (awaiting_approval) still ends fire().
        const log = new CopilotConversationLog(options.deps.db, userId);
        const conversation = log.createConversation(PROACTIVE_CONVERSATION_TITLE);
        await options.deps.dshBff.sendMessage({
          userId,
          conversationId: conversation.id,
          content: prompt,
          source: "reactive"
        });
        return;
      }
      const stack = options.buildAgentStack(options.deps, userId);
      const conversation = stack.log.createConversation(PROACTIVE_CONVERSATION_TITLE);
      await stack.orchestrator.runTurn({
        userId,
        conversationId: conversation.id,
        userText: prompt,
        source: "reactive"
      });
    } catch {
      // The orchestrator already emits a copilot_run_updated failure; the loop
      // must survive a failed proactive turn (e.g. no model configured).
    } finally {
      inFlight.delete(userId);
    }
  }

  function onEvent(event: OpenForgeEvent): void {
    if (stopped) return;
    if (!REACTIVE_TRIGGERS.has(event.type)) return;
    schedule(event.userId, event);
  }

  options.deps.eventBus.on("event", onEvent);

  function stop(): void {
    stopped = true;
    options.deps.eventBus.off("event", onEvent);
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();
    latestEvent.clear();
    lastFireAt.clear();
  }

  return { stop };
}

function buildProactivePrompt(event: OpenForgeEvent): string {
  return [
    "平台刚刚发生了一个事件，请你主动查看并汇报。",
    `事件：${describeEvent(event)}`,
    "请用只读工具（projects / sessions / portfolio / memory）查看相关项目与会话的最新进度，",
    "给出一段简短的中文主动更新（2-4 句）：发生了什么、当前状态、以及是否需要我关注或采取行动。",
    "不要执行任何写操作；如果需要，先申请我的批准。"
  ].join("\n");
}

function describeEvent(event: OpenForgeEvent): string {
  let description: string;
  switch (event.type) {
    case "session_status_changed":
      description = `会话 ${event.sessionId} 状态从 ${event.oldStatus} 变为 ${event.newStatus}`;
      break;
    case "session_created":
      description = `新会话 ${event.sessionId} 已创建（项目 ${event.projectId}）`;
      break;
    case "session_deleted":
      description = `会话 ${event.sessionId} 已删除`;
      break;
    case "activity_created":
      description = `新增活动 ${event.activityType}（${event.status}）：${event.message}`;
      break;
    case "portfolio_projection_updated":
      description = `组合投影更新 ${event.kind}（${event.recordId}${event.state ? ` → ${event.state}` : ""}）`;
      break;
    default:
      description = event.type;
  }
  return description.length > MAX_EVENT_DESC_CHARS
    ? `${description.slice(0, MAX_EVENT_DESC_CHARS)}…`
    : description;
}
