"use client";

import { FolderOpen } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/hooks/use-language";
import type { Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CopilotStatusBar, copilotContextTriggerClassName } from "./copilot-runtime-panel";
import { CopilotRepairControl } from "./CopilotRepairControl";

const NO_PROJECT_VALUE = "__no_project__";

interface Props {
  projects: Project[];
  projectId: string;
  conversationId: string | null;
  onProjectChange: (id: string) => void;
  onModelChange: (id: string | null) => void;
  onSavingChange: (saving: boolean) => void;
  disabled: boolean;
  showRuntimeBadge?: boolean;
}

/** Shared external controls keep configuration separate from message composition. */
export function CopilotComposerToolbar({ projects, projectId, conversationId, onProjectChange,
  onModelChange, onSavingChange, disabled, showRuntimeBadge }: Props) {
  const { t } = useLanguage();
  const projectName = projects.find((project) => project.id === projectId)?.name ?? t("copilot.noProject");
  return (
    <div role="group" aria-label={t("copilot.runOptions")} data-testid="copilot-context-toolbar"
      className="flex min-w-0 flex-wrap items-center gap-1.5 pb-2">
      <Select value={projectId || NO_PROJECT_VALUE} disabled={disabled}
        onValueChange={(next) => onProjectChange(next === NO_PROJECT_VALUE ? "" : next)}>
        <SelectTrigger aria-label={t("copilot.projectContext")} title={projectName} size="sm"
          className={cn(copilotContextTriggerClassName, "min-w-0 max-w-32")}>
          <FolderOpen aria-hidden="true" className="size-3" />
          <SelectValue className="min-w-0 truncate" placeholder={t("copilot.noProject")} />
        </SelectTrigger>
        <SelectContent side="top" align="start" className="max-w-[calc(100vw-1.5rem)]">
          <SelectGroup>
            <SelectItem value={NO_PROJECT_VALUE}>{t("copilot.noProject")}</SelectItem>
            {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      <CopilotStatusBar variant="compact" showRuntimeBadge={showRuntimeBadge} onModelChange={onModelChange}
        onSavingChange={onSavingChange} controlsDisabled={disabled} />
      {conversationId && <CopilotRepairControl key={conversationId} conversationId={conversationId} />}
    </div>
  );
}
