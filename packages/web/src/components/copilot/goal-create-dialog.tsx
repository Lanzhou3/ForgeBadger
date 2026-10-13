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
 * detail page. Budgets live behind a collapsed advanced section.
 */
export function GoalCreateDialog({ open, conversationId, projectId, onOpenChange }: GoalCreateDialogProps) {
  const copy = useGoalsCopy();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState("");
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [tokenBudget, setTokenBudget] = useState("");
  const [maxDurationMin, setMaxDurationMin] = useState("");
  const [maxRuns, setMaxRuns] = useState("");
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
        budgets: {
          ...(tokenBudget.trim() ? { tokenBudget: Number(tokenBudget) } : {}),
          ...(maxDurationMin.trim() ? { maxDurationMs: Number(maxDurationMin) * 60_000 } : {}),
          ...(maxRuns.trim() ? { maxRuns: Number(maxRuns) } : {}),
        },
        ...(grants.length > 0 ? { grants } : {}),
      }),
    onSuccess: ({ goalId }) => {
      onOpenChange(false);
      setTitle("");
      setSpec("");
      setTokenBudget("");
      setMaxDurationMin("");
      setMaxRuns("");
      setGrants([]);
      router.push(`/copilot/goals/${encodeURIComponent(goalId)}`);
    },
  });

  const budgetFieldError = (raw: string, max: number, maxKey: "tokenMax" | "durationMax" | "runsMax"): string | null => {
    const text = raw.trim();
    if (!text) return null;
    const value = Number(text);
    if (!Number.isInteger(value) || value <= 0) return copy.budgetErrors.integer!;
    if (value > max) return copy.budgetErrors[maxKey]!;
    return null;
  };
  const tokenBudgetError = budgetFieldError(tokenBudget, 50_000_000, "tokenMax");
  const maxDurationError = budgetFieldError(maxDurationMin, 1440, "durationMax");
  const maxRunsError = budgetFieldError(maxRuns, 200, "runsMax");
  const budgetValid = !tokenBudgetError && !maxDurationError && !maxRunsError;

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
              aria-expanded={budgetsOpen}
              onClick={() => setBudgetsOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted/60"
            >
              {budgetsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {copy.budgets}
            </button>
            {budgetsOpen ? (
              <div className="space-y-3 border-t border-border/70 px-3 py-3">
                <p className="text-xs text-muted-foreground">{copy.budgetsHint}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="goal-token-budget" className="text-xs">{copy.tokenBudget}</Label>
                    <Input
                      id="goal-token-budget"
                      inputMode="numeric"
                      value={tokenBudget}
                      onChange={(event) => setTokenBudget(event.target.value)}
                      aria-invalid={Boolean(tokenBudgetError)}
                    />
                    {tokenBudgetError ? <p role="alert" className="text-xs text-destructive">{tokenBudgetError}</p> : null}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="goal-max-duration" className="text-xs">{copy.maxDuration}</Label>
                    <Input
                      id="goal-max-duration"
                      inputMode="numeric"
                      value={maxDurationMin}
                      onChange={(event) => setMaxDurationMin(event.target.value)}
                      aria-invalid={Boolean(maxDurationError)}
                    />
                    {maxDurationError ? <p role="alert" className="text-xs text-destructive">{maxDurationError}</p> : null}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="goal-max-runs" className="text-xs">{copy.maxRuns}</Label>
                    <Input
                      id="goal-max-runs"
                      inputMode="numeric"
                      value={maxRuns}
                      onChange={(event) => setMaxRuns(event.target.value)}
                      aria-invalid={Boolean(maxRunsError)}
                    />
                    {maxRunsError ? <p role="alert" className="text-xs text-destructive">{maxRunsError}</p> : null}
                  </div>
                </div>
                <div className="space-y-2 border-t border-border/70 pt-3">
                  <p className="text-xs font-medium">{copy.grantsTitle}</p>
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
            disabled={createMutation.isPending || !title.trim() || !spec.trim() || !budgetValid}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? copy.loading : copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
