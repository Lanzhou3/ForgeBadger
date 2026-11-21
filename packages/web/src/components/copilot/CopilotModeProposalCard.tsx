"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Compass, Route, X } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { GatewayApiError } from "@/lib/api";
import { confirmCopilotModeProposal, type CopilotMessage, type CopilotModeDecision, type CopilotModeReceipt } from "@/lib/copilot-api";
import { toast } from "@/lib/toast";

const proposalSchema = z.object({
  status: z.literal("mode_switch_proposed"),
  target: z.enum(["execute", "goal"]),
  reason: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(200).optional(),
  spec: z.string().trim().min(1).max(8000).optional(),
});

export type ParsedModeProposal = z.infer<typeof proposalSchema>;

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function parseModeProposal(message: CopilotMessage): ParsedModeProposal | null {
  if (message.kind !== "tool_result" || message.toolName !== "propose_mode_switch" || !message.modeProposal) return null;
  const parsed = proposalSchema.safeParse(parseJson(message.content));
  return parsed.success ? parsed.data : null;
}

const enteredPlanSchema = z.object({ status: z.literal("mode_changed"), mode: z.literal("plan"), reason: z.string().trim().min(1).max(500) });

/** Reason for a successful `enter_plan_mode` tool result, or null for any other message. */
export function parseEnterPlanMode(message: CopilotMessage): string | null {
  if (message.kind !== "tool_result" || message.toolName !== "enter_plan_mode") return null;
  const parsed = enteredPlanSchema.safeParse(parseJson(message.content));
  return parsed.success ? parsed.data.reason : null;
}

/** Small inline status row for a model-initiated switch to Plan Mode. */
export function EnteredPlanModeRow({ reason }: { reason: string }) {
  const { t } = useLanguage();
  return (
    <div role="status" data-testid="copilot-entered-plan-mode" className="my-1 flex min-w-0 items-start gap-1.5 text-[11.5px] text-muted-foreground">
      <Compass className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <span className="min-w-0 break-words">{t("copilot.modeSwitchedToPlan").replace("{reason}", reason)}</span>
    </div>
  );
}

interface Props {
  proposal: ParsedModeProposal;
  stored: NonNullable<CopilotMessage["modeProposal"]>;
  stepId: string;
  conversationId: string;
  busy?: boolean;
  onReceipt?: (receipt?: CopilotModeReceipt) => void;
}

export function CopilotModeProposalCard({ proposal, stored, stepId, conversationId, busy, onReceipt }: Props) {
  const { t } = useLanguage();
  const headingId = useId();
  const [pending, setPending] = useState<CopilotModeDecision | null>(null);
  const [lastReceipt, setLastReceipt] = useState<CopilotModeReceipt>();
  const inFlight = useRef(false);
  const receipt = stored.receipt ?? lastReceipt;
  const disabled = Boolean(busy || pending);
  const isGoal = proposal.target === "goal";

  async function decide(decision: CopilotModeDecision) {
    if (inFlight.current || receipt || disabled || (stored.stale && decision === "accept")) return;
    inFlight.current = true;
    setPending(decision);
    let confirmed: CopilotModeReceipt | undefined;
    try {
      ({ receipt: confirmed } = await confirmCopilotModeProposal(conversationId, stepId, decision));
      setLastReceipt(confirmed);
    } catch (error) {
      const code = error instanceof GatewayApiError ? error.details?.code : undefined;
      toast.error(t(code === "COPILOT_REQUEST_CONFLICT" ? "copilot.modeProposalConflict" : "copilot.modeProposalFailed"));
    } finally {
      inFlight.current = false;
      setPending(null);
      onReceipt?.(confirmed);
    }
  }

  return (
    <section
      data-testid="copilot-mode-proposal-card"
      aria-labelledby={headingId}
      aria-busy={Boolean(pending)}
      className="my-2 min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="space-y-1.5 px-3.5 py-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
            {isGoal ? <Route className="size-3.5" aria-hidden="true" /> : <Compass className="size-3.5" aria-hidden="true" />}
            {t("copilot.modeProposalBadge")}
          </span>
        </div>
        <h3 id={headingId} className="text-sm font-semibold break-words">
          {t(isGoal ? "copilot.modeProposalGoalTitle" : "copilot.modeProposalExecuteTitle")}
        </h3>
        <p className="text-xs/relaxed break-words text-muted-foreground">{proposal.reason}</p>
        {isGoal && (proposal.title || proposal.spec) && (
          <div className="space-y-1 rounded-md border border-border/70 bg-muted/25 px-2.5 py-2">
            {proposal.spec ? (
              <details>
                <summary className="cursor-pointer break-words rounded-sm text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {proposal.title || t("copilot.modeProposalFullSpec")}
                </summary>
                <p data-testid="copilot-mode-proposal-spec" className="mt-2 whitespace-pre-wrap text-xs break-words text-muted-foreground">{proposal.spec}</p>
              </details>
            ) : <p className="text-xs font-medium break-words">{proposal.title}</p>}
          </div>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-border/70 px-3.5 py-2.5">
        {receipt ? (
          <>
            <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              {receipt.decision === "accept"
                ? <Check className="size-3.5 text-success" aria-hidden="true" />
                : <X className="size-3.5" aria-hidden="true" />}
              {t(receipt.decision === "accept" ? "copilot.modeProposalAccepted" : "copilot.modeProposalDismissed")}
            </span>
            {receipt.decision === "accept" && receipt.goalId && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/copilot/goals/${encodeURIComponent(receipt.goalId)}`}>
                  {t("copilot.planOpenGoal")} <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              </Button>
            )}
          </>
        ) : (
          <>
            {stored.stale && <span role="status" className="text-xs text-muted-foreground">{t("copilot.modeProposalStale")}</span>}
            <Button type="button" size="sm" variant="brand" disabled={disabled || stored.stale} onClick={() => void decide("accept")}>
              {t("copilot.modeProposalAccept")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => void decide("dismiss")}>
              {t("copilot.modeProposalDismiss")}
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
