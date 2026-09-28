"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { toast } from "@/lib/toast";

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
import { useLanguage } from "@/hooks/use-language";
import { extractProjectTemplate } from "@/lib/api";

const TEMPLATE_ADAPTERS = ["claude", "opencode", "codex", "kimi"] as const;
type TemplateAdapter = (typeof TEMPLATE_ADAPTERS)[number];

interface ExtractTemplateDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExtracted?: () => void;
}

export function ExtractTemplateDialog({ projectId, open, onOpenChange, onExtracted }: ExtractTemplateDialogProps) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [adapter, setAdapter] = useState<TemplateAdapter>("claude");
  const [bind, setBind] = useState(true);

  const extractMutation = useMutation({
    mutationFn: () =>
      extractProjectTemplate(projectId, {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        adapter,
        bind,
      }),
    onSuccess: () => {
      toast.success(t("templates.created"));
      onExtracted?.();
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (extractMutation.isPending) return;
    if (!next) {
      setName("");
      setDescription("");
      setAdapter("claude");
      setBind(true);
      extractMutation.reset();
    }
    onOpenChange(next);
  };

  const canSubmit = name.trim().length > 0 && !extractMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("templates.extractTitle")}</DialogTitle>
          <DialogDescription>{t("templates.extractDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) extractMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="extract-template-name">{t("common.name")}</Label>
            <Input
              id="extract-template-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={extractMutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="extract-template-description">{t("common.description")}</Label>
            <Textarea
              id="extract-template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              disabled={extractMutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="extract-template-adapter">{t("templates.adapter")}</Label>
            <select
              id="extract-template-adapter"
              aria-label={t("templates.adapter")}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={adapter}
              onChange={(event) => setAdapter(event.target.value as TemplateAdapter)}
              disabled={extractMutation.isPending}
            >
              {TEMPLATE_ADAPTERS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={bind}
              onCheckedChange={(checked) => setBind(checked === true)}
              disabled={extractMutation.isPending}
            />
            {t("templates.extractBind")}
          </label>

          {extractMutation.isError && (
            <p className="text-sm text-destructive">
              {extractMutation.error instanceof Error
                ? extractMutation.error.message
                : t("templates.extractFailed")}
            </p>
          )}

          {extractMutation.data && (
            <div className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t("templates.extractedFiles")}</div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {extractMutation.data.extracted.map((file) => (
                    <li key={file.filePath} className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono">{file.filePath}</span>
                      <span className="shrink-0">{file.sizeBytes} B</span>
                    </li>
                  ))}
                </ul>
              </div>
              {extractMutation.data.skipped.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">{t("templates.skippedFiles")}</div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {extractMutation.data.skipped.map((file) => (
                      <li key={file.path} className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono">{file.path}</span>
                        <span className="shrink-0">{file.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={extractMutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              <Package className="size-4" />
              {extractMutation.isPending ? t("templates.extracting") : t("templates.extract")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
