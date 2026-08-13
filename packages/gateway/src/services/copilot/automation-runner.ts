import type {
  CopilotAutomation,
  CopilotAutomationRun,
  CopilotAutomationRepository
} from "../../db/repositories/copilot-automation-repository.js";
import type { FeishuDeliveryPlan } from "../integrations/feishu-delivery-service.js";

interface AutomationProjectSnapshot {
  projectId: string;
  name: string;
}

interface AutomationGenerationInput {
  automation: CopilotAutomation;
  projects: AutomationProjectSnapshot[];
  prompt: string;
  toolAuthority: string[];
  startedAt: Date;
  deadlineAt: Date;
  maxUsageTokens: number;
  signal: AbortSignal;
}

interface AutomationRunnerOptions {
  now?: () => Date;
  listProjects: () => AutomationProjectSnapshot[];
  generate: (input: AutomationGenerationInput) => Promise<{ content: string; usageTokens: number }>;
  enqueueDelivery: (plan: FeishuDeliveryPlan) => Promise<{ id: string }>;
  deadlineMs?: number;
  maxUsageTokens?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  leaseMs?: number;
}

export class CopilotAutomationRunner {
  private readonly now: () => Date;
  private readonly deadlineMs: number;
  private readonly maxUsageTokens: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly leaseMs: number;

  constructor(
    private readonly repository: CopilotAutomationRepository,
    private readonly options: AutomationRunnerOptions
  ) {
    this.now = options.now ?? (() => new Date());
    this.deadlineMs = clamp(options.deadlineMs ?? 120_000, 1_000, 30 * 60_000);
    this.maxUsageTokens = clamp(options.maxUsageTokens ?? 50_000, 100, 1_000_000);
    this.maxAttempts = clamp(options.maxAttempts ?? 3, 1, 10);
    this.retryDelayMs = clamp(options.retryDelayMs ?? 30_000, 0, 60 * 60_000);
    this.leaseMs = clamp(options.leaseMs ?? 180_000, 5_000, 30 * 60_000);
  }

  async run(runId: string): Promise<CopilotAutomationRun> {
    const claimed = this.repository.claimRun(runId, this.now(), this.leaseMs);
    const claimToken = claimed.claimToken;
    if (!claimToken) throw new Error("AUTOMATION_RUN_CLAIM_MISMATCH");
    try {
      const automation = this.repository.get(claimed.automationId);
      if (!automation) throw new Error("AUTOMATION_NOT_FOUND");
      const projects = this.ensureProjectSnapshot(automation, claimed, claimToken);
      const content = await this.ensureGeneratedContent(automation, claimed, projects, claimToken);
      const outbox = await this.options.enqueueDelivery(toDeliveryPlan(automation, claimed, content));
      return this.repository.completeRun(claimed.id, claimToken, outbox.id, this.now());
    } catch (error) {
      const normalized = normalizeRunError(error);
      this.repository.failRun(claimed.id, claimToken, {
        retryable: claimed.attemptCount < this.maxAttempts,
        errorCode: normalized.code,
        errorMessage: normalized.message,
        retryAt: new Date(this.now().getTime() + this.retryDelayMs),
        now: this.now()
      });
      throw error;
    }
  }

  private ensureProjectSnapshot(
    automation: CopilotAutomation,
    run: CopilotAutomationRun,
    claimToken: string
  ): AutomationProjectSnapshot[] {
    const existing = this.repository.listProjectSnapshots(run.id);
    if (existing.length) return existing;
    const available = this.options.listProjects();
    const selected = selectProjects(automation, available);
    this.repository.saveProjectSnapshot(run.id, claimToken, selected);
    return selected;
  }

  private async ensureGeneratedContent(
    automation: CopilotAutomation,
    run: CopilotAutomationRun,
    projects: AutomationProjectSnapshot[],
    claimToken: string
  ): Promise<string> {
    // A delivery retry resumes from encrypted generated content and never calls the model twice.
    const existing = this.repository.decryptGeneratedContent(run.id);
    if (existing !== undefined) return existing;
    const authority = parseAuthority(automation.authoritySnapshot, this.deadlineMs, this.maxUsageTokens);
    const startedAt = this.now();
    const deadlineAt = new Date(startedAt.getTime() + authority.deadlineMs);
    const controller = new AbortController();
    const result = await withDeadline(
      this.options.generate({
        automation,
        projects,
        prompt: automation.prompt,
        toolAuthority: authority.tools,
        startedAt,
        deadlineAt,
        maxUsageTokens: authority.maxUsageTokens,
        signal: controller.signal
      }),
      authority.deadlineMs,
      controller
    );
    if (result.usageTokens > authority.maxUsageTokens) throw new Error("AUTOMATION_USAGE_BUDGET_EXCEEDED");
    const content = result.content.trim();
    if (!content || content.length > 100_000) throw new Error("AUTOMATION_GENERATED_CONTENT_INVALID");
    this.repository.saveGeneratedContent(run.id, claimToken, content);
    return content;
  }
}

function selectProjects(
  automation: CopilotAutomation,
  available: AutomationProjectSnapshot[]
): AutomationProjectSnapshot[] {
  if (automation.scopeType === "workspace") return available.slice(0, 500);
  if (automation.scopeType !== "project") throw new Error("AUTOMATION_SCOPE_INVALID");
  const projectIds = Array.isArray(automation.scopePolicy.projectIds)
    ? automation.scopePolicy.projectIds.filter((value): value is string => typeof value === "string")
    : [];
  const allowed = new Set(projectIds);
  const selected = available.filter((project) => allowed.has(project.projectId));
  if (!selected.length) throw new Error("AUTOMATION_SCOPE_EMPTY");
  return selected;
}

function parseAuthority(
  snapshot: Record<string, unknown>,
  defaultDeadlineMs: number,
  defaultMaxUsageTokens: number
): { tools: string[]; deadlineMs: number; maxUsageTokens: number } {
  const tools = Array.isArray(snapshot.tools)
    ? [...new Set(snapshot.tools.filter((tool): tool is string => typeof tool === "string" && tool.length <= 128))]
    : [];
  const requestedDeadline = typeof snapshot.deadlineMs === "number" ? snapshot.deadlineMs : defaultDeadlineMs;
  const requestedUsage = typeof snapshot.maxUsageTokens === "number" ? snapshot.maxUsageTokens : defaultMaxUsageTokens;
  // Runtime caps may tighten a saved authority snapshot but can never expand it.
  return {
    tools,
    deadlineMs: Math.min(clamp(requestedDeadline, 1_000, 30 * 60_000), defaultDeadlineMs),
    maxUsageTokens: Math.min(clamp(requestedUsage, 100, 1_000_000), defaultMaxUsageTokens)
  };
}

function toDeliveryPlan(
  automation: CopilotAutomation,
  run: CopilotAutomationRun,
  content: string
): FeishuDeliveryPlan {
  const plan = automation.deliveryPlan;
  if (plan.channel !== "feishu" || typeof plan.accountId !== "string" || typeof plan.chatId !== "string") {
    throw new Error("AUTOMATION_DELIVERY_PLAN_INVALID");
  }
  return {
    accountId: plan.accountId,
    chatId: plan.chatId,
    ...(typeof plan.threadId === "string" ? { threadId: plan.threadId } : {}),
    idempotencyKey: `automation:${run.executionId}`,
    parts: [{ type: "text", content }]
  };
}

async function withDeadline<T>(promise: Promise<T>, deadlineMs: number, controller: AbortController): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("AUTOMATION_DEADLINE_EXCEEDED"));
    }, deadlineMs);
    timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeRunError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : "Automation run failed";
  const code = /^AUTOMATION_[A-Z0-9_]+$/u.test(message) ? message : "AUTOMATION_RUN_FAILED";
  return { code, message: message.replace(/[\r\n\u0000-\u001f\u007f]/gu, " ").slice(0, 500) };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.trunc(value), minimum), maximum);
}
