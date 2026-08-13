import { z } from "zod";

import {
  CopilotAutomationRepository,
  type CopilotAutomation
} from "../../db/repositories/copilot-automation-repository.js";
import { CopilotRepository } from "../../db/repositories/copilot-repository.js";
import {
  evaluateAutomationAction,
  type AutomationAuthorityMode
} from "./automation-policy.js";
import {
  fromStoredAutomationSchedule,
  normalizeAutomationSchedule,
  toStoredAutomationSchedule,
  type AutomationDefinition,
  type AutomationDeliveryPlan,
  type AutomationSchedule,
  type AutomationScope
} from "./automation-types.js";
import type { CopilotToolContext, CopilotToolDefinition } from "./tool-registry.js";

const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal("every"), intervalMs: z.number().int(), anchorAt: z.string().min(1).max(64).optional() }).strict(),
  z.object({ kind: z.literal("cron"), expression: z.string().min(1).max(128), timezone: z.string().min(1).max(128) }).strict()
]);
const scopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project"), projectIds: z.array(z.string().min(1).max(128)).min(1).max(100) }).strict(),
  z.object({ type: z.literal("workspace") }).strict()
]);
const deliverySchema = z.object({
  channel: z.literal("feishu"), accountId: z.string().min(1).max(128),
  chatId: z.string().min(1).max(128), threadId: z.string().min(1).max(128).optional()
}).strict();
const createSchema = z.object({
  name: z.string().min(1).max(256), prompt: z.string().min(1).max(16_000),
  scope: scopeSchema, schedule: scheduleSchema, delivery: deliverySchema,
  toolAuthority: z.array(z.string().min(1).max(128)).max(64).default(["project.read"])
}).strict();
const updateSchema = createSchema.partial().extend({ automationId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict();
const revisionSchema = z.object({ automationId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict();
const idSchema = z.object({ automationId: z.string().min(1) }).strict();
const limitSchema = z.object({ limit: z.number().int().min(1).max(50).default(20) }).strict();

const scheduleModelSchema = {
  oneOf: [
    { type: "object", properties: { kind: { const: "at" }, at: { type: "string" } }, required: ["kind", "at"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "every" }, intervalMs: { type: "integer", minimum: 60_000 }, anchorAt: { type: "string" } }, required: ["kind", "intervalMs"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "cron" }, expression: { type: "string" }, timezone: { type: "string", description: "Required IANA timezone, for example Asia/Shanghai." } }, required: ["kind", "expression", "timezone"], additionalProperties: false }
  ]
};
const scopeModelSchema = {
  oneOf: [
    { type: "object", properties: { type: { const: "project" }, projectIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 } }, required: ["type", "projectIds"], additionalProperties: false },
    { type: "object", properties: { type: { const: "workspace" } }, required: ["type"], additionalProperties: false }
  ]
};
const deliveryModelSchema = {
  type: "object",
  properties: { channel: { const: "feishu" }, accountId: { type: "string" }, chatId: { type: "string" }, threadId: { type: "string" } },
  required: ["channel", "accountId", "chatId"], additionalProperties: false
};

type AutomationMutationResult =
  | { requiresApproval: true; actionId: string; status: "pending"; reasons: string[] }
  | { requiresApproval: false; status: "executed"; automation?: unknown; run?: unknown };

export function createCopilotAutomationTools(): CopilotToolDefinition[] {
  const dynamicApproval = (output: unknown) => isRecord(output) && output.requiresApproval === true;
  return [
    readTool("openforge.list_automations", "List bounded Copilot automations.", limitSchema, (input, service) => service.list(input.limit)),
    readTool("openforge.get_automation", "Read one Copilot automation.", idSchema, (input, service) => service.get(input.automationId)),
    mutationTool("openforge.propose_automation_create", "Create a scheduled Copilot automation from a structured natural-language proposal.", createSchema, (input, service) => service.create(input), dynamicApproval),
    mutationTool("openforge.propose_automation_update", "Update a Copilot automation with optimistic revision control.", updateSchema, (input, service) => service.update(input), dynamicApproval),
    mutationTool("openforge.propose_automation_pause", "Pause a Copilot automation.", revisionSchema, (input, service) => service.setStatus(input, "paused"), dynamicApproval),
    mutationTool("openforge.propose_automation_resume", "Resume a Copilot automation.", revisionSchema, (input, service) => service.resume(input), dynamicApproval),
    mutationTool("openforge.propose_automation_delete", "Delete a Copilot automation.", revisionSchema, (input, service) => service.setStatus(input, "deleted"), dynamicApproval),
    mutationTool("openforge.propose_automation_run_now", "Queue an immediate run of a Copilot automation.", idSchema, (input, service) => service.runNow(input.automationId), dynamicApproval),
    readTool("openforge.list_automation_runs", "List bounded run history for one automation.", idSchema.extend({ limit: z.number().int().min(1).max(50).default(20) }).strict(), (input, service) => service.listRuns(input.automationId, input.limit))
  ];
}

class CopilotAutomationDomainService {
  private readonly automations: CopilotAutomationRepository;
  private readonly copilot: CopilotRepository;
  private readonly mode: AutomationAuthorityMode;
  private readonly callerTools: string[];

  constructor(private readonly context: CopilotToolContext) {
    this.automations = new CopilotAutomationRepository(context.db, context.userId, context.masterKey);
    this.copilot = new CopilotRepository(context.db, context.userId);
    this.mode = context.automationAuthority?.mode ?? "observe";
    this.callerTools = context.automationAuthority?.toolNames ?? ["project.read", "session.read"];
  }

  list(limit: number): { automations: unknown[] } {
    return { automations: this.automations.list().slice(0, limit).map(toSummary) };
  }

  get(automationId: string): { automation: unknown | null } {
    const automation = this.automations.get(automationId);
    return { automation: automation ? toDetail(automation) : null };
  }

  create(input: z.infer<typeof createSchema>): AutomationMutationResult {
    const normalized = normalizeAutomationSchedule(input.schedule);
    const definition = toDefinition(input);
    const decision = evaluateAutomationAction({ mode: this.mode, callerTools: this.callerTools, proposed: definition });
    return this.applyOrPropose("openforge.propose_automation_create", input, decision.reasons, () => {
      const stored = toStoredAutomationSchedule(normalized);
      return this.automations.create({
        name: input.name, status: "active", scopeType: input.scope.type,
        scopePolicy: input.scope, prompt: input.prompt, ...stored,
        deliveryPlan: input.delivery,
        authoritySnapshot: { mode: this.mode, tools: decision.effectiveTools },
        nextRunAt: normalized.nextRunAt
      });
    }, decision.requiresApproval);
  }

  update(input: z.infer<typeof updateSchema>): AutomationMutationResult {
    const current = this.requireAutomation(input.automationId);
    const proposed = mergeDefinition(current, input);
    const decision = evaluateAutomationAction({
      mode: this.mode, callerTools: this.callerTools, current: toDefinitionFromRow(current), proposed,
      expectedRevision: input.expectedRevision, currentRevision: current.revision
    });
    return this.applyOrPropose("openforge.propose_automation_update", input, decision.reasons, () => {
      const schedule = input.schedule ? normalizeAutomationSchedule(input.schedule) : undefined;
      const stored = schedule ? toStoredAutomationSchedule(schedule) : undefined;
      return this.automations.updateWithRevision(current.id, input.expectedRevision, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.scope !== undefined ? { scopeType: input.scope.type, scopePolicy: input.scope } : {}),
        ...(input.delivery !== undefined ? { deliveryPlan: input.delivery } : {}),
        ...(input.toolAuthority !== undefined
          ? { authoritySnapshot: { mode: this.mode, tools: decision.effectiveTools } }
          : {}),
        ...(stored ?? {}), ...(schedule ? { nextRunAt: schedule.nextRunAt } : {})
      });
    }, decision.requiresApproval);
  }

  setStatus(input: z.infer<typeof revisionSchema>, status: "paused" | "deleted"): AutomationMutationResult {
    const current = this.requireAutomation(input.automationId);
    return this.policyMutation(`openforge.propose_automation_${status === "paused" ? "pause" : "delete"}`, current, input, () =>
      this.automations.updateWithRevision(current.id, input.expectedRevision, { status, nextRunAt: status === "paused" ? null : current.nextRunAt })
    );
  }

  resume(input: z.infer<typeof revisionSchema>): AutomationMutationResult {
    const current = this.requireAutomation(input.automationId);
    return this.policyMutation("openforge.propose_automation_resume", current, input, () => {
      const schedule = normalizeAutomationSchedule(fromStoredAutomationSchedule(current));
      return this.automations.updateWithRevision(current.id, input.expectedRevision, { status: "active", nextRunAt: schedule.nextRunAt });
    });
  }

  runNow(automationId: string): AutomationMutationResult {
    const current = this.requireAutomation(automationId);
    return this.policyMutation("openforge.propose_automation_run_now", current, { automationId }, () => {
      const run = this.automations.createOrGetRun(current.id, `manual:${new Date().toISOString()}`, "manual");
      return { run };
    });
  }

  listRuns(automationId: string, limit: number): { runs: unknown[] } {
    this.requireAutomation(automationId);
    return { runs: this.automations.listRuns(automationId).slice(-limit).map((run) => ({ ...run, claimToken: undefined })) };
  }

  private policyMutation(
    type: string,
    current: CopilotAutomation,
    input: Record<string, unknown>,
    execute: () => unknown
  ): AutomationMutationResult {
    const definition = toDefinitionFromRow(current);
    const decision = evaluateAutomationAction({ mode: this.mode, callerTools: this.callerTools, current: definition, proposed: definition });
    return this.applyOrPropose(type, input, decision.reasons, execute, decision.requiresApproval);
  }

  private applyOrPropose(
    type: string,
    input: unknown,
    reasons: string[],
    execute: () => unknown,
    requiresApproval: boolean
  ): AutomationMutationResult {
    if (!requiresApproval) return { requiresApproval: false, status: "executed", automation: execute() };
    if (!this.context.runId) throw new Error("Copilot run is required for pending actions");
    const action = this.copilot.createPendingAction(this.context.runId, {
      type,
      input: { ...(isRecord(input) ? input : {}), policyReasons: reasons }
    });
    return { requiresApproval: true, actionId: action.id, status: "pending", reasons };
  }

  private requireAutomation(id: string): CopilotAutomation {
    const automation = this.automations.get(id);
    if (!automation) throw new Error("AUTOMATION_NOT_FOUND");
    return automation;
  }
}

function readTool<T extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: T,
  execute: (input: z.infer<T>, service: CopilotAutomationDomainService) => unknown
): CopilotToolDefinition {
  return { name, description, risk: "read", requiresApproval: false, inputSchema: schema,
    modelInputSchema: modelSchemaFor(name),
    execute: async (input, context) => execute(schema.parse(input), new CopilotAutomationDomainService(context)) };
}

function mutationTool<T extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: T,
  execute: (input: z.infer<T>, service: CopilotAutomationDomainService) => unknown,
  resolveApproval: (output: unknown) => boolean
): CopilotToolDefinition {
  return { name, description, risk: "prepare", requiresApproval: true, resolveApproval, inputSchema: schema,
    modelInputSchema: modelSchemaFor(name),
    execute: async (input, context) => execute(schema.parse(input), new CopilotAutomationDomainService(context)) };
}

function modelSchemaFor(name: string): Record<string, unknown> {
  if (name === "openforge.propose_automation_create") {
    return {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 256 }, prompt: { type: "string", maxLength: 16_000 },
        scope: scopeModelSchema, schedule: scheduleModelSchema, delivery: deliveryModelSchema,
        toolAuthority: { type: "array", items: { type: "string" }, maxItems: 64 }
      },
      required: ["name", "prompt", "scope", "schedule", "delivery"], additionalProperties: false
    };
  }
  if (name === "openforge.propose_automation_update") {
    return {
      type: "object",
      properties: {
        automationId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 },
        name: { type: "string", maxLength: 256 }, prompt: { type: "string", maxLength: 16_000 },
        scope: scopeModelSchema, schedule: scheduleModelSchema, delivery: deliveryModelSchema,
        toolAuthority: { type: "array", items: { type: "string" }, maxItems: 64 }
      },
      required: ["automationId", "expectedRevision"], additionalProperties: false
    };
  }
  if (["openforge.propose_automation_pause", "openforge.propose_automation_resume", "openforge.propose_automation_delete"].includes(name)) {
    return { type: "object", properties: { automationId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 } }, required: ["automationId", "expectedRevision"], additionalProperties: false };
  }
  if (name === "openforge.list_automations") {
    return { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false };
  }
  if (name === "openforge.list_automation_runs") {
    return { type: "object", properties: { automationId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["automationId"], additionalProperties: false };
  }
  return { type: "object", properties: { automationId: { type: "string" } }, required: ["automationId"], additionalProperties: false };
}

function toDefinition(input: {
  scope: AutomationScope; schedule: AutomationSchedule; delivery: AutomationDeliveryPlan; toolAuthority: string[];
}): AutomationDefinition {
  return { scope: input.scope, schedule: input.schedule, delivery: input.delivery, toolAuthority: input.toolAuthority };
}

function toDefinitionFromRow(row: CopilotAutomation): AutomationDefinition {
  const tools = Array.isArray(row.authoritySnapshot.tools)
    ? row.authoritySnapshot.tools.filter((tool): tool is string => typeof tool === "string") : [];
  return {
    scope: row.scopeType === "workspace" ? { type: "workspace" } : {
      type: "project",
      projectIds: Array.isArray(row.scopePolicy.projectIds)
        ? row.scopePolicy.projectIds.filter((id): id is string => typeof id === "string") : []
    },
    schedule: fromStoredAutomationSchedule(row), delivery: row.deliveryPlan as unknown as AutomationDeliveryPlan,
    toolAuthority: tools
  };
}

function mergeDefinition(row: CopilotAutomation, patch: z.infer<typeof updateSchema>): AutomationDefinition {
  const current = toDefinitionFromRow(row);
  return {
    scope: patch.scope ?? current.scope,
    schedule: patch.schedule ?? current.schedule,
    delivery: patch.delivery ?? current.delivery,
    toolAuthority: patch.toolAuthority ?? current.toolAuthority
  };
}

function toSummary(row: CopilotAutomation): unknown {
  return { id: row.id, name: row.name, status: row.status, scopeType: row.scopeType, scheduleKind: row.scheduleKind,
    timezone: row.timezone, revision: row.revision, nextRunAt: row.nextRunAt };
}

function toDetail(row: CopilotAutomation): unknown {
  return { ...toSummary(row) as object, prompt: row.prompt, scopePolicy: row.scopePolicy,
    scheduleExpression: row.scheduleExpression, deliveryPlan: row.deliveryPlan, authoritySnapshot: row.authoritySnapshot };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
