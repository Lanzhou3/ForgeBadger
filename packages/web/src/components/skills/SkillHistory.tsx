"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import {
  listSkillRevisions,
  type PreviewInput,
} from "@/lib/skill-registry-api";
import { Button } from "@/components/ui/button";
import { SkillPackageReview } from "./SkillPackageReview";

interface Props {
  skillId: string;
}
export function SkillHistory({ skillId }: Props) {
  const { language } = useLanguage();
  const pick = useTrilingual();
  const [review, setReview] = useState<PreviewInput | null>(null);
  const history = useQuery({
    queryKey: ["skill-revisions", skillId],
    queryFn: () => listSkillRevisions(skillId),
  });
  return (
    <div className="mt-3 space-y-2">
      <h3 className="text-sm font-medium">
        {pick("保留的版本", "保留的版本", "Retained versions")}
      </h3>
      {history.isPending ? (
        <p className="text-xs">{pick("加载中…", "載入中…", "Loading…")}</p>
      ) : history.error ? (
        <p role="alert" className="text-xs text-destructive">
          {history.error.message}
        </p>
      ) : history.data?.revisions.length ? (
        history.data.revisions.map((revision) => (
          <div
            key={revision.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 p-2 text-xs"
          >
            <span>
              {new Date(revision.createdAt).toLocaleString(language)} ·{" "}
              {revision.action} · {revision.packageHash.slice(0, 19)}…
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReview({ skillId, revisionId: revision.id })}
            >
              {pick("预览恢复", "預覽復原", "Review restore")}
            </Button>
          </div>
        ))
      ) : (
        <p className="text-xs text-muted-foreground">
          {pick(
            "下次更新时会保留当前版本。",
            "下次更新時會保留目前版本。",
            "A version will be retained at the next update.",
          )}
        </p>
      )}
      {review ? (
        <SkillPackageReview input={review} onClose={() => setReview(null)} />
      ) : null}
    </div>
  );
}
