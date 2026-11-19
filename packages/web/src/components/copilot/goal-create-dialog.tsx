"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { listProjects } from "@/lib/api";
import {
  COPILOT_GOAL_GRANTS,
  createConversation,
  createGoal,
  type CopilotGoalGrant,
} from "@/lib/copilot-api";
import { useGoalsCopy } from "./goals-copy";

const NO_PROJECT_VALUE = "__none__";

interface GoalCreateDialogProps {
  open: boolean;
  /** Optional: when omitted (e.g. creating from /copilot/goals), a new conversation is created lazily before createGoal. */
  conversationId?: string | null;
  projectId?: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Create Goal" dialog reachable from the Copilot chat header or the Goals list.
 * Submits the goal against the current conversation (or creates one lazily),
 * then navigates to the new goal's detail page. Auto-grants live behind a
 * collapsed advanced section.
 */
export function GoalCreateDialog({ open, conversationId, projectId, onOpenChange }: GoalCreateDialogProps) {
  const copy = useGoalsCopy();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [grants, setGrants] = useState<CopilotGoalGrant[]>([]);

  const showProjectSelector = !conversationId && !projectId;
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
    enabled: open && showProjectSelector,
    retry: false,
  });

  const toggleGrant = (grant: CopilotGoalGrant, checked: boolean) => {
    setGrants((current) => checked ? [...new Set([...current, grant])] : current.filter((entry) => entry !== grant));
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = projectId ?? (selectedProjectId || undefined);
      let targetConversationId = conversationId || undefined;
      if (!targetConversationId) {
        const { conversation } = await createConversation(title.trim().slice(0, 24), resolvedProjectId);
        targetConversationId = conversation.id;
      }
      return createGoal({
        conversationId: targetConversationId,
        ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
        title: title.trim(),
        spec: spec.trim(),
        ...(grants.length > 0 ? { grants } : {}),
      });
    },
    onSuccess: ({ goalId }) => {
      void queryClient.invalidateQueries({ queryKey: ["copilot", "goals"] });
      onOpenChange(false);
      setTitle("");
      setSpec("");
      setSelectedProjectId("");
      setGrantsOpen(false);
      setGrants([]);
      router.push(`/copilot/goals/${encodeURIComponent(goalId)}`);
    },
  });

  const projects = projectsQuery.data?.projects ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Target className="size-5 shrink-0 text-brand" />
            {copy.createTitle}
          </DialogTitle>
          <DialogDescription>{copy.createDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="goal-title">{copy.goalTitle}</Label>
            <Input
              id="goal-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-spec">{copy.goalSpec}</Label>
            <Textarea
              id="goal-spec"
              value={spec}
              onChange={(event) => setSpec(event.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">{copy.goalSpecHint}</p>
          </div>
          {showProjectSelector ? (
            <div className="space-y-2">
              <Label htmlFor="goal-project">{copy.projectLabel}</Label>
              <Select
                value={selectedProjectId || NO_PROJECT_VALUE}
                onValueChange={(value) => setSelectedProjectId(value === NO_PROJECT_VALUE ? "" : value)}
              >
                <SelectTrigger id="goal-project" aria-label={copy.projectLabel} className="w-full">
                  <SelectValue placeholder={copy.projectNone} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT_VALUE}>{copy.projectNone}</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{copy.projectHint}</p>
            </div>
          ) : null}
          <div className="rounded-md border border-border/70">
            <button
              type="button"
              aria-expanded={grantsOpen}
              onClick={() => setGrantsOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted/60"
            >
              {grantsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {copy.grantsTitle}
            </button>
            <div className="forgebadger-collapse-grid" data-open={grantsOpen ? "true" : "false"}>
              <div className="overflow-hidden">
                {grantsOpen ? (
                  <div className="space-y-2 border-t border-border/70 px-3 py-3">
                    <p className="text-xs text-muted-foreground">{copy.grantsHint}</p>
                    <div className="flex flex-wrap gap-3">
                      {COPILOT_GOAL_GRANTS.map((grant) => (
                        <label key={grant} className="flex cursor-pointer items-center gap-1.5 text-xs" title={copy.grantTooltips[grant]}>
                          <Checkbox
                            checked={grants.includes(grant)}
                            onCheckedChange={(checked) => toggleGrant(grant, checked === true)}
                            aria-label={copy.grantLabels[grant]}
                          />
                          {copy.grantLabels[grant]}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          {createMutation.isError ? (
            <p role="alert" className="text-sm text-destructive">{copy.createFailed}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {copy.cancel}
          </Button>
          <Button
            disabled={createMutation.isPending || !title.trim() || !spec.trim()}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? copy.loading : copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
