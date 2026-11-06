"use client";

import { useParams } from "next/navigation";

import { CopilotGoalDetailPage } from "@/components/copilot/copilot-goal-detail-page";

/** Single Copilot goal: tasks, journal timeline, budget usage, and controls. */
export default function CopilotGoalDetailRoute() {
  const params = useParams<{ id: string }>();
  return <CopilotGoalDetailPage goalId={params.id} />;
}
