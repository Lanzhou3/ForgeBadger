"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getSessionWriter, takeoverSession } from "@/lib/platform-actions-api";
export function useTerminalWriter(sessionId: string) {
  const query = useQuery({
    queryKey: ["session-writer", sessionId],
    queryFn: () => getSessionWriter(sessionId),
    refetchInterval: 2000,
  });
  const takeover = useMutation({
    mutationFn: () => takeoverSession(sessionId),
    onSuccess: async () => {
      await query.refetch();
    },
  });
  return {
    readOnly: !query.data || query.isError || query.data.mode === "automated",
    loading: query.isPending,
    error: query.error ?? takeover.error,
    takingOver: takeover.isPending,
    takeover: () => takeover.mutate(),
    refresh: () => void query.refetch(),
  };
}
