import { Badge } from "@/components/ui/badge";

import type { CopilotGoalStatus } from "@/lib/copilot-api";
import { useGoalsCopy } from "./goals-copy";

const STATUS_CLASSES: Record<CopilotGoalStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  paused: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  completed: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  blocked: "bg-destructive/15 text-destructive",
  cancelled: "text-muted-foreground",
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
    <Badge variant="secondary" className={STATUS_CLASSES[status]}>
      {copy[STATUS_LABEL_KEYS[status]]}
    </Badge>
  );
}
