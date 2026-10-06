"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSessionWorkStates, type SessionWorkState } from "@/lib/api";
import { FORGEBADGER_GATEWAY_CONNECTED, FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import type { GatewayEvent } from "@/lib/notifications";

/** Native CLI lifecycle events drive the dots; process liveness is separate. */
export function useSessionWorkStates(): ReadonlyMap<string, SessionWorkState> {
  const [events, setEvents] = useState<ReadonlyMap<string, SessionWorkState>>(new Map());
  const { data, refetch } = useQuery({
    queryKey: ["session-work-states"], queryFn: getSessionWorkStates,
    staleTime: 10_000, refetchInterval: 30_000,
  });

  useEffect(() => {
    const onConnected = () => { void refetch(); };
    const onEvent = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as GatewayEvent : undefined;
      if (detail?.type !== "session_work_state_changed") return;
      const payload = detail.payload;
      const sessionId = payload?.session_id, state = payload?.state, updatedAt = payload?.updated_at;
      if (typeof sessionId !== "string" || typeof updatedAt !== "number" || !Number.isFinite(updatedAt)
        || (state !== "working" && state !== "idle" && state !== "unknown")) return;
      setEvents(current => {
        if ((current.get(sessionId)?.updatedAt ?? -1) >= updatedAt) return current;
        return new Map(current).set(sessionId, { sessionId, state, updatedAt });
      });
    };
    window.addEventListener(FORGEBADGER_GATEWAY_EVENT, onEvent);
    window.addEventListener(FORGEBADGER_GATEWAY_CONNECTED, onConnected);
    return () => {
      window.removeEventListener(FORGEBADGER_GATEWAY_EVENT, onEvent);
      window.removeEventListener(FORGEBADGER_GATEWAY_CONNECTED, onConnected);
    };
  }, [refetch]);

  const merged = new Map((data?.states ?? []).map(work => [work.sessionId, work]));
  for (const [id, work] of events) {
    const snapshot = merged.get(id);
    if (!snapshot && data && data.snapshotAt >= work.updatedAt) continue;
    if (!snapshot || work.updatedAt > snapshot.updatedAt) merged.set(id, work);
  }
  return merged;
}
