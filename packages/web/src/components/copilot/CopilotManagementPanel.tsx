"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSettingsCopy } from "./settings-copy";
import {
  getProjectOverview,
  setCopilotAutonomy,
  updateProjectManagement,
  type ManagedProject,
} from "@/lib/platform-actions-api";

/**
 * Chat-sheet management surface: per-project Copilot autonomy switches
 * plus the per-project management progress view.
 */
export function CopilotManagementPanel() {
  const copy = useSettingsCopy();
  const overview = useQuery({
    queryKey: ["project-management-overview"],
    queryFn: () => getProjectOverview(),
    refetchInterval: 30000,
  });
  return (
    <div className="space-y-6 p-4 text-sm">
      <section className="space-y-3">
        <h2 className="font-semibold">{copy.mgmtTitle}</h2>
        <p className="text-xs text-muted-foreground">
          {copy.mgmtDescription}
        </p>
        {overview.isPending && <p role="status">{copy.projectsLoading}</p>}
        {overview.isError && (
          <p role="alert">
            {copy.mgmtLoadFailed}{" "}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void overview.refetch()}
            >
              {copy.autonomyRetry}
            </Button>
          </p>
        )}
        {overview.data?.projects.length === 0 && (
          <p className="text-muted-foreground">
            {copy.mgmtNoProjects}
          </p>
        )}
        {overview.data?.projects.map((project) => (
          <AutonomyRow key={`autonomy-${project.id}`} project={project} />
        ))}
      </section>
      <ManagementSection overview={overview} />
    </div>
  );
}

function AutonomyRow({ project }: { project: ManagedProject }) {
  const copy = useSettingsCopy();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => setCopilotAutonomy(project.id, enabled),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["project-management-overview"] }),
  });
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 p-3">
      <div className="min-w-0">
        <a
          className="font-medium hover:underline"
          href={`/projects/${project.id}`}
        >
          {project.name}
        </a>
        <p className="text-xs text-muted-foreground">
          {project.copilotAutonomy ? copy.mgmtAutonomyOn : copy.mgmtAutonomyOff}
          {mutation.isError ? ` · ${copy.mgmtSaveFailed(mutation.error.message)}` : ""}
        </p>
      </div>
      <Switch
        checked={project.copilotAutonomy}
        onCheckedChange={(value) => mutation.mutate(value)}
        disabled={mutation.isPending}
        aria-label={copy.mgmtSwitchAria(project.name)}
      />
    </div>
  );
}

type OverviewQuery = ReturnType<typeof useProjectOverview>;

function useProjectOverview() {
  return useQuery({
    queryKey: ["project-management-overview"],
    queryFn: () => getProjectOverview(),
    refetchInterval: 30000,
  });
}

function ManagementSection({ overview }: { overview: OverviewQuery }) {
  const copy = useSettingsCopy();
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">{copy.mgmtProgressTitle}</h2>
      <p className="text-xs text-muted-foreground">
        {copy.mgmtProgressDescription}
      </p>
      {overview.data?.projects.map((project) => (
        <ManagementRow
          key={`${project.id}-${project.management.revision}`}
          project={project}
        />
      ))}
    </section>
  );
}

function ManagementRow({ project }: { project: ManagedProject }) {
  const copy = useSettingsCopy();
  const client = useQueryClient();
  const [form, setForm] = useState(project.management);
  const mutation = useMutation({
    mutationFn: () =>
      updateProjectManagement(project.id, {
        mode: form.mode,
        ownerLabel: form.ownerLabel,
        nextAction: form.nextAction,
        freshnessHours: form.freshnessHours,
        expectedRevision: project.management.revision,
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["project-management-overview"] }),
  });
  return (
    <div className="rounded-md border border-border/70 p-3 space-y-2">
      <div className="flex justify-between gap-2">
        <a
          className="font-medium hover:underline"
          href={`/projects/${project.id}`}
        >
          {project.name}
        </a>
        <span className="text-xs">
          {project.management.mode === "manual" ? copy.mgmtModeManual : copy.mgmtModeCli}{" · "}
          {project.autonomy === "supervised" ? copy.mgmtSupervised : copy.mgmtManualExec}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {project.goal?.summary || copy.mgmtNoGoal}
      </p>
      <p className="text-xs">
        {copy.mgmtProgressSummary(project.counts.done, project.counts.total, project.counts.in_progress, project.counts.blocked)}
        {copy.mgmtEvidenceFreshness[project.evidenceFreshness.status] ?? project.evidenceFreshness.status}
      </p>
      <details>
        <summary className="cursor-pointer text-xs">
          {copy.mgmtOwnerNextSummary}{project.management.ownerLabel || copy.mgmtUnassigned} ·{" "}
          {project.management.nextAction || copy.mgmtUnplanned}
        </summary>
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <label className="block">
            {copy.mgmtModeLabel}
            <select
              className="ml-2 rounded border border-border bg-background p-1"
              value={form.mode}
              onChange={(e) =>
                setForm({ ...form, mode: e.target.value as "manual" | "cli" })
              }
            >
              <option value="manual">{copy.mgmtModeOptionManual}</option>
              <option value="cli">{copy.mgmtModeOptionCli}</option>
            </select>
          </label>
          <label className="block">
            {copy.mgmtOwnerLabel}
            <Input
              value={form.ownerLabel}
              onChange={(e) => setForm({ ...form, ownerLabel: e.target.value })}
            />
          </label>
          <label className="block">
            {copy.mgmtNextActionLabel}
            <Input
              value={form.nextAction}
              onChange={(e) => setForm({ ...form, nextAction: e.target.value })}
            />
          </label>
          <label className="block">
            {copy.mgmtFreshnessLabel}
            <Input
              type="number"
              min="1"
              max="8760"
              value={form.freshnessHours}
              onChange={(e) =>
                setForm({ ...form, freshnessHours: Number(e.target.value) })
              }
            />
          </label>
          {mutation.isError && (
            <p role="alert" className="text-destructive">
              {copy.mgmtSaveFailed(mutation.error.message)}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void client.invalidateQueries({
                    queryKey: ["project-management-overview"],
                  })
                }
              >
                {copy.mgmtReload}
              </Button>
            </p>
          )}
          <Button size="sm" disabled={mutation.isPending}>
            {copy.mgmtSave}
          </Button>
        </form>
      </details>
    </div>
  );
}
