"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { listConversationRuns, revokeRunRepairs } from "@/lib/copilot-api";
import { useSettingsCopy } from "./settings-copy";

interface Props { conversationId: string }

/** Retains withdrawal of persisted repair consent after retiring the opt-in UI. */
export function CopilotRepairControl({ conversationId }: Props) {
  const copy = useSettingsCopy();
  const client = useQueryClient();
  const queryKey = ["copilot", "runs", conversationId];
  const runs = useQuery({ queryKey, queryFn: () => listConversationRuns(conversationId), refetchInterval: 30_000 });
  const runIds = runs.data?.repairRunIds ?? [];
  const revoke = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => revokeRunRepairs(id)));
      for (const result of results) if (result.status === "rejected") throw result.reason;
    },
    onSettled: () => client.invalidateQueries({ queryKey })
  });
  if (runs.isError) return (
    <Button variant="ghost" size="sm" className="mr-auto text-xs" onClick={() => void runs.refetch()}>
      {copy.repairRevokeError}
    </Button>
  );
  if (!runIds.length && !revoke.isSuccess && !revoke.isError) return null;
  return (
    <div className="mr-auto min-w-0">
      <Button variant="ghost" size="sm" className="h-7 max-w-full truncate px-2 text-xs"
        disabled={revoke.isPending || revoke.isSuccess || !runIds.length} onClick={() => revoke.mutate(runIds)}>
        {revoke.isSuccess ? copy.repairRevoked : copy.repairRevoke}
      </Button>
      {revoke.isError && <p role="alert" className="text-xs text-destructive">{copy.repairRevokeError}</p>}
    </div>
  );
}
