"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { cancelFollowup, listFollowups, queueFollowup, type CopilotFollowup, type CopilotMessageOptions } from "@/lib/copilot-api";
import { useLanguage } from "@/hooks/use-language";
import { toast } from "@/lib/toast";

export interface UseCopilotFollowupsOptions {
  conversationId: string | null;
  projectId?: string;
  modelId?: string;
  reviewTaskResults?: boolean;
  repairFailedChecks?: boolean;
  toolDiscovery?: boolean;
  /** Poll while a run is in flight so items leave the queue as they drain. */
  active: boolean;
}

export interface CopilotFollowupsController {
  /** Queued and failed items, newest first. */
  items: CopilotFollowup[];
  /** Enqueue a follow-up; resolves true once the server has accepted it. */
  enqueue: (content: string) => Promise<boolean>;
  cancel: (id: string) => Promise<void>;
  enqueuing: boolean;
}

/**
 * Owns the follow-up queue for one conversation. Enqueuing reuses a stable
 * clientRequestId while the same content keeps failing, so a retry after an
 * ambiguous response is deduplicated by the server instead of creating a
 * second turn.
 */
export function useCopilotFollowups({ conversationId, projectId, modelId, reviewTaskResults, repairFailedChecks, toolDiscovery, active }: UseCopilotFollowupsOptions): CopilotFollowupsController {
  const { t } = useLanguage();
  const client = useQueryClient();
  const queryKey = ["copilot-followups", conversationId];
  const query = useQuery({
    queryKey,
    queryFn: () => listFollowups(conversationId!),
    enabled: Boolean(conversationId),
    refetchInterval: state => active || state.state.data?.followups.some(item => item.status === "queued") ? 5000 : false,
  });
  const items = (query.data?.followups ?? []).filter(item => item.status === "queued" || item.status === "failed");
  const [enqueuing, setEnqueuing] = useState(false);
  const request = useRef<{ content: string; options: CopilotMessageOptions & { clientRequestId: string; modelId?: string } } | null>(null);
  const epoch = useRef(0);

  useEffect(() => {
    ++epoch.current;
    setEnqueuing(false);
    request.current = null;
    return () => { epoch.current++; };
  }, [conversationId]);

  // Surface sync failures as a toast instead of an inline red line; the query
  // keeps retrying on its refetch interval.
  const syncErrorToastRef = useRef(false);
  useEffect(() => {
    if (query.isError && !syncErrorToastRef.current) {
      syncErrorToastRef.current = true;
      toast.error(t("copilot.followups.syncFailed"));
    }
    if (!query.isError) syncErrorToastRef.current = false;
  }, [query.isError, t]);

  const enqueue = useCallback(async (raw: string) => {
    const content = raw.trim();
    if (!content || enqueuing || !conversationId) return false;
    const generation = epoch.current;
    if (request.current?.content !== content) request.current = { content, options: {
      clientRequestId: crypto.randomUUID(),
      ...(projectId ? { projectId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(reviewTaskResults !== undefined ? { reviewTaskResults } : {}),
      ...(repairFailedChecks !== undefined ? { repairFailedChecks } : {}),
      ...(toolDiscovery !== undefined ? { toolDiscovery } : {}),
    } };
    const submitted = request.current;
    setEnqueuing(true);
    try {
      await queueFollowup(conversationId, content, submitted.options);
      await query.refetch({ throwOnError: true });
      if (epoch.current !== generation) return true;
      request.current = null;
      return true;
    } catch {
      // The item may or may not have been stored; the retained request id
      // makes a manual retry idempotent rather than duplicating the turn.
      if (epoch.current === generation) toast.error(t("copilot.followups.enqueueUncertain"));
      return false;
    } finally {
      if (epoch.current === generation) setEnqueuing(false);
    }
  }, [conversationId, enqueuing, modelId, projectId, reviewTaskResults, repairFailedChecks, toolDiscovery, query, t]);

  const cancel = useCallback(async (id: string) => {
    if (!conversationId) return;
    const generation = epoch.current;
    try {
      const result = await cancelFollowup(id);
      if (epoch.current !== generation) return;
      if (result.cancelled) client.setQueryData<{ followups: CopilotFollowup[] }>(queryKey, current => current ? { followups: current.followups.filter(item => item.id !== id) } : current);
      else toast.error(t("copilot.followups.cancelStarted"));
    } catch {
      if (epoch.current === generation) toast.error(t("copilot.followups.cancelFailed"));
    }
  }, [client, conversationId, queryKey, t]);

  return { items, enqueue, cancel, enqueuing };
}
