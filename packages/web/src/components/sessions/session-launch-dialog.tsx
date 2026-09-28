"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { AdapterSelect, ADAPTER_DISCOVERY_QUERY_KEY } from "@/components/adapter-select";
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
  const discoveryQuery = useQuery({ queryKey: ADAPTER_DISCOVERY_QUERY_KEY, queryFn: discoverAdapters, enabled: open });

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
              <AdapterSelect
                id="launch-adapter"
                ariaLabel={t("common.aiTool")}
                className="h-10 w-full"
                value={adapter}
                onValueChange={setAdapter}
                placeholder={t("common.loading")}
              />
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
