"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { copilotPreferencesQueryKey } from "@/components/copilot/copilot-runtime-panel";
import { getCopilotPreferences, type CopilotChatMode } from "@/lib/copilot-api";

/**
 * Plan Mode may use its own model (preference `planModelId`). An explicit model
 * pick made in the current conversation always wins; otherwise a plan-mode
 * composer shows the plan model and lets Gateway resolve it when admitted.
 */
export function useCopilotPlanModel(mode: CopilotChatMode, modelId: string | null, conversationId: string | null) {
  const preferences = useQuery({ queryKey: copilotPreferencesQueryKey, queryFn: getCopilotPreferences, retry: false });
  const [pickedIn, setPickedIn] = useState<{ conversationId: string | null } | null>(null);
  const planModelId = preferences.data?.planModelId ?? null;
  // A pick on a draft (no conversation yet) carries into its first conversation.
  useEffect(() => {
    setPickedIn(current => {
      if (!current || current.conversationId === conversationId) return current;
      return current.conversationId === null ? { conversationId } : null;
    });
  }, [conversationId]);
  const markModelPicked = useCallback((picked: string | null) => setPickedIn(picked ? { conversationId } : null), [conversationId]);
  const explicitlyPicked = pickedIn !== null && (pickedIn.conversationId === null || pickedIn.conversationId === conversationId);
  const planModelOverrideId = mode === "plan" && !explicitlyPicked ? planModelId : null;
  const effectiveModelId = mode === "plan" && !explicitlyPicked ? null : modelId;
  return { effectiveModelId, pickedModelId: explicitlyPicked ? modelId : null, planModelOverrideId, markModelPicked };
}
