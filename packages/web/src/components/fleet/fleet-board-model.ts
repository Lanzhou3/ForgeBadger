import type { CopilotGoalTaskTeam } from "@/lib/copilot-api";
import type { FleetTask } from "@/lib/fleet-api";
import { deriveTaskFlow, type TaskFlow } from "../copilot/goal-task-flow-model";

/**
 * Which board column a fleet task sits in. A pure reading of the task row, its
 * team entry (through `deriveTaskFlow`) and its owner hold, so the board, the
 * flow list and the tests agree.
 */

export type FleetColumnId = "queue" | "write" | "verify" | "review" | "integrate" | "owner" | "done";

export const FLEET_COLUMNS: FleetColumnId[] = ["queue", "write", "verify", "review", "integrate", "owner", "done"];

/** `failed` = something broke (red marker); `attention` = finished but asks for a follow-up (review wants changes). */
export type FleetTrouble = "failed" | "attention" | null;

export interface FleetCardModel {
  task: FleetTask;
  team: CopilotGoalTaskTeam | undefined;
  flow: TaskFlow;
  column: FleetColumnId;
  held: boolean;
  cancelled: boolean;
  trouble: FleetTrouble;
}

function troubleOf(flow: TaskFlow): FleetTrouble {
  if (flow.stages.some((stage) => stage.state === "failed")) return "failed";
  if (flow.headline === "cliFailed" || flow.headline === "taskFailed") return "failed";
  return flow.stages.some((stage) => stage.state === "attention") ? "attention" : null;
}

function stageState(flow: TaskFlow, id: "write" | "verify" | "review" | "integrate") {
  return flow.stages.find((stage) => stage.id === id)?.state;
}

export function columnOf(task: FleetTask, flow: TaskFlow): FleetColumnId {
  if (task.status === "cancelled" || task.status === "passes") return "done";
  if (task.hold) return "owner";
  const write = stageState(flow, "write");
  if (write === "active" || write === "failed") return "write";
  const review = stageState(flow, "review");
  if (review === "active" || review === "attention") return "review";
  // Everything past this point has been written (or has not started at all).
  if (write !== "done") return "queue";
  const verify = stageState(flow, "verify");
  if (verify === "failed" || verify === "todo") return "verify";
  const integrate = stageState(flow, "integrate");
  if (integrate === "todo") return "integrate";
  // Written, verified (or nothing to verify), no own tree to integrate: it only waits for the flagship to confirm.
  return "verify";
}

export function deriveCard(task: FleetTask, team: CopilotGoalTaskTeam | undefined): FleetCardModel {
  const flow = deriveTaskFlow(task, team);
  return {
    task,
    team,
    flow,
    column: columnOf(task, flow),
    held: task.hold != null && task.status !== "cancelled" && task.status !== "passes",
    cancelled: task.status === "cancelled",
    trouble: task.status === "cancelled" || task.status === "passes" ? null : troubleOf(flow),
  };
}

export type FleetBoardModel = Record<FleetColumnId, FleetCardModel[]>;

/** Group tasks into the seven columns, each ordered by sequence number. Cancelled tasks sink to the bottom of "done". */
export function deriveBoard(tasks: FleetTask[], team: CopilotGoalTaskTeam[] | undefined): FleetBoardModel {
  const byTask = new Map((team ?? []).map((entry) => [entry.taskId, entry]));
  const board = Object.fromEntries(FLEET_COLUMNS.map((column) => [column, [] as FleetCardModel[]])) as FleetBoardModel;
  const cards = tasks.map((task) => deriveCard(task, byTask.get(task.id))).sort((a, b) => a.task.seq - b.task.seq);
  for (const card of cards) board[card.column].push(card);
  board.done.sort((a, b) => Number(a.cancelled) - Number(b.cancelled) || a.task.seq - b.task.seq);
  return board;
}
