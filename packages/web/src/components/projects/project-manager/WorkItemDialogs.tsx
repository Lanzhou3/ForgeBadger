import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
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
import type {
  ProjectManagerWorkItem,
  ProjectManagerWorkItemStatus,
} from "@/lib/api";
import { WORK_ITEM_STATUSES, type EditWorkItemDraft, type Translate, type WorkItemDraft } from "./types";
import { statusLabel } from "./utils";

export function CreateWorkItemDialog({
  draft,
  error,
  isSaving,
  onDraftChange,
  onOpenChange,
  onSave,
  open,
  t,
}: {
  draft: WorkItemDraft;
  error: string | null;
  isSaving: boolean;
  onDraftChange: (draft: WorkItemDraft) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  open: boolean;
  t: Translate;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(900px,calc(100vh-2rem))] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("projects.projectManagerCreateWorkItem")}</DialogTitle>
          <DialogDescription>{t("projects.projectManagerCreateWorkItemBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
            <div className="space-y-2">
              <Label htmlFor="project-manager-work-item-title">
                {t("projects.projectManagerWorkItemTitle")}
              </Label>
              <Input
                id="project-manager-work-item-title"
                value={draft.title}
                aria-invalid={!!error && draft.title.trim().length === 0}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-manager-work-item-priority">
                {t("projects.projectManagerPriority")}
              </Label>
              <Input
                id="project-manager-work-item-priority"
                inputMode="numeric"
                value={draft.priority}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, priority: event.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_190px]">
            <div className="space-y-2">
              <Label htmlFor="project-manager-work-item-description">
                {t("projects.projectManagerWorkItemDescription")}
              </Label>
              <Textarea
                id="project-manager-work-item-description"
                value={draft.description}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-manager-work-item-status">{t("common.status")}</Label>
              <select
                id="project-manager-work-item-status"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                value={draft.status}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, status: event.target.value as ProjectManagerWorkItemStatus })}
              >
                {WORK_ITEM_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status, t)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-manager-work-item-acceptance">
              {t("projects.projectManagerAcceptanceCriteria")}
            </Label>
            <Textarea
              id="project-manager-work-item-acceptance"
              value={draft.acceptanceCriteriaText}
              disabled={isSaving}
              placeholder={t("projects.projectManagerTextListHint")}
              onChange={(event) => onDraftChange({ ...draft, acceptanceCriteriaText: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t("projects.projectManagerTextListHint")}</p>
          </div>
          <ReferenceDraftFields
            disabled={isSaving}
            draft={draft}
            onDraftChange={onDraftChange}
            prefix="evidence"
            title={t("projects.projectManagerInitialEvidenceRefs")}
            t={t}
          />
          <ReferenceDraftFields
            disabled={isSaving}
            draft={draft}
            onDraftChange={onDraftChange}
            prefix="feishu"
            title={t("projects.projectManagerInitialFeishuRefs")}
            t={t}
          />
          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("projects.projectManagerCancel")}
          </Button>
          <Button
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={onSave}
            disabled={isSaving}
          >
            {t("projects.projectManagerCreateWorkItem")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditWorkItemDialog({
  draft,
  error,
  isSaving,
  item,
  onDraftChange,
  onOpenChange,
  onSave,
  t,
}: {
  draft: EditWorkItemDraft;
  error: string | null;
  isSaving: boolean;
  item: ProjectManagerWorkItem | null;
  onDraftChange: (draft: EditWorkItemDraft) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  t: Translate;
}) {
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("projects.projectManagerEditWorkItem")}</DialogTitle>
          <DialogDescription>{t("projects.projectManagerEditWorkItemBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
            <div className="space-y-2">
              <Label htmlFor="project-manager-edit-work-item-title">
                {t("projects.projectManagerWorkItemTitle")}
              </Label>
              <Input
                id="project-manager-edit-work-item-title"
                value={draft.title}
                aria-invalid={!!error && draft.title.trim().length === 0}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-manager-edit-work-item-priority">
                {t("projects.projectManagerPriority")}
              </Label>
              <Input
                id="project-manager-edit-work-item-priority"
                inputMode="numeric"
                value={draft.priority}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, priority: event.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-manager-edit-work-item-description">
              {t("projects.projectManagerWorkItemDescription")}
            </Label>
            <Textarea
              id="project-manager-edit-work-item-description"
              value={draft.description}
              disabled={isSaving}
              onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-manager-edit-work-item-acceptance">
              {t("projects.projectManagerAcceptanceCriteria")}
            </Label>
            <Textarea
              id="project-manager-edit-work-item-acceptance"
              value={draft.acceptanceCriteriaText}
              disabled={isSaving}
              placeholder={t("projects.projectManagerTextListHint")}
              onChange={(event) => onDraftChange({ ...draft, acceptanceCriteriaText: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t("projects.projectManagerTextListHint")}</p>
          </div>
          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("projects.projectManagerCancel")}
          </Button>
          <Button
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={onSave}
            disabled={isSaving}
          >
            {t("projects.projectManagerSaveWorkItem")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteWorkItemDialog({
  error,
  isDeleting,
  item,
  onConfirm,
  onOpenChange,
  t,
}: {
  error: string | null;
  isDeleting: boolean;
  item: ProjectManagerWorkItem | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  t: Translate;
}) {
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("projects.projectManagerDeleteWorkItem")}</DialogTitle>
          <DialogDescription>{t("projects.projectManagerDeleteWorkItemBody")}</DialogDescription>
        </DialogHeader>
        {item && (
          <div className="space-y-3">
            <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
              <div className="break-words text-sm font-medium">{item.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {statusLabel(item.status, t)} · {t("projects.projectManagerEvidenceRefs")}: {item.evidenceRefCount}
              </div>
            </div>
            {error && (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            {t("projects.projectManagerCancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {t("projects.projectManagerDeleteWorkItem")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReferenceDraftFields({
  disabled,
  draft,
  onDraftChange,
  prefix,
  title,
  t,
}: {
  disabled: boolean;
  draft: WorkItemDraft;
  onDraftChange: (draft: WorkItemDraft) => void;
  prefix: "evidence" | "feishu";
  title: string;
  t: Translate;
}) {
  const isEvidence = prefix === "evidence";
  const fieldId = `project-manager-${prefix}-ref`;
  const kindKey = isEvidence ? "evidenceKind" : "feishuKind";
  const labelKey = isEvidence ? "evidenceLabel" : "feishuLabel";
  const refKey = isEvidence ? "evidenceRef" : "feishuRef";
  const finalKey = isEvidence ? "evidencePath" : "feishuMessageId";

  return (
    <fieldset className="space-y-3 rounded-md border border-border/70 p-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-kind`}>{t("projects.projectManagerRefKind")}</Label>
          <Input
            id={`${fieldId}-kind`}
            value={draft[kindKey]}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, [kindKey]: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-label`}>{t("projects.projectManagerRefLabel")}</Label>
          <Input
            id={`${fieldId}-label`}
            value={draft[labelKey]}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, [labelKey]: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-ref`}>{t("projects.projectManagerRefId")}</Label>
          <Input
            id={`${fieldId}-ref`}
            value={draft[refKey]}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, [refKey]: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-final`}>
            {isEvidence ? t("common.path") : t("projects.projectManagerFeishuMessageId")}
          </Label>
          <Input
            id={`${fieldId}-final`}
            value={draft[finalKey]}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, [finalKey]: event.target.value })}
          />
        </div>
      </div>
    </fieldset>
  );
}

export function DoneReasonDialog({
  error,
  isSaving,
  onConfirm,
  onOpenChange,
  open,
  reason,
  reasonRef,
  setReason,
  t,
  workItemTitle,
}: {
  error: string | null;
  isSaving: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  reason: string;
  reasonRef: RefObject<HTMLTextAreaElement | null>;
  setReason: (reason: string) => void;
  t: Translate;
  workItemTitle: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("projects.projectManagerDoneReasonTitle")}</DialogTitle>
          <DialogDescription>{t("projects.projectManagerDoneReasonBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="project-manager-done-reason">{t("projects.projectManagerDoneReasonLabel")}</Label>
          <Textarea
            id="project-manager-done-reason"
            ref={reasonRef}
            value={reason}
            aria-invalid={!!error}
            disabled={isSaving}
            onChange={(event) => setReason(event.target.value)}
          />
          {workItemTitle && <p className="text-xs text-muted-foreground">{workItemTitle}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("projects.projectManagerCancel")}
          </Button>
          <Button
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={onConfirm}
            disabled={isSaving}
          >
            {t("projects.projectManagerConfirmStatusChange")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
