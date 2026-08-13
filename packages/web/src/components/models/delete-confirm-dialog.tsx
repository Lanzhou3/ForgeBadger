import { CheckCircle2, Layers3, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  ReferenceRow,
  type DeleteTarget,
  type ModelReferenceInfo,
  type Translate,
} from "./shared";

interface DeleteConfirmDialogProps {
  target: DeleteTarget | null;
  references: ModelReferenceInfo;
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  t: Translate;
}

export function DeleteConfirmDialog({
  target,
  references,
  isDeleting,
  onOpenChange,
  onConfirm,
  t,
}: DeleteConfirmDialogProps) {
  const blocked = references.sessions.length > 0 || references.agents.length > 0;
  const title =
    target?.kind === "model"
      ? t("models.deleteModelTitle")
      : target?.kind === "credential"
        ? t("models.deleteCredentialTitle")
        : t("models.deleteProviderTitle");
  const description =
    target?.kind === "model"
      ? t("models.deleteModelWarning")
      : target?.kind === "credential"
        ? t("models.deleteCredentialConfirm")
        : t("models.deleteProviderWarning");
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !isDeleting) onOpenChange(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {blocked ? (
              <TriangleAlert className="size-5 shrink-0 text-amber-500" />
            ) : (
              <Trash2 className="size-5 shrink-0 text-destructive" />
            )}
            {blocked ? t("models.deleteBlockedTitle") : title}
          </DialogTitle>
          <DialogDescription>{blocked ? t("models.deleteBlockedReferenceHint") : description}</DialogDescription>
        </DialogHeader>

        {blocked ? (
          <div className="space-y-3">
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              {references.sessions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Layers3 className="size-3.5" />
                    {t("models.referencedSessions")}（{references.sessions.length}）
                  </div>
                  {references.sessions.slice(0, 12).map((item) => (
                    <ReferenceRow
                      key={item.id}
                      name={item.name}
                      status={item.status}
                      kindLabel={t("models.referencedSessions")}
                      href={`/sessions/${item.id}`}
                      linkLabel={t("models.viewSession")}
                    />
                  ))}
                </div>
              )}
              {references.agents.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Layers3 className="size-3.5" />
                    {t("models.referencedAgents")}（{references.agents.length}）
                  </div>
                  {references.agents.slice(0, 12).map((item) => (
                    <ReferenceRow
                      key={item.id}
                      name={item.name}
                      status={item.status}
                      kindLabel={t("models.referencedAgents")}
                      href="/projects"
                      linkLabel={t("models.viewAgents")}
                    />
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("models.deleteBlockedHint")}</p>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-4 shrink-0" />
            {t("models.referencesSafe")}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={isDeleting} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={blocked || isDeleting} onClick={onConfirm}>
            <Trash2 className="size-4" />
            {isDeleting ? t("models.deleting") : t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
