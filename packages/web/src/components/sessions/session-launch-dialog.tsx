"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, FolderOpen, Terminal } from "lucide-react";

import { AdapterSelect, ADAPTER_DISCOVERY_QUERY_KEY } from "@/components/adapter-select";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export interface LaunchableProjectOption {
  id: string;
  name: string;
  path?: string | null;
}

interface SessionLaunchDialogProps {
  projectId?: string;
  projectName?: string;
  projects?: readonly LaunchableProjectOption[];
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

export function SessionLaunchDialog({
  projectId,
  projectName,
  projects,
  open,
  onOpenChange,
  onCreated,
  initialAdapter,
}: SessionLaunchDialogProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<LaunchMode>("cli");
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectId ?? projects?.[0]?.id ?? "");
  const [adapter, setAdapter] = useState<RuntimeAdapterId | "">(initialAdapter ?? "");
  const [shell, setShell] = useState<TerminalShell>(() =>
    defaultTerminalShellForPlatform(isWindowsPlatform())
  );
  const effectiveProjectId = projectId ?? selectedProjectId;
  const resolvedProjectName = useMemo(
    () => projectName ?? projects?.find((entry) => entry.id === effectiveProjectId)?.name,
    [effectiveProjectId, projectName, projects]
  );

  useEffect(() => {
    if (!open) return;
    if (projectId) {
      setSelectedProjectId(projectId);
      return;
    }
    if (projects && projects.length > 0 && !projects.some((entry) => entry.id === selectedProjectId)) {
      setSelectedProjectId(projects[0]!.id);
    }
  }, [open, projectId, projects, selectedProjectId]);
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
    mutationFn: () => {
      if (!effectiveProjectId) {
        return Promise.reject(new Error("No project selected"));
      }
      return mode === "terminal"
        ? createSession({ projectId: effectiveProjectId, aiTool: "terminal", shell })
        : adapter
          ? createSession({ projectId: effectiveProjectId, aiTool: adapter })
          : Promise.reject(new Error("No CLI selected"));
    },
    onSuccess: ({ session }) => {
      onOpenChange(false);
      onCreated(session);
    },
  });

  const loading = discoveryQuery.isLoading;
  const error = discoveryQuery.error ?? createMutation.error;
  const cliDisabled = loading || launchableAdapters.length === 0;
  const showProjectPicker = !projectId && Boolean(projects && projects.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{t("projects.newSession")}</DialogTitle>
            {!showProjectPicker && resolvedProjectName ? (
              <span className="inline-flex max-w-60 items-center gap-1.5 truncate rounded-full border border-border/70 bg-muted/40 px-2.5 py-0.5 text-xs font-normal text-muted-foreground">
                <FolderOpen className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{resolvedProjectName}</span>
              </span>
            ) : null}
          </div>
          <DialogDescription>
            {mode === "terminal" ? t("projects.launchTerminalDescription") : t("projects.launchSessionDescription")}
          </DialogDescription>
        </DialogHeader>
        {loading ? <p className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</p> : (
          <div className="space-y-4">
            {showProjectPicker && projects ? (
              <div className="space-y-2">
                <Label htmlFor="launch-project">{t("sessions.project")}</Label>
                <Select value={effectiveProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger id="launch-project" aria-label={t("sessions.project")} className="h-10 w-full">
                    <SelectValue placeholder={t("sessions.chooseProjectTitle")} />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        <span className="flex min-w-0 items-center gap-2">
                          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate font-medium">{project.name}</span>
                          {project.path ? (
                            <span className="hidden max-w-52 truncate font-mono text-xs text-muted-foreground sm:inline">
                              {project.path}
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div role="group" aria-label={t("projects.newSession")} className="grid grid-cols-2 gap-1 rounded-lg border border-border/70 bg-muted/40 p-1">
              <button
                type="button"
                aria-pressed={mode === "cli"}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow] hover:text-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => setMode("cli")}
              >
                {t("common.aiTool")}
              </button>
              <button
                type="button"
                aria-pressed={mode === "terminal"}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow] hover:text-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                  <CliBrandChip aiTool={adapter} />
                  <span className="min-w-0 flex-1">{t("projects.hostEnvironmentHint")}</span>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="launch-shell">{t("projects.terminalShell")}</Label>
                <div className="relative">
                  <Terminal className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <select
                    id="launch-shell"
                    className="h-10 w-full appearance-none rounded-md border border-input bg-control pl-9 pr-9 text-sm text-foreground shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-control dark:hover:bg-control-hover"
                    value={shell}
                    onChange={(e) => setShell(e.target.value as TerminalShell)}
                  >
                    {shellOptions.map((option) => (
                      <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground opacity-60" aria-hidden="true" />
                </div>
              </div>
            )}
          </div>
        )}
        {error instanceof Error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            type="button"
            variant="brand"
            disabled={!effectiveProjectId || loading || (mode === "cli" && cliDisabled) ||
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
