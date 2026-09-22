"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import {
  collaborationApi,
  hasCapability,
  type WorkspaceDetail,
  type RunDetail,
} from "@/lib/collaboration-api";
import { ErrorNotice, Panel, useWorkspaceAction } from "./WorkspaceShared";
interface Props {
  project: WorkspaceDetail["project"];
  detail: RunDetail;
  executor: boolean;
  onRecovered: (id: string) => void;
}
export function RunActions({ project, detail, executor, onRecovered }: Props) {
  const { t } = useLanguage();
  const action = useWorkspaceAction(project.id);
  const [confirm, setConfirm] = useState<
    "recover" | "close" | "integrate" | null
  >(null);
  const [recoveryKey, setRecoveryKey] = useState(() => crypto.randomUUID());
  const [handoff, setHandoff] = useState<string | null>(null);
  const { run, git } = detail;
  const ready = run.state === "ready";
  const manager = (executor && hasCapability(project,"closeOwnRun")) || hasCapability(project,"manage");
  const currentReceipt = detail.verifications.find(
    (r) =>
      r.status === "passed" && r.current === true && r.commit === git.commit,
  );
  const lastReview = detail.reviews[0];
  const accepted = Boolean(
    currentReceipt &&
      lastReview?.decision === "accepted" &&
      lastReview.commit === git.commit &&
      lastReview.verificationId === currentReceipt.id,
  );
  const execute = () => {
    if (!confirm) return;
    action.mutate(async () => {
      if (confirm === "recover") {
        const result = await collaborationApi.recover(
          project.id,
          run.id,
          recoveryKey,
        );
        setRecoveryKey(crypto.randomUUID());
        onRecovered(result.run.id);
      } else if (confirm === "integrate")
        await collaborationApi.integrate(project.id, run.id, git.commit);
      else await collaborationApi.close(project.id, run.id);
      setConfirm(null);
    });
  };
  return (
    <>
      <Panel title={t("common.actions")}>
        <div className="flex flex-wrap gap-2">
          {hasCapability(project,"manage") && (
            <Button
              size="sm"
              disabled={
                Boolean(run.operation) ||
                !ready ||
                !accepted ||
                git.dirty ||
                Boolean(git.conflicts?.length) ||
                Boolean(git.error) ||
                action.isPending
              }
              onClick={() => setConfirm("integrate")}
            >
              {t("workspace.integrate")}
            </Button>
          )}
          {executor && (
            <Button
              size="sm"
              variant="outline"
              disabled={
                action.isPending ||
                ["provisioning", "revoking"].includes(run.state) ||
                !project.executionEnabled ||
                project.managedExecution?.supported === false
              }
              onClick={() => setConfirm("recover")}
            >
              {t("workspace.recover")}
            </Button>
          )}
          {manager && (
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending || run.state === "closed"}
              onClick={() => setConfirm("close")}
            >
              {t("workspace.close")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(async () => {
                const result = await collaborationApi.handoff(
                  project.id,
                  run.id,
                );
                setHandoff(result.markdown);
                const blob = new Blob([result.markdown], {
                  type: "text/markdown;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `handoff-${run.id}.md`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              })
            }
          >
            {t("workspace.handoff")}
          </Button>
        </div>
        {confirm && (
          <div
            role="group"
            aria-label={t(`workspace.${confirm}`)}
            className="space-y-3 rounded-md border border-border/70 p-3"
          >
            <p className="text-sm">{t(`workspace.${confirm}Hint`)}</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={action.isPending || (confirm === "recover" && project.managedExecution?.supported === false)} onClick={execute}>
                {t("workspace.confirm")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={action.isPending}
                onClick={() => setConfirm(null)}
              >
                {t("workspace.cancel")}
              </Button>
            </div>
          </div>
        )}
        {handoff && (
          <pre
            aria-label={t("workspace.handoffText")}
            className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 p-3 text-xs"
          >
            {handoff}
          </pre>
        )}
      </Panel>
      <ErrorNotice error={action.error} />
    </>
  );
}
