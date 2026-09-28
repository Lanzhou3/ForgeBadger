import { Trash2 } from "lucide-react";

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
  type DeleteTarget,
  type Translate,
} from "./shared";

interface DeleteConfirmDialogProps {
  target: DeleteTarget | null;
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  t: Translate;
}

export function DeleteConfirmDialog({
  target,
  isDeleting,
  onOpenChange,
  onConfirm,
  t,
}: DeleteConfirmDialogProps) {
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
            <Trash2 className="size-5 shrink-0 text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={isDeleting} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={isDeleting} onClick={onConfirm}>
            <Trash2 className="size-4" />
            {isDeleting ? t("models.deleting") : t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
