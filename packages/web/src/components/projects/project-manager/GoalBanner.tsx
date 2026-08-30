import { Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectManagerGoal } from "@/lib/api";
import type { GoalDraft, Translate } from "./types";
import { formatTimestamp, statusLabel } from "./utils";

export function ProjectManagerGoalBanner({
  goal,
  t,
  draft,
  error,
  isEditing,
  isSaving,
  onCancel,
  onDraftChange,
  onEdit,
  onSave,
}: {
  goal: ProjectManagerGoal | null;
  t: Translate;
  draft: GoalDraft;
  error: string | null;
  isEditing: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onDraftChange: (draft: GoalDraft) => void;
  onEdit: () => void;
  onSave: () => void;
}) {
  if (isEditing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Target className="size-4 text-brand" />
            {t("projects.projectManagerGoal")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-manager-goal-summary">{t("projects.projectManagerGoalSummary")}</Label>
            <Input
              id="project-manager-goal-summary"
              value={draft.summary}
              aria-invalid={!!error && draft.summary.trim().length === 0}
              disabled={isSaving}
              onChange={(event) => onDraftChange({ ...draft, summary: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-manager-goal-constraints">
              {t("projects.projectManagerConstraints")}
            </Label>
            <Textarea
              id="project-manager-goal-constraints"
              value={draft.constraintsText}
              disabled={isSaving}
              placeholder={t("projects.projectManagerTextListHint")}
              onChange={(event) => onDraftChange({ ...draft, constraintsText: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t("projects.projectManagerTextListHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-manager-goal-acceptance">
              {t("projects.projectManagerAcceptanceCriteria")}
            </Label>
            <Textarea
              id="project-manager-goal-acceptance"
              value={draft.acceptanceCriteriaText}
              disabled={isSaving}
              placeholder={t("projects.projectManagerTextListHint")}
              onChange={(event) => onDraftChange({ ...draft, acceptanceCriteriaText: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t("projects.projectManagerTextListHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-manager-goal-status">{t("projects.projectManagerGoalStatus")}</Label>
            <Input
              id="project-manager-goal-status"
              value={draft.status}
              disabled={isSaving}
              onChange={(event) => onDraftChange({ ...draft, status: event.target.value })}
            />
          </div>
          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onCancel} disabled={isSaving}>
              {t("projects.projectManagerCancel")}
            </Button>
            <Button
              className="bg-brand text-brand-foreground hover:bg-brand/90"
              onClick={onSave}
              disabled={isSaving}
            >
              {t("projects.projectManagerSaveGoal")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!goal) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Target className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{t("projects.projectManagerNoGoalTitle")}</div>
              <p className="text-xs text-muted-foreground">{t("projects.projectManagerNoGoalBody")}</p>
            </div>
          </div>
          <Button
            size="sm"
            className="shrink-0 bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={onEdit}
          >
            {t("projects.projectManagerEditGoal")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <Target className="size-4" />
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-medium" title={goal.summary}>
            {goal.summary}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{statusLabel(goal.status, t)}</Badge>
          <span className="rounded border border-border/70 bg-muted/20 px-2 py-0.5 text-xs text-muted-foreground">
            {t("projects.projectManagerConstraints")} · {goal.constraints.length}
          </span>
          <span className="rounded border border-border/70 bg-muted/20 px-2 py-0.5 text-xs text-muted-foreground">
            {t("projects.projectManagerAcceptanceCriteria")} · {goal.acceptanceCriteria.length}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("projects.projectManagerUpdated")}: {formatTimestamp(goal.updatedAt)}
          </span>
          <Button size="sm" variant="outline" onClick={onEdit}>
            {t("projects.projectManagerEditGoal")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
