import { z } from "zod";
import { CopilotPlanRepository, type PlanConfirmation, type PlanConfirmationReceipt } from "../../db/repositories/copilot-plan-repository.js";
import { PROJECT_MANAGER_WORK_ITEM_DESCRIPTION_MAX, ProjectManagerRepository } from "../../db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../../db/repositories/project-repository.js";
import type { Database } from "../../db/types.js";
import { mutateAssignedTask } from "../project-manager/tasks.js";
import { CopilotConversationLog } from "./conversation-log.js";
import { CopilotGoalStore } from "./goal-store.js";
import { assertGoalProjectWritable } from "./goal-workspace.js";
import { linkGoalTasksToBoard } from "./goal-board.js";
import type { TurnInput } from "./run-ledger.js";
import { planProposalSchema, type ProposedPlan } from "./tools/plan.js";
import { AgentError, type AgentMessage } from "./types.js";

export const confirmPlanSchema = z.object({
  action: z.enum(["save", "execute", "goal"]),
  todoIndexes: z.array(z.number().int().min(0).max(29)).min(1).max(30),
  modelId: z.string().trim().min(1).max(128).optional(),
}).strict().refine(value => value.action === "execute" || value.modelId === undefined);

type ConfirmPlanInput = z.infer<typeof confirmPlanSchema>;

function parseProposal(content: string): ProposedPlan | undefined {
  try {
    const result = planProposalSchema.safeParse(JSON.parse(content));
    return result.success ? result.data.plan : undefined;
  } catch {
    return undefined;
  }
}

interface PlanChainLink { previousStepId?: string; supersededBy?: string }

/** Revision chain derived from message order: each valid proposal's predecessor and its later replacement. */
function planChain(repo: CopilotPlanRepository, conversationId: string): Map<string, PlanChainLink> {
  const valid = repo.listProposals(conversationId).filter(row => parseProposal(row.content));
  return new Map(valid.map((row, index) => {
    const previous = valid[index - 1];
    const next = valid[index + 1];
    return [row.message_id, {
      ...(previous ? { previousStepId: previous.step_id } : {}),
      ...(next && !row.receipt_json ? { supersededBy: next.step_id } : {}),
    }];
  }));
}

export function attachPlanProposals(db: Database, userId: string, conversationId: string, messages: AgentMessage[]) {
  if (!messages.some(message => message.kind === "tool_result" && message.toolName === "submit_plan")) return messages;
  const repo = new CopilotPlanRepository(db, userId);
  const proposals = new Map(repo.listProposals(conversationId).map(row => [row.message_id, row]));
  const chain = planChain(repo, conversationId);
  return messages.map(message => {
    const row = proposals.get(message.id);
    if (!row || !parseProposal(row.content)) return message;
    return { ...message, planProposal: {
      projectId: row.project_id,
      ...chain.get(row.message_id),
      ...(row.receipt_json ? { confirmation: (JSON.parse(row.receipt_json) as PlanConfirmationReceipt).confirmation } : {}),
    } };
  });
}

interface SelectedTodo { todo: ProposedPlan["todos"][number]; dependsOn: number[]; droppedDeps: number[] }

/** Remap dependsOn to the selected order (0-based); dependencies on unselected TODOs are dropped (1-based original numbers). */
function selectTodos(plan: ProposedPlan, todoIndexes: number[]): SelectedTodo[] {
  const position = new Map(todoIndexes.map((original, index) => [original, index]));
  return todoIndexes.map(original => {
    const todo = plan.todos[original]!;
    const deps = todo.dependsOn ?? [];
    return {
      todo,
      dependsOn: deps.flatMap(dep => position.has(dep) ? [position.get(dep)!] : []),
      droppedDeps: deps.filter(dep => !position.has(dep)).map(dep => dep + 1),
    };
  });
}

function todoMetaLines(item: SelectedTodo, includeFiles = true): string[] {
  const { todo } = item;
  return [
    item.dependsOn.length ? `Depends on TODO ${item.dependsOn.map(dep => dep + 1).join(", ")}` : "",
    item.droppedDeps.length ? `Original dependencies on unselected TODO ${item.droppedDeps.join(", ")} were dropped` : "",
    includeFiles && todo.files?.length ? `Files: ${todo.files.join(", ")}` : "",
    todo.risk ? `Risk: ${todo.risk}` : "",
    todo.executor ? `Suggested executor: ${todo.executor}` : "",
    todo.parallelizable ? "Can run in parallel with independent TODOs" : "",
  ].filter(Boolean);
}

function describePlan(plan: ProposedPlan, todos: SelectedTodo[]): string {
  return [
    plan.title,
    plan.summary,
    plan.constraints.length && ["Constraints", ...plan.constraints.map(value => `- ${value}`)].join("\n"),
    plan.acceptanceCriteria.length && ["Acceptance criteria", ...plan.acceptanceCriteria.map(value => `- ${value}`)].join("\n"),
    ["Confirmed TODOs", ...todos.map((item, index) => [
      `${index + 1}. ${item.todo.title}`,
      item.todo.description && `   ${item.todo.description}`,
      item.todo.verifyCommand && `   Verify with: ${item.todo.verifyCommand}`,
      ...todoMetaLines(item).map(line => `   ${line}`),
    ].filter(Boolean).join("\n"))].join("\n"),
  ].filter(Boolean).join("\n\n");
}

function boardDescription(item: SelectedTodo): string | undefined {
  const details = [item.todo.description, ...todoMetaLines(item, false)].filter(Boolean).join("\n");
  const files = item.todo.files ?? [];
  for (let count = files.length; count > 0; count--) {
    const remaining = files.length - count;
    const omitted = remaining ? ` (+${remaining} more, see confirmed plan)` : "";
    const lines = [details, `Files: ${files.slice(0, count).join(", ")}${omitted}`].filter(Boolean);
    const description = lines.join("\n");
    if (description.length <= PROJECT_MANAGER_WORK_ITEM_DESCRIPTION_MAX) return description;
  }
  return details || undefined;
}

/** Step budget of a single-run plan execution. */
export function planExecutionMaxSteps(todoCount: number): number {
  return Math.min(64, 16 + 4 * todoCount);
}

export function confirmPlan(db: Database, userId: string, conversationId: string, stepId: string,
  input: ConfirmPlanInput, enqueue: (turn: TurnInput) => string): PlanConfirmation {
  return db.transaction(() => {
    const repo = new CopilotPlanRepository(db, userId);
    const proposal = repo.findProposal(conversationId, stepId);
    const plan = proposal && parseProposal(proposal.content);
    if (!proposal || !plan) throw new AgentError("COPILOT_NOT_FOUND", "Successful plan proposal not found");

    const todoIndexes = [...new Set(input.todoIndexes)].sort((left, right) => left - right);
    if (todoIndexes.some(index => index >= plan.todos.length))
      throw new AgentError("COPILOT_PLAN_SELECTION_INVALID", "The selected TODOs do not belong to this plan");

    if (proposal.receipt_json) {
      const receipt = JSON.parse(proposal.receipt_json) as PlanConfirmationReceipt;
      if (receipt.confirmation.action !== input.action || receipt.modelId !== input.modelId
        || receipt.confirmation.todoIndexes.join() !== todoIndexes.join())
        throw new AgentError("COPILOT_REQUEST_CONFLICT", "This plan has already been confirmed with different options");
      return receipt.confirmation;
    }

    if (planChain(repo, conversationId).get(proposal.message_id)?.supersededBy)
      throw new AgentError("COPILOT_PLAN_SUPERSEDED", "A newer plan replaced this proposal; confirm the latest plan instead");

    const conversation = new CopilotConversationLog(db, userId).getConversation(conversationId);
    if (!conversation) throw new AgentError("COPILOT_NOT_FOUND", "Conversation not found");
    if (conversation.project_id !== proposal.project_id)
      throw new AgentError("COPILOT_PLAN_PROJECT_CHANGED", "The conversation no longer uses the project's original plan context");

    const confirmation = applyPlan(db, userId, conversationId, proposal.project_id, plan, todoIndexes, input, enqueue);
    repo.recordConfirmation(proposal, { confirmation, ...(input.modelId ? { modelId: input.modelId } : {}) });
    return confirmation;
  }).immediate();
}

function applyPlan(db: Database, userId: string, conversationId: string, projectId: string | null,
  plan: ProposedPlan, todoIndexes: number[], input: ConfirmPlanInput, enqueue: (turn: TurnInput) => string): PlanConfirmation {
  const { action, modelId } = input;
  const selected = selectTodos(plan, todoIndexes);
  const confirmation: PlanConfirmation = { action, todoIndexes };
  const userText = `I confirmed the TODOs below. Execute only these TODOs in order and verify the changes.\n\n${describePlan(plan, selected)}`;
  // With a project, "execute" is a single-run goal (same checks as "goal").
  const asGoal = action === "goal" || (action === "execute" && !!projectId);
  if ((asGoal && userText.length > 20_000) || (action === "execute" && userText.length > 32 * 1024))
    throw new AgentError("COPILOT_PLAN_TOO_LONG", "Select fewer tasks or shorten the plan");

  if (action === "save" && !projectId)
    throw new AgentError("COPILOT_PLAN_PROJECT_REQUIRED", "The plan needs a project to save tasks");
  if (projectId && asGoal) {
    const project = new ProjectRepository(db, userId).getById(projectId);
    if (!project) throw new AgentError("COPILOT_NOT_FOUND", "Project not found");
    assertGoalProjectWritable(db, userId, projectId, project.path);
  }

  const workItems = projectId ? createBoardTasks(db, userId, projectId, selected) : [];
  if (action === "save") return confirmation;

  if (asGoal) {
    const store = new CopilotGoalStore(db, userId);
    const goal = store.createGoal({ conversationId, projectId, title: plan.title, spec: userText, autoContinue: action === "goal" });
    const tasks = selected.map((item, index) => ({
      description: item.todo.title, verifyCommand: item.todo.verifyCommand, workItemId: workItems[index]?.id,
    }));
    store.addTasks(goal.id, linkGoalTasksToBoard(db, userId, goal, tasks));
    confirmation.goalId = goal.id;
  }
  // Executing a confirmed plan leaves Plan Mode for the conversation (goal runs skip admission mode persistence).
  new CopilotConversationLog(db, userId).writeConversationMode(conversationId, "execute");
  confirmation.runId = enqueue({
    userId, conversationId, userText, mode: "execute",
    ...(projectId ? { projectId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(confirmation.goalId ? { goalId: confirmation.goalId } : {}),
    ...(action === "execute" ? { maxSteps: planExecutionMaxSteps(selected.length) } : {}),
  });
  return confirmation;
}

function createBoardTasks(db: Database, userId: string, projectId: string, selected: SelectedTodo[]) {
  const items = selected.map(item => mutateAssignedTask(db, userId, projectId, undefined, {
    title: item.todo.title,
    description: boardDescription(item),
    acceptanceCriteria: item.todo.verifyCommand ? [item.todo.verifyCommand] : undefined,
  }));
  const board = new ProjectManagerRepository(db, userId);
  selected.forEach((item, index) => {
    for (const dep of item.dependsOn) board.addWorkItemDependency(projectId, items[index]!.id, items[dep]!.id);
  });
  return items;
}
