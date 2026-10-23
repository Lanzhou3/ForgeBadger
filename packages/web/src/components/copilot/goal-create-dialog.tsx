"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import { useGoalsCopy } from "./goals-copy";
import { createGoal, COPILOT_GOAL_GRANTS, type CopilotGoalGrant } from "@/lib/copilot-api";

interface GoalCreateDialogProps {
  open: boolean;
  conversationId: string;
  projectId?: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Create Goal" dialog reachable from the Copilot chat header. Submits the
 * goal against the current conversation, then navigates to the new goal's
 * detail page. Auto-grants live behind a collapsed advanced section.
 */
export function GoalCreateDialog({ open, conversationId, projectId, onOpenChange }: GoalCreateDialogProps) {
  const copy = useGoalsCopy();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState("");
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [grants, setGrants] = useState<CopilotGoalGrant[]>([]);

  const toggleGrant = (grant: CopilotGoalGrant, checked: boolean) => {
    setGrants((current) => checked ? [...new Set([...current, grant])] : current.filter((entry) => entry !== grant));
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createGoal({
        conversationId,
        ...(projectId ? { projectId } : {}),
        title: title.trim(),
        spec: spec.trim(),
        ...(grants.length > 0 ? { grants } : {}),
      }),
    onSuccess: ({ goalId }) => {
      onOpenChange(false);
      setTitle("");
      setSpec("");
      setGrants([]);
      router.push(`/copilot/goals/${encodeURIComponent(goalId)}`);
    },
  });

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
