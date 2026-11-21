"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/hooks/use-language";
import { deleteProjectManagerGoal, updateProjectManagerGoal, type ProjectManagerGoal } from "@/lib/api";
import { toast } from "@/lib/toast";

interface ProjectGoalEditorProps {
  projectId: string;
  goal: ProjectManagerGoal | null;
  canManage: boolean;
  heading: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function ProjectGoalEditor({ projectId, goal, canManage, heading, actions, children }: ProjectGoalEditorProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const summaryId = useId();
  const editing = canManage && draft !== null;

  const invalidateGoal = () => queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "goal"] });
  function closeEditor() {
    setDraft(null);
    requestAnimationFrame(() => editRef.current?.focus());
  }
  function closeConfirmation() {
    setConfirmClear(false);
    requestAnimationFrame(() => editRef.current?.focus());
  }

  const save = useMutation({
    mutationFn: (summary: string) => updateProjectManagerGoal(projectId, {
      summary,
      constraints: goal?.constraints ?? [],
      acceptanceCriteria: goal?.acceptanceCriteria ?? [],
      status: goal?.status ?? "active",
    }),
    onSuccess: async () => { await invalidateGoal(); closeEditor(); },
    onError: () => toast.error(t("projects.projectManagerGoalMutationError")),
  });
  const clear = useMutation({
    mutationFn: () => deleteProjectManagerGoal(projectId),
    onSuccess: async () => { await invalidateGoal(); closeConfirmation(); },
    onError: () => toast.error(t("projects.clearGoalError")),
  });
  const pending = save.isPending || clear.isPending;

  return (
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {heading}
        {(canManage || actions) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {canManage && (
              <>
                <Button
                  ref={editRef}
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground"
                  aria-label={t("projects.editGoalInline")}
                  title={t("projects.editGoalInline")}
                  aria-expanded={editing}
                  aria-controls={editing ? formId : undefined}
                  disabled={pending}
                  onClick={() => editing ? closeEditor() : setDraft(goal?.summary ?? "")}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                </Button>
                {goal && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    aria-label={t("projects.clearGoalInline")}
                    title={t("projects.clearGoalInline")}
                    disabled={editing || pending}
                    onClick={() => setConfirmClear(true)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                )}
              </>
            )}
            {actions}
          </div>
        )}
      </div>

      {editing ? (
        <form
          id={formId}
          aria-labelledby={summaryId}
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const summary = draft.trim();
            if (summary && !pending) save.mutate(summary);
          }}
        >
          <label id={summaryId} htmlFor={`${summaryId}-input`} className="sr-only">{t("projects.projectManagerGoalSummary")}</label>
          <Textarea
            id={`${summaryId}-input`}
            name="summary"
            autoFocus
            required
            rows={2}
            maxLength={1000}
            value={draft}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-16 resize-y bg-background text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            <Button type="submit" size="sm" disabled={pending || !draft.trim()}>{t("common.save")}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={closeEditor}>{t("common.cancel")}</Button>
          </div>
        </form>
      ) : children}

      {canManage && (
        <ConfirmDialog
          open={confirmClear}
          title={t("projects.clearGoalInline")}
          description={t("projects.clearGoalConfirm")}
          confirmLabel={t("common.delete")}
          destructive
          pending={clear.isPending}
          onOpenChange={(open) => { if (!open) closeConfirmation(); }}
          onConfirm={() => { if (goal && !pending) clear.mutate(); }}
        />
      )}
    </div>
  );
}
