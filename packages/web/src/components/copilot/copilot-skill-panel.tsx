"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/hooks/use-language";
import { listSkills, toggleSkill } from "@/lib/api";

export const skillsQueryKey = ["skills"] as const;

/**
 * Copilot skills card — the agent-facing view of the platform Skills store.
 *
 * The Copilot's `list_skills` / `load_skill` tools and the `/skills` slash
 * command all read the same `skills` table the Skills page manages. This card
 * shows a compact summary on the Copilot settings control panel and opens a
 * dialog to toggle which skills are visible to the agent, keeping full
 * editing on the dedicated Skills page.
 */
export function CopilotSkillsCard() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const skills = useQuery({
    queryKey: skillsQueryKey,
    queryFn: listSkills,
  });

  const items = skills.data?.skills ?? [];
  const enabledCount = items.filter((skill) => skill.isEnabled).length;

  return (
    <>
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">{t("copilot.skillsTitle")}</p>
          <Badge variant="secondary" className="shrink-0">
            {t("copilot.skillsEnabledCount")
              .replace("{enabled}", String(enabledCount))
              .replace("{total}", String(items.length))}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("copilot.skillsDialogDescription")}
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Sparkles className="size-3.5" />
          {t("copilot.skillsManageDialog")}
        </Button>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("copilot.skillsTitle")}</DialogTitle>
            <DialogDescription>{t("copilot.skillsDialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
            <SkillList items={items} pending={skills.isPending} />
          </div>
          <div className="flex justify-end border-t border-border/70 pt-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/skills">
                {t("copilot.skillsManage")}
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SkillList({
  items,
  pending,
}: {
  items: { id: string; name: string; description?: string | null; source: string; isEnabled: boolean }[];
  pending: boolean;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleSkill(id, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillsQueryKey });
    },
  });

  if (pending) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("copilot.skillsEmpty")}</p>;
  }

  return (
    <>
      {items.map((skill) => (
        <div
          key={skill.id}
          className={`flex items-start justify-between gap-3 rounded-md border border-border/70 bg-card px-3 py-2 transition-opacity ${
            skill.isEnabled ? "" : "opacity-60"
          }`}
        >
          <div className="min-w-0 space-y-0.5">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
              <Sparkles className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-mono">{skill.name}</span>
              <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">
                {skill.source}
              </Badge>
            </p>
            {skill.description ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{skill.description}</p>
            ) : null}
          </div>
          <Switch
            aria-label={skill.name}
            size="sm"
            className="mt-0.5 shrink-0"
            disabled={toggleMutation.isPending}
            checked={skill.isEnabled}
            onCheckedChange={(enabled) => toggleMutation.mutate({ id: skill.id, enabled })}
          />
        </div>
      ))}
    </>
  );
}
