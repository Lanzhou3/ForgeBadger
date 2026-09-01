"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { CliBrandChip } from "@/components/cli-brand-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/hooks/use-language";
import {
  createSession,
  discoverAdapters,
  type RuntimeAdapterId,
  type Session,
} from "@/lib/api";

interface SessionLaunchDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (session: Session) => void;
  initialAdapter?: RuntimeAdapterId;
}

export function SessionLaunchDialog({ projectId, open, onOpenChange, onCreated, initialAdapter }: SessionLaunchDialogProps) {
  const { t } = useLanguage();
  const [adapter, setAdapter] = useState<RuntimeAdapterId>(initialAdapter ?? "claude");
  const discoveryQuery = useQuery({ queryKey: ["adapters", "discovery"], queryFn: discoverAdapters, enabled: open });

  const launchableAdapters = useMemo(
    () => (discoveryQuery.data?.adapters ?? []).filter((entry) => entry.available && entry.launchEnabled && entry.runtimeModes.includes("terminal")),
    [discoveryQuery.data?.adapters]
  );

  useEffect(() => {
    if (!open) return;
    const next = initialAdapter && launchableAdapters.some((entry) => entry.id === initialAdapter)
      ? initialAdapter
      : launchableAdapters[0]?.id as RuntimeAdapterId | undefined;
    if (next) setAdapter(next);
  }, [initialAdapter, launchableAdapters, open]);

  const createMutation = useMutation({
    mutationFn: () => createSession({ projectId, aiTool: adapter }),
    onSuccess: ({ session }) => {
      onOpenChange(false);
      onCreated(session);
    },
  });

  const loading = discoveryQuery.isLoading;
  const error = discoveryQuery.error ?? createMutation.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("projects.newSession")}</DialogTitle>
          <DialogDescription>{t("projects.launchSessionDescription")}</DialogDescription>
        </DialogHeader>
        {loading ? <p className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</p> : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="launch-adapter">{t("common.aiTool")}</Label>
              <select id="launch-adapter" aria-label={t("common.aiTool")} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={adapter} onChange={(event) => setAdapter(event.target.value as RuntimeAdapterId)}>
                {launchableAdapters.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <CliBrandChip aiTool={adapter} />
              <span className="ml-2">{t("projects.hostEnvironmentHint")}</span>
            </div>
          </div>
        )}
        {error instanceof Error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button type="button" disabled={loading || launchableAdapters.length === 0 || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? t("projects.creating") : t("projects.newSession")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
