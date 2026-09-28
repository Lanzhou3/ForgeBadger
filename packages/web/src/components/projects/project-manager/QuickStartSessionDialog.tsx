"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CliBrandIcon } from "@/components/cli-brand-icon";
import {
  chooseDefaultRuntimeAdapter,
  discoverAdapters,
  isAdapterLaunchable,
  type AdapterDiscovery,
  type ProjectManagerTaskPacket,
  type ProjectManagerWorkItem,
  type RuntimeAdapterId,
} from "@/lib/api";
import { runtimeAdapterLabel } from "@/lib/cli-brand";
import type { Translate } from "./types";

/**
 * Asks which Code CLI should execute the selected work item's task packet
 * before creating the session. Defaults to the packet's project-preferred
 * adapter when it is launchable.
 */
export function QuickStartSessionDialog({
  error,
  isStarting,
  item,
  onConfirm,
  onOpenChange,
  t,
  taskPacket,
}: {
  error: string | null;
  isStarting: boolean;
  item: ProjectManagerWorkItem | null;
  onConfirm: (aiTool: RuntimeAdapterId) => void;
  onOpenChange: (open: boolean) => void;
  t: Translate;
  taskPacket: ProjectManagerTaskPacket | null;
}) {
  const adaptersQuery = useQuery({
    queryKey: ["adapter-discovery"],
    queryFn: discoverAdapters,
    enabled: !!item,
    staleTime: 30_000,
  });
  const adapters = useMemo(
    () => adaptersQuery.data?.adapters ?? [],
    [adaptersQuery.data?.adapters]
  );
  const [selectedAdapter, setSelectedAdapter] = useState<RuntimeAdapterId | "">("");

  useEffect(() => {
    if (!item) return;
    const preferred = taskPacket?.runtime.adapter ?? null;
    setSelectedAdapter(chooseDefaultRuntimeAdapter(adapters, preferred) ?? "");
  }, [adapters, item, taskPacket?.runtime.adapter]);

  const launchableAdapters = adapters.filter((adapter) => isAdapterLaunchable(adapter));
  const hasSelection = selectedAdapter !== "" &&
    launchableAdapters.some((adapter) => adapter.id === selectedAdapter);

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("projects.projectManagerTaskPacketSelectCli")}</DialogTitle>
          <DialogDescription>
            {t("projects.projectManagerTaskPacketSelectCliDescription")}
          </DialogDescription>
        </DialogHeader>
        {item && (
          <div className="space-y-3">
            <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm font-medium break-words">
              {item.title}
            </div>
            {adaptersQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("projects.loadingRuntimeCli")}</p>
            ) : launchableAdapters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("projects.projectManagerTaskPacketNoCliAvailable")}
              </p>
            ) : (
              <fieldset className="space-y-2" disabled={isStarting}>
                <legend className="sr-only">{t("projects.selectRuntimeCli")}</legend>
                {launchableAdapters.map((adapter) => (
                  <AdapterOption
                    key={adapter.id}
                    adapter={adapter}
                    checked={selectedAdapter === adapter.id}
                    disabled={isStarting}
                    label={runtimeAdapterLabel(adapter, t)}
                    onSelect={() => setSelectedAdapter(adapter.id)}
                  />
                ))}
              </fieldset>
            )}
            {error && (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isStarting}>
            {t("projects.projectManagerCancel")}
          </Button>
          <Button
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={() => selectedAdapter && onConfirm(selectedAdapter as RuntimeAdapterId)}
            disabled={isStarting || !hasSelection}
          >
            {isStarting
              ? t("projects.projectManagerTaskPacketStarting")
              : t("projects.projectManagerTaskPacketStart")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdapterOption({
  adapter,
  checked,
  disabled,
  label,
  onSelect,
}: {
  adapter: AdapterDiscovery;
  checked: boolean;
  disabled: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={cnAdapterOption(checked)}
      data-testid={`quick-start-cli-option-${adapter.id}`}
    >
      <input
        type="radio"
        name="project-manager-quick-start-adapter"
        className="size-4 shrink-0 accent-brand"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      <CliBrandIcon aiTool={adapter.id} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {adapter.version ?? ""}
      </span>
    </label>
  );
}

function cnAdapterOption(checked: boolean): string {
  return [
    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors",
    checked
      ? "border-brand/50 bg-brand/5"
      : "border-border/70 bg-background hover:border-border",
    "disabled:cursor-not-allowed disabled:opacity-60",
  ].join(" ");
}
