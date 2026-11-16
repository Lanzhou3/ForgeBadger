"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Ship } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listProjects } from "@/lib/api";
import { COPILOT_GOAL_GRANTS, type CopilotGoalGrant } from "@/lib/copilot-api";
import { createFleet } from "@/lib/fleet-api";
import { useGoalsCopy } from "../copilot/goals-copy";
import { useFleetCopy } from "./fleet-copy";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Projects that already have a fleet; a project gets at most one. */
  takenProjectIds: string[];
}

/** "Set up a fleet for a project": project, optional title and standing instructions, and the same auto-grants a goal offers. */
export function FleetCreateDialog({ open, onOpenChange, takenProjectIds }: Props) {
  const copy = useFleetCopy();
  const goals = useGoalsCopy();
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [grants, setGrants] = useState<CopilotGoalGrant[]>([]);
  const projects = useQuery({ queryKey: ["projects"], queryFn: listProjects, enabled: open });
  const available = (projects.data?.projects ?? []).filter((project) => !takenProjectIds.includes(project.id));

  const mutation = useMutation({
    mutationFn: () =>
      createFleet({
        projectId,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(grants.length > 0 ? { grants } : {}),
      }),
    onSuccess: ({ fleet }) => {
      onOpenChange(false);
      setProjectId("");
      setTitle("");
      setInstructions("");
      setGrants([]);
      router.push(`/fleet/${encodeURIComponent(fleet.id)}`);
    },
  });
  const toggleGrant = (grant: CopilotGoalGrant, checked: boolean) =>
    setGrants((current) => (checked ? [...new Set([...current, grant])] : current.filter((entry) => entry !== grant)));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Ship className="size-5 shrink-0 text-brand" aria-hidden />
            {copy.createFleet}
          </DialogTitle>
          <DialogDescription>{copy.createDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fleet-project">{copy.project}</Label>
            <select
              id="fleet-project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">{copy.projectPlaceholder}</option>
              {available.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            {projects.isError ? <p role="alert" className="text-xs text-destructive">{copy.projectsFailed}</p> : null}
            {projects.isSuccess && available.length === 0 ? <p className="text-xs text-muted-foreground">{copy.noProjects}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fleet-title">{copy.titleLabel}</Label>
            <Input id="fleet-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            <p className="text-xs text-muted-foreground">{copy.titleHint}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fleet-instructions">{copy.instructionsLabel}</Label>
            <Textarea id="fleet-instructions" rows={4} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
            <p className="text-xs text-muted-foreground">{copy.instructionsHint}</p>
          </div>
          <div className="rounded-md border border-border/70">
            <button
              type="button"
              aria-expanded={grantsOpen}
              onClick={() => setGrantsOpen((value) => !value)}
              className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted/60"
            >
              {grantsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {copy.grantsTitle}
            </button>
            {grantsOpen ? (
              <div className="space-y-2 border-t border-border/70 px-3 py-3">
                <p className="text-xs text-muted-foreground">{copy.grantsHint}</p>
                <div className="flex flex-wrap gap-3">
                  {COPILOT_GOAL_GRANTS.map((grant) => (
                    <label key={grant} className="flex cursor-pointer items-center gap-1.5 text-xs" title={goals.grantTooltips[grant]}>
                      <Checkbox checked={grants.includes(grant)} onCheckedChange={(checked) => toggleGrant(grant, checked === true)} aria-label={goals.grantLabels[grant]} />
                      {goals.grantLabels[grant]}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          {mutation.isError ? (
            <p role="alert" className="text-sm text-destructive">{mutation.error instanceof Error && mutation.error.message ? mutation.error.message : copy.createFailed}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>{copy.cancel}</Button>
          <Button disabled={mutation.isPending || !projectId} onClick={() => mutation.mutate()}>
            {mutation.isPending ? copy.loading : copy.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
