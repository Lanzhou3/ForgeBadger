"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/hooks/use-language";
import {
  listCopilotPlaybooks,
  setCopilotPlaybookEnabled,
  updateCopilotPlaybook,
  type CopilotPlaybook,
} from "@/lib/copilot-api";

export const copilotPlaybooksQueryKey = ["copilot", "playbooks"] as const;

/** Copilot-only handbooks; CLI Skill installation has a separate lifecycle. */
export function CopilotPlaybooksCard() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const playbooks = useQuery({
    queryKey: copilotPlaybooksQueryKey,
    queryFn: listCopilotPlaybooks,
    retry: false,
  });
  const items = playbooks.data?.playbooks ?? [];
  const enabledCount = items.filter((item) => item.isEnabled && item.available && !item.reviewRequired).length;

  const status = playbooks.isPending ? (
    <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
  ) : playbooks.isError ? (
    <div role="alert" className="space-y-2 text-xs text-destructive">
      <p>{t("copilot.playbooksLoadError")}</p>
      <Button variant="outline" size="sm" onClick={() => void playbooks.refetch()}>{t("copilot.playbooksRetry")}</Button>
    </div>
  ) : items.length === 0 ? (
    <p className="text-xs text-muted-foreground">{t("copilot.playbooksEmpty")}</p>
  ) : null;

  return (
    <>
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">{t("copilot.playbooksTitle")}</p>
          {!playbooks.isPending && !playbooks.isError ? (
            <Badge variant="secondary" className="shrink-0">
              {t("copilot.playbooksEnabledCount").replace("{enabled}", String(enabledCount)).replace("{total}", String(items.length))}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("copilot.playbooksDescription")}</p>
        {status}
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Sparkles className="size-3.5" />{t("copilot.playbooksManage")}
        </Button>
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("copilot.playbooksTitle")}</DialogTitle>
            <DialogDescription>{t("copilot.playbooksDescription")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {status ?? items.map((item) => <PlaybookRow key={item.id} item={item} />)}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PlaybookRow({ item }: { item: CopilotPlaybook }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content);
  const [version, setVersion] = useState(item.currentVersion);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: copilotPlaybooksQueryKey }); };
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setCopilotPlaybookEnabled(item.id, enabled),
    onSuccess: refresh,
  });
  const save = useMutation({
    mutationFn: () => updateCopilotPlaybook(item.id, { content, version }),
    onSuccess: () => { setEditing(false); refresh(); },
  });
  const pending = toggle.isPending || save.isPending;

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
            <Sparkles className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="break-all font-mono">{item.name}</span>
            <Badge variant="outline" className="px-1 py-0 text-[10px]">v{item.version}{item.reviewRequired ? ` → v${item.currentVersion}` : ""}</Badge>
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          {!item.isEnabled && <p className="text-xs text-muted-foreground">{t("copilot.playbookDisabled")}</p>}
          {item.reviewRequired && <p className="text-xs text-amber-500">{t("copilot.playbookReviewRequired")}</p>}
          {!item.available && !item.reviewRequired && (
            <p className="text-xs text-amber-500">{t("copilot.toolUnavailable")}: {item.unavailableReason ?? t("copilot.toolUnavailable")}</p>
          )}
        </div>
        <Switch
          aria-label={item.name}
          size="sm"
          className="mt-0.5 shrink-0"
          disabled={pending || !item.editable || (item.reviewRequired && !item.isEnabled)}
          checked={item.isEnabled}
          onCheckedChange={(enabled) => toggle.mutate(enabled)}
        />
      </div>
      {item.requiredTools.length > 0 && (
        <p className="break-words text-xs text-muted-foreground">{t("copilot.playbookRequiredTools")}: {item.requiredTools.join(", ")}</p>
      )}
      {toggle.isError && <p role="alert" className="text-xs text-destructive">{t("copilot.playbooksToggleError")}</p>}
      {item.editable && !editing && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => {
          setContent(item.content); setVersion(item.currentVersion); save.reset(); setEditing(true);
        }}>{t("copilot.playbookEdit")}</Button>
      )}
      {editing && (
        <div className="space-y-2 border-t border-border/70 pt-2">
          <label className="block space-y-1 text-xs">
            <span>{t("copilot.playbookContent")}</span>
            <Textarea value={content} onChange={(event) => setContent(event.target.value)} disabled={pending} maxLength={32000} className="min-h-48 font-mono text-xs" />
          </label>
          <p className="text-xs text-muted-foreground">{t("copilot.playbookReviewHelp")}</p>
          {save.isError && <p role="alert" className="text-xs text-destructive">{t("copilot.playbooksSaveError")}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={pending || !content.trim()} onClick={() => save.mutate()}>{t("copilot.playbookSave")}</Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(false)}>{t("common.cancel")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
