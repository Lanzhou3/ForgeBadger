"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { GatewayApiError } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import { reconcileDevelopmentTask, type DevelopmentTask, type DevelopmentEvidence } from "@/lib/development-api";

interface Props { task: DevelopmentTask; }

function remedy(error: unknown): TranslationKey {
  const code = error instanceof GatewayApiError ? error.details?.code : undefined;
  if (code === "DEVELOPMENT_RECONCILIATION_STALE" || code === "DEVELOPMENT_RECONCILIATION_NOT_FOUND") return "copilot.development.reconciliationStale";
  if (code === "DEVELOPMENT_RECONCILIATION_IDENTITY_MISSING") return "copilot.development.reconciliationIdentityMissing";
  if (code === "DEVELOPMENT_RECONCILIATION_STILL_ACTIVE") return "copilot.development.reconciliationStillActive";
  if (typeof code === "string" && /IDENTITY_MISMATCH|EVIDENCE_/.test(code)) return "copilot.development.reconciliationEvidenceMissing";
  return "copilot.development.reconciliationUncertain";
}

/** Owner-requested stop verification never executes or requeues the task. */
export function DevelopmentTaskReconciliation({ task }: Props) {
  const { t } = useLanguage();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [verified, setVerified] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function reconcile() {
    if (submitting.current || task.status !== "indeterminate") return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await reconcileDevelopmentTask(task.projectId, task.id, task.revision);
      client.setQueryData<{ task: DevelopmentTask; evidence: DevelopmentEvidence | null }>(
        ["development-task", task.projectId, task.id], current => current ? { ...current, task: result.task } : current
      );
      if (mounted.current) setVerified(result.task.status === "failed");
    } catch (failure) {
      if (mounted.current) setError(remedy(failure));
    } finally {
      await Promise.allSettled([
        client.invalidateQueries({ queryKey: ["development-tasks", task.projectId] }),
        client.invalidateQueries({ queryKey: ["development-task", task.projectId, task.id] }),
      ]);
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (task.status !== "indeterminate" && !verified) return null;
  return <div className="space-y-2">
    {task.status === "indeterminate" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void reconcile()}>{t(busy ? "copilot.development.reconciling" : "copilot.development.reconcile")}</Button>}
    {verified && <p role="status" className="text-sm text-muted-foreground">{t("copilot.development.reconciledUnknown")}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
  </div>;
}
