"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";
import { useLanguage } from "@/hooks/use-language";
import { GatewayApiError } from "@/lib/api";
import { decidePendingAction, type CopilotPendingAction } from "@/lib/copilot-api";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { getSessionStopApprovalTarget, SessionStopApprovalTarget } from "./SessionStopApprovalTarget";

interface Props {
  action: CopilotPendingAction;
  onDecided: () => Promise<void> | void;
}

function approvalRemedy(error: unknown): TranslationKey {
  const code = error instanceof GatewayApiError && typeof error.details?.code === "string" ? error.details.code : "";
  if (["PLATFORM_INTENT_EXPIRED", "COPILOT_APPROVAL_EXPIRED", "COPILOT_TIME_BUDGET", "COPILOT_TOKEN_BUDGET"].includes(code)) return "copilot.approvalExpired";
  if (["COPILOT_APPROVAL_CHANGED", "COPILOT_REQUEST_CONFLICT", "PLATFORM_STALE_RESOURCE", "COPILOT_NOT_FOUND"].includes(code)) return "copilot.approvalInputChanged";
  if (["COPILOT_APPROVAL_DENIED", "COPILOT_APPROVAL_SCOPE", "COPILOT_USER_INACTIVE"].includes(code)) return "copilot.approvalAuthorityChanged";
  if (code === "COPILOT_TOOL_DISABLED") return "copilot.approvalToolDisabled";
  if (code === "COPILOT_TOOL_UNAVAILABLE") return "copilot.approvalToolUnavailable";
  return "copilot.approvalUncertain";
}

/** A goal check the model asked to run on the host instead of inside the OS sandbox. */
function isUnsandboxedCheck(action: CopilotPendingAction): boolean {
  if (action.tool !== 'goal_run_checks') return false;
  try {
    const input = JSON.parse(action.inputJson) as { unsandboxed?: unknown } | null;
    return input?.unsandboxed === true;
  } catch { return false; }
}

/** Pretty-print approval argument JSON when parseable; fall back to raw text. */
function formatApprovalInput(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
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
  const unsandboxed = isUnsandboxedCheck(action);
  const escalated = unsandboxed || action.tool === "stop_session";
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
    } catch (failure) {
      if (mounted.current) {
        setError(t(approvalRemedy(failure)));
      }
    } finally {
      if (mounted.current) {
        // The decision may have succeeded despite a lost response. Refresh
        // the receipt once; never automatically resubmit the write.
        await Promise.resolve().then(onDecided).catch(() => {
          if (mounted.current) setError(current => current ?? t("copilot.approvalUncertain"));
        });
      }
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  };

  if (action.status !== "pending") return null;
  return (
    <section
      className={cn(
        "forgebadger-animate-in space-y-3 rounded-xl border p-3.5 shadow-card",
        escalated ? "border-destructive/45 bg-destructive/5" : "border-warning/40 bg-warning/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <IconTile size="xs" tone={escalated ? "destructive" : "warning"}>
          <ShieldAlert aria-hidden="true" />
        </IconTile>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("copilot.approvalTitle")}</p>
        </div>
        <Badge variant="outline" className="max-w-full break-all border-border/70 bg-background/70 font-mono text-xs">
          {action.tool}
        </Badge>
      </div>
      {action.tool === 'stop_session' && <SessionStopApprovalTarget target={stopTarget} />}
      {unsandboxed && (
        <p role="note" className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs font-medium text-destructive">{t("copilot.approvalUnsandboxed")}</p>
      )}
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/50 bg-background/75 p-2.5 font-mono text-xs leading-relaxed text-foreground/90">
        {formatApprovalInput(action.inputJson)}
      </pre>
      <p className="text-xs text-muted-foreground">{t("copilot.approvalScope")}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="brand" disabled={pending || stopBlocked} onClick={() => void decide(true)}>{t("copilot.approvalAllow")}</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => void decide(false)}>{t("copilot.approvalReject")}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
