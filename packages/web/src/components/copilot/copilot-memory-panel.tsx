"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Search, Trash2 } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/hooks/use-language";
import { deleteMemoryEntry, listMemoryEntries } from "@/lib/copilot-api";
import { CopilotEmptyState } from "./copilot-empty-state";
import { CopilotStatusBadge, type CopilotStatusTone } from "./copilot-status-badge";
import { useSettingsCopy } from "./settings-copy";

export const memoryQueryKey = ["copilot", "memory"] as const;

/**
 * Copilot memory panel — a read-only, global-scoped view of what the Copilot
 * has remembered, with per-entry deletion. Writing is left to the model's
 * `write_memory` tool; this surface is for the owner to review and prune.
 */
export function CopilotMemoryPanel() {
  const { t } = useLanguage();
  const copy = useSettingsCopy();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");

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

  const scopeLabel = (scope: string) =>
    scope === "global" ? copy.memoryScopeGlobal : scope === "project" ? copy.memoryScopeProject : scope === "session" ? copy.memoryScopeSession : scope;
  const kindLabel = (kind: string) =>
    kind === "fact" ? copy.memoryKindFact
      : kind === "preference" ? copy.memoryKindPreference
        : kind === "decision" ? copy.memoryKindDecision
          : kind === "project_note" ? copy.memoryKindProjectNote
            : kind;
  const kindTone = (kind: string): CopilotStatusTone =>
    kind === "fact" ? "success" : kind === "decision" ? "warning" : "muted";

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? entries.filter((entry) =>
        `${entry.text} ${kindLabel(entry.kind)} ${scopeLabel(entry.scope)}`.toLowerCase().includes(normalized),
      )
    : entries;

  return (
    <Card className="forgebadger-animate-in" style={{ animationDelay: "220ms" }}>
      <SettingsCardHeader
        icon={<Brain className="size-4" />}
        title={t("copilot.memoryTitle")}
        description={t("copilot.memoryDescription")}
        action={<Badge variant="secondary" className="shrink-0 tabular-nums">{String(entries.length)}</Badge>}
      />
      <CardContent className="space-y-3">
        {memory.isPending ? (
          <div className="space-y-2" aria-busy="true" aria-label={t("common.loading")}>
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-14 animate-pulse rounded-md border border-border/50 bg-muted/40" />
            ))}
          </div>
        ) : memory.isError ? (
          <div role="alert">
            <CopilotEmptyState icon={Brain} title={t("copilot.loadError")} />
          </div>
        ) : entries.length === 0 ? (
          <CopilotEmptyState icon={Brain} title={t("copilot.memoryEmpty")} />
        ) : (
          <>
            {entries.length > 3 && (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("copilot.memorySearch")}
                  aria-label={t("copilot.memorySearch")}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            )}
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{t("copilot.memorySearchEmpty")}</p>
            ) : (
              <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {filtered.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-card px-3 py-2"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-1.5 text-xs">
                        <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">
                          {scopeLabel(entry.scope)}
                        </Badge>
                        <CopilotStatusBadge tone={kindTone(entry.kind)} className="px-1.5 py-0 text-[10px]">
                          {kindLabel(entry.kind)}
                        </CopilotStatusBadge>
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
          </>
        )}
        {deleteMutation.isError && <p role="alert" className="mt-2 text-xs text-destructive">{t("copilot.actionFailed")}</p>}
      </CardContent>
    </Card>
  );
}
