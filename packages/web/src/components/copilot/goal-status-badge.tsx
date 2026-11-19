import type { CopilotGoalStatus } from "@/lib/copilot-api";
import { CopilotStatusBadge, type CopilotStatusTone } from "./copilot-status-badge";
import { useGoalsCopy } from "./goals-copy";

const STATUS_TONES: Record<CopilotGoalStatus, CopilotStatusTone> = {
  active: "success",
  paused: "warning",
  completed: "info",
  blocked: "destructive",
  cancelled: "muted",
};

type GoalStatusLabelKey =
  | "statusActive"
  | "statusPaused"
  | "statusCompleted"
  | "statusBlocked"
  | "statusCancelled";

const STATUS_LABEL_KEYS: Record<CopilotGoalStatus, GoalStatusLabelKey> = {
  active: "statusActive",
  paused: "statusPaused",
  completed: "statusCompleted",
  blocked: "statusBlocked",
  cancelled: "statusCancelled",
};

export function GoalStatusBadge({ status }: { status: CopilotGoalStatus }) {
  const copy = useGoalsCopy();
  return (
    <CopilotStatusBadge tone={STATUS_TONES[status]} dot={status === "active"}>
      {copy[STATUS_LABEL_KEYS[status]]}
    </CopilotStatusBadge>
  );
}
