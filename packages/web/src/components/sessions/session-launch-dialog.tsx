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
  listTerminalShells,
  type RuntimeAdapterId,
  type Session,
  type TerminalShell,
} from "@/lib/api";
import { useOrderedAdapters } from "@/lib/adapter-order";
import {
  defaultTerminalShellForPlatform,
  pickAvailableShell,
  platformShellOrder,
} from "@/lib/terminal-shells";

type LaunchMode = "cli" | "terminal";

interface SessionLaunchDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (session: Session) => void;
  initialAdapter?: RuntimeAdapterId;
}

const isWindowsPlatform = () =>
  typeof navigator !== "undefined" && navigator.platform?.startsWith("Win");

const TERMINAL_SHELLS_QUERY_KEY = ["terminal-shell-availability"] as const;

interface ShellOption {
  value: TerminalShell;
  label: string;
  disabled?: boolean;
}

export function SessionLaunchDialog({ projectId, open, onOpenChange, onCreated, initialAdapter }: SessionLaunchDialogProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<LaunchMode>("cli");
  const [adapter, setAdapter] = useState<RuntimeAdapterId>(initialAdapter ?? "claude");
  const [shell, setShell] = useState<TerminalShell>(() =>
    defaultTerminalShellForPlatform(isWindowsPlatform())
  );
  const discoveryQuery = useQuery({ queryKey: ADAPTER_DISCOVERY_QUERY_KEY, queryFn: discoverAdapters, enabled: open });
  // Probe which shells are actually installed so the default can fall back
  // (e.g. Windows without PowerShell 7 → Windows PowerShell 5.1) and missing
  // options can be greyed out. A failed probe just keeps the static default.
  const shellAvailability = useQuery({ queryKey: TERMINAL_SHELLS_QUERY_KEY, queryFn: listTerminalShells, enabled: open });
  const isWindows = shellAvailability.data
    ? shellAvailability.data.platform === "win32"
    : isWindowsPlatform();
  const shellOrder = useMemo(() => platformShellOrder(isWindows), [isWindows]);

  useEffect(() => {
    if (!open) return;
    const data = shellAvailability.data;
    const installed = data
      ? data.shells.filter((entry) => entry.available).map((entry) => entry.shell)
      : null;
    setShell((current) => pickAvailableShell(current, shellOrder, installed));
  }, [open, shellAvailability.data, shellOrder]);

  // Offer shells for the Gateway host, including when it runs inside WSL.
  // Only offer shells that can plausibly exist on this platform — zsh/bash
  // never show up on Windows, pwsh/cmd never on POSIX. The availability probe
  // below additionally greys out platform-plausible shells that are missing.
  const shellOptions = useMemo<ShellOption[]>(() => {
    const base: ShellOption[] = isWindows
      ? [
          { value: "pwsh", label: "pwsh (PowerShell 7+)" },
          { value: "powershell", label: "powershell (Windows PowerShell 5.1)" },
          { value: "cmd", label: "cmd.exe" }
        ]
      : [
          { value: "sh", label: t("projects.terminalShellSystem") },
          { value: "bash", label: "bash" },
          { value: "zsh", label: "zsh" }
        ];
    const probe = shellAvailability.data;
    return base.map((option) => {
      const missing = probe !== undefined &&
        !probe.shells.some((entry) => entry.shell === option.value && entry.available);
      return missing
        ? { ...option, label: option.label + t("projects.terminalShellNotInstalled"), disabled: true }
        : option;
    });
  }, [isWindows, t, shellAvailability.data]);

  const launchableAdapters = useMemo(
    () => (discoveryQuery.data?.adapters ?? []).filter((entry) => entry.available && entry.launchEnabled && entry.runtimeModes.includes("terminal")),
    [discoveryQuery.data?.adapters]
  );
  const orderedLaunchableAdapters = useOrderedAdapters(launchableAdapters);

  useEffect(() => {
    if (!open) return;
    const next = initialAdapter && orderedLaunchableAdapters.some((entry) => entry.id === initialAdapter)
      ? initialAdapter
      : orderedLaunchableAdapters[0]?.id as RuntimeAdapterId | undefined;
    if (next) setAdapter(next);
  }, [initialAdapter, orderedLaunchableAdapters, open]);

  const createMutation = useMutation({
    mutationFn: () =>
      mode === "terminal"
        ? createSession({ projectId, aiTool: "terminal", shell })
        : createSession({ projectId, aiTool: adapter }),
    onSuccess: ({ session }) => {
      onOpenChange(false);
      onCreated(session);
    },
  });

  const loading = discoveryQuery.isLoading;
  const error = discoveryQuery.error ?? createMutation.error;
  const cliDisabled = loading || launchableAdapters.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("projects.newSession")}</DialogTitle>
          <DialogDescription>
            {mode === "terminal" ? t("projects.launchTerminalDescription") : t("projects.launchSessionDescription")}
          </DialogDescription>
        </DialogHeader>
        {loading ? <p className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</p> : (
          <div className="space-y-4">
            <div className="flex gap-1 rounded-md border border-border/70 p-1">
              <button
                type="button"
                className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${mode === "cli" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                onClick={() => setMode("cli")}
              >
                {t("common.aiTool")}
              </button>
              <button
                type="button"
                className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${mode === "terminal" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                onClick={() => setMode("terminal")}
              >
                {t("projects.launchTerminalTab")}
              </button>
            </div>
            {mode === "cli" ? (
              <>
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
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="launch-shell">{t("projects.terminalShell")}</Label>
                <select
                  id="launch-shell"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  value={shell}
                  onChange={(e) => setShell(e.target.value as TerminalShell)}
                >
                  {shellOptions.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
        {error instanceof Error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            type="button"
            disabled={loading || (mode === "cli" && cliDisabled) ||
              (mode === "terminal" && (shellAvailability.isLoading ||
                !shellOptions.some((option) => option.value === shell && !option.disabled))) || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? t("projects.creating") : t("projects.newSession")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
