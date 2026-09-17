"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { deleteMemoryEntry, listMemoryEntries } from "@/lib/copilot-api";

export const memoryQueryKey = ["copilot", "memory"] as const;

const scopeLabels: Record<string, string> = {
  global: "global",
  project: "project",
  session: "session",
};

const kindLabels: Record<string, string> = {
  fact: "fact",
  preference: "preference",
  decision: "decision",
  project_note: "project_note",
};

/**
 * Copilot memory panel — a read-only, global-scoped view of what the Copilot
 * has remembered, with per-entry deletion. Writing is left to the model's
 * `write_memory` tool; this surface is for the owner to review and prune.
 */
export function CopilotMemoryPanel() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const memory = useQuery({
    queryKey: memoryQueryKey,
    queryFn: () => listMemoryEntries({ scope: "global" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMemoryEntry(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memoryQueryKey });
    },
  });

  const entries = memory.data?.entries ?? [];

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{t("copilot.memoryTitle")}</p>
        <Badge variant="secondary" className="shrink-0">
          {String(entries.length)}
        </Badge>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("copilot.memoryDescription")}
      </p>
      {memory.isPending ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("copilot.memoryEmpty")}</p>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-card px-3 py-2"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">
                    {scopeLabels[entry.scope] ?? entry.scope}
                  </Badge>
                  <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">
                    {kindLabels[entry.kind] ?? entry.kind}
                  </Badge>
                </p>
                <p className="break-words text-xs leading-relaxed text-muted-foreground">{entry.text}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-destructive"
                aria-label={t("common.delete")}
                title={t("common.delete")}
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(entry.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
