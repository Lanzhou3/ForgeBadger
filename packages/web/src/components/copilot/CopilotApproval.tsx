"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { decidePendingAction, type CopilotPendingAction } from "@/lib/copilot-api";
import { getSessionStopApprovalTarget, SessionStopApprovalTarget } from './SessionStopApprovalTarget';

interface Props {
  action: CopilotPendingAction;
  onDecided: () => Promise<void> | void;
}

/** One exact server-issued action; approval never grants future authority. */
export function CopilotApproval({ action, onDecided }: Props) {
  const { t } = useLanguage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const stopTarget = getSessionStopApprovalTarget(action);
  const stopBlocked = action.tool === 'stop_session' && !stopTarget;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const decide = async (approved: boolean) => {
    if (submitting.current || action.status !== "pending" || (approved && stopBlocked)) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await decidePendingAction(action.runId, action.id, approved);
      if (!mounted.current) return;
      if (!result.resumed) setError(t("copilot.approvalChanged"));
      await onDecided();
    } catch {
      if (mounted.current) setError(t("copilot.approvalFailed"));
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  };

  if (action.status !== "pending") return null;
  return (
    <section className="space-y-2 rounded-lg border border-amber-500/40 p-3">
      <p className="text-sm font-medium">{t("copilot.approvalTitle")}</p>
      <p className="break-all font-mono text-xs">{action.tool}</p>
      {action.tool === 'stop_session' && <SessionStopApprovalTarget target={stopTarget} />}
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{action.inputJson}</pre>
      <p className="text-xs text-muted-foreground">{t("copilot.approvalScope")}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || stopBlocked} onClick={() => void decide(true)}>{t("copilot.approvalAllow")}</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => void decide(false)}>{t("copilot.approvalReject")}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
