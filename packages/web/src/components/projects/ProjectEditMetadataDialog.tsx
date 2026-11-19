"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

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
import { useLanguage } from "@/hooks/use-language";
import { updateProjectMetadata, type Project } from "@/lib/api";
import { toast } from "@/lib/toast";

interface ProjectEditMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}

/**
 * Modal dialog to edit a project's display name and vibe coding background
 * description without touching directory binding or template configuration.
 */
export function ProjectEditMetadataDialog({
  open,
  onOpenChange,
  project,
}: ProjectEditMetadataDialogProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setDescription(project.description ?? "");
    setError(null);
  }, [open, project.description, project.name]);

  const mutation = useMutation({
    mutationFn: () => {
      const trimmedName = name.trim();
      const trimmedDescription = description.trim();
      return updateProjectMetadata(project.id, {
        name: trimmedName,
        description: trimmedDescription.length > 0 ? trimmedDescription : null,
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["project", project.id], updated);
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["projects-overview"] });
      toast.success(t("projects.metadataSaved"));
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("projects.failedSaveConfig"));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("projects.nameRequired"));
      return;
    }
    setError(null);
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("projects.editMetadata")}</DialogTitle>
          <DialogDescription>
            {t("projects.editMetadataDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-edit-name">{t("projects.projectName")}</Label>
            <Input
              id="project-edit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("projects.namePlaceholder")}
              disabled={mutation.isPending}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-edit-description">
              {t("projects.optionalDescription")}
            </Label>
            <Textarea
              id="project-edit-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              disabled={mutation.isPending}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
