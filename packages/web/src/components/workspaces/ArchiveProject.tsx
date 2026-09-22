"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { collaborationApi } from "@/lib/collaboration-api";
import { ErrorNotice, useWorkspaceAction } from "./WorkspaceShared";
interface Props {
  projectId: string;
}
export function ArchiveProject({ projectId }: Props) {
  const { t } = useLanguage();
  const router = useRouter();
  const action = useWorkspaceAction(projectId);
  const [confirm, setConfirm] = useState(false);
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <Button
        size="sm"
        variant="outline"
        disabled={action.isPending}
        onClick={() => setConfirm(true)}
      >
        {t("workspace.archive")}
      </Button>
      {confirm && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("workspace.archiveHint")}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={action.isPending}
              onClick={() =>
                action.mutate(async () => {
                  await collaborationApi.archive(projectId);
                  router.push("/projects");
                })
              }
            >
              {t("workspace.confirm")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={action.isPending}
              onClick={() => setConfirm(false)}
            >
              {t("workspace.cancel")}
            </Button>
          </div>
        </div>
      )}
      <ErrorNotice error={action.error} />
    </section>
  );
}
